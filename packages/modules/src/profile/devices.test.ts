import { GcsForbidden, GcsNotFound } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { approximateLocation, GcsDeviceService, loginMethod, maskIp, NO_AUTO_LOGIN_HOURS, parseUserAgent } from "./devices";
import { GcsMemberPrefsService } from "./memberPrefs";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const EDGE_WIN = `${CHROME_WIN} Edg/141.0`;
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

let w: GcsProfileWorld;
let devices: GcsDeviceService;

beforeEach(async () => {
  w = await createProfileWorld();
  devices = new GcsDeviceService({ db: w.db, mailer: w.mailer, settings: w.settings, baseUrl: async () => "https://forum.test" });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function session(userId: string, ua: string) {
  return w.db.session.create({ data: { userId, token: `t-${Math.random()}`, expiresAt: new Date(Date.now() + 30 * 86_400_000), userAgent: ua, ipAddress: "203.0.113.7" } });
}

describe("dispozitivele: cititorii", () => {
  test("browserul și sistemul din user-agent (Edge nu e Chrome), metoda din cale, țara, IP-ul mascat", () => {
    expect(parseUserAgent(CHROME_WIN)).toEqual({ browser: "Chrome", os: "Windows" });
    expect(parseUserAgent(EDGE_WIN)).toEqual({ browser: "Edge", os: "Windows" });
    expect(parseUserAgent(SAFARI_IOS)).toEqual({ browser: "Safari", os: "iOS" });
    expect(parseUserAgent(FIREFOX_LINUX)).toEqual({ browser: "Firefox", os: "Linux" });
    expect(parseUserAgent(null)).toEqual({ browser: "Browser", os: "—" });
    expect(["/sign-in/email", "/callback/discord", "/callback/google", "/steam/callback", "/two-factor/verify-totp", "/x"].map(loginMethod)).toEqual(["password", "discord", "google", "steam", "password", "other"]);
    expect([approximateLocation("ro"), approximateLocation("XX"), approximateLocation("Romania"), approximateLocation(null)]).toEqual(["RO", null, null, null]);
    expect([maskIp("203.0.113.7"), maskIp("2001:db8:1:2::5"), maskIp(null)]).toEqual(["203.0.113.x", "2001:db8:…", null]);
  });
});

describe("dispozitivele contului", () => {
  test("primul dispozitiv nu trimite email; unul nou da (dacă membrul nu l-a oprit); același browser = același dispozitiv", async () => {
    const userId = w.member.userId!;
    const s1 = await session(userId, CHROME_WIN);
    expect(await devices.recordLogin({ userId, sessionId: s1.id, userAgent: CHROME_WIN, ip: "203.0.113.7", country: "RO", path: "/sign-in/email" })).toEqual({ isNew: true, autoLogin: true });
    expect(w.outbox).toHaveLength(0);
    await devices.recordLogin({ userId, sessionId: s1.id, userAgent: CHROME_WIN, ip: "203.0.113.8", path: "/sign-in/email" });
    expect(await w.db.userDevice.count({ where: { userId } })).toBe(1);

    const s2 = await session(userId, SAFARI_IOS);
    expect((await devices.recordLogin({ userId, sessionId: s2.id, userAgent: SAFARI_IOS, ip: "198.51.100.4", path: "/callback/discord" })).isNew).toBe(true);
    expect(w.outbox).toHaveLength(1);
    expect(w.outbox[0]!.html).toContain("Safari · iOS");
    expect(w.outbox[0]!.html).toContain("https://forum.test/settings/devices");

    await new GcsMemberPrefsService({ db: w.db, bus: w.bus }).set(w.member, { newDeviceEmail: false });
    const s3 = await session(userId, FIREFOX_LINUX);
    await devices.recordLogin({ userId, sessionId: s3.id, userAgent: FIREFOX_LINUX, ip: null, path: "/sign-in/email" });
    expect(w.outbox).toHaveLength(1);

    const list = await devices.list(userId, { userAgent: SAFARI_IOS });
    expect(list.map((d) => [d.browser, d.os, d.method, d.current])).toEqual([
      ["Firefox", "Linux", "password", false],
      ["Safari", "iOS", "discord", true],
      ["Chrome", "Windows", "password", false],
    ]);
    expect(list.find((d) => d.browser === "Chrome")).toMatchObject({ ip: "203.0.113.x", location: "RO" });
  });

  test("doar ultimele 90 de zile", async () => {
    const userId = w.member.userId!;
    const s = await session(userId, CHROME_WIN);
    await devices.recordLogin({ userId, sessionId: s.id, userAgent: CHROME_WIN, ip: null, path: "/sign-in/email" }, new Date(Date.now() - 91 * 86_400_000));
    expect(await devices.list(userId, null)).toEqual([]);
  });

  test("fără autentificare automată: celelalte sesiuni ale dispozitivului se închid, cele noi expiră după câteva ore", async () => {
    const userId = w.member.userId!;
    const keep = await session(userId, SAFARI_IOS);
    const a = await session(userId, CHROME_WIN);
    const b = await session(userId, CHROME_WIN);
    await devices.recordLogin({ userId, sessionId: a.id, userAgent: CHROME_WIN, ip: null, path: "/sign-in/email" });
    const device = (await devices.list(userId, null))[0]!;
    await devices.setAutoLogin(w.member, device.id, false, a.id);
    expect((await w.db.session.findMany({ where: { userId }, select: { id: true } })).map((s) => s.id).sort()).toEqual([keep.id, a.id].sort());

    const c = await session(userId, CHROME_WIN);
    expect((await devices.recordLogin({ userId, sessionId: c.id, userAgent: CHROME_WIN, ip: null, path: "/sign-in/email" })).autoLogin).toBe(false);
    const expires = (await w.db.session.findUniqueOrThrow({ where: { id: c.id } })).expiresAt.getTime();
    expect(expires - Date.now()).toBeLessThanOrEqual(NO_AUTO_LOGIN_HOURS * 3600_000 + 5_000);
    expect(b.id).not.toBe(c.id);

    // Dispozitivul altcuiva nu poate fi schimbat.
    await expect(devices.setAutoLogin(w.moderator, device.id, true, null)).rejects.toBeInstanceOf(GcsNotFound);
  });
});

describe("preferințele contului", () => {
  test("implicitele, scrierea parțială și valorile invalide", async () => {
    const prefs = new GcsMemberPrefsService({ db: w.db, bus: w.bus });
    expect(await prefs.get(w.member.userId!)).toMatchObject({ topicOpen: "start", showSignatures: true, showVisitors: true });
    expect(await prefs.set(w.member, { topicOpen: "last", showSignatures: false })).toMatchObject({ topicOpen: "last", showSignatures: false, steamTab: true });
    // Celelalte chei din `prefs` (sunetul, toast-urile) rămân.
    const before = (await w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! } })).prefs as Record<string, unknown>;
    await w.db.user.update({ where: { id: w.member.userId! }, data: { prefs: { ...before, sound: false } } });
    await prefs.set(w.member, { steamTab: false });
    expect((await w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! } })).prefs).toMatchObject({ sound: false, topicOpen: "last", steamTab: false });
    await expect(prefs.set(w.member, { topicOpen: "middle" as never })).rejects.toMatchObject({ fields: { topicOpen: "invalid_choice" } });
    await expect(prefs.set(w.guest, { steamTab: true })).rejects.toBeInstanceOf(GcsForbidden);
  });
});
