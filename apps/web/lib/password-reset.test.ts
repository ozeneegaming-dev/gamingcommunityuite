import { clearIpRangeCache, GcsNotFound, GcsRateLimited, GcsValidationError, seedDefaults, type GcsMail } from "@gcs/core";
import { truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { getAuth } from "./auth";
import { completePasswordReset, requestPasswordReset, type GcsPasswordResetIo } from "./password-reset";
import { resetServices, services } from "./services";

// Serviciile se iau la fiecare test: alte teste (ex. instalarea din CLI) le pot recrea.
const db = new Proxy({} as ReturnType<typeof services>["db"], { get: (_, p) => Reflect.get(services().db, p) });
const BASE = "http://localhost:3000/api/auth";
const ACP_ACTOR = { userId: null, groupIds: [], primaryGroupId: 0, isBanned: false, ip: "test" };
const setAcpSetting = (key: string, value: unknown) => services().settings.set(key, value, ACP_ACTOR);
const OLD = "parola-sigura-123";
const NEW = "parola-noua-456";

/** Emailurile „trimise” (după răspuns, ca în aplicație), așteptate de `flush`. */
let mails: GcsMail[] = [];
let pending: Promise<void>[] = [];
const io: GcsPasswordResetIo = {
  defer: (task) => void pending.push(task()),
  send: async (mail) => void mails.push(mail),
};
async function flush(): Promise<GcsMail[]> {
  await Promise.all(pending);
  pending = [];
  return mails;
}

beforeEach(async () => {
  const s = services();
  await truncateAll(s.db);
  await s.kv.flushAll();
  clearIpRangeCache(s.db);
  await seedDefaults(s.db, s.registry);
  await s.db.setting.upsert({ where: { key: "antispam.captcha" }, create: { key: "antispam.captcha", value: "none" }, update: { value: "none" } });
  // Emailul configurat (ACP → Setări → Email): în teste, emailurile ajung în `mails`.
  await setAcpSetting("email.smtp_host", "smtp.example.com");
  await setAcpSetting("email.from", "noreply@example.com");
  // Emailurile altor funcții ar încerca serverul SMTP de mai sus: „dispozitiv nou” e oprit.
  await setAcpSetting("security.new_device_email", false);
  mails = [];
  pending = [];
});

afterAll(async () => {
  await resetServices();
});

async function call(path: string, body: unknown, ip: string, extra: Record<string, string> = {}): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip, ...extra },
      body: JSON.stringify(body),
    }),
  );
}

let ipCounter = 0;
const nextIp = () => `198.51.100.${(ipCounter++ % 200) + 20}`;
const signIn = (email: string, password: string) => call("/sign-in/email", { email, password }, nextIp());

async function member(name: string, email: string, locale = "ro"): Promise<string> {
  expect((await call("/sign-up/email", { name, email, password: OLD }, nextIp())).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { locale } });
  return user.id;
}

const tokenOf = (mail: GcsMail) => new URL(/href="([^"]+)"/.exec(mail.html)![1]!).searchParams.get("token")!;

describe("„Am uitat parola” (cererea)", () => {
  test("același răspuns pentru un cont existent, un email necunoscut sau un nume; emailul pleacă doar contului, în limba lui", async () => {
    await member("Ana", "ana@mail.com", "en");
    const answers = await Promise.all([
      requestPasswordReset("ana@mail.com", "203.0.113.1", io),
      requestPasswordReset("nimeni@mail.com", "203.0.113.1", io),
      requestPasswordReset("Nimeni", "203.0.113.1", io),
    ]);
    expect(answers).toEqual([{ status: "sent" }, { status: "sent" }, { status: "sent" }]);
    const sent = await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@mail.com", subject: expect.stringMatching(/^Reset your password — /) });
    expect(sent[0]!.html).toMatch(/href="http:\/\/localhost:3000\/reset-password\?token=[A-Za-z0-9_-]{43}"/);
    expect(sent[0]!.html).toContain("30 minutes");
    expect(sent[0]!.text).toContain("/reset-password?token=");
    // Doar hash-ul tokenului e în baza de date.
    const rows = await db.verification.findMany({ where: { identifier: { startsWith: "password-reset:" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier).not.toContain(tokenOf(sent[0]!));
  });

  test("după numele de utilizator; un cont doar cu Discord primește explicația, fără link", async () => {
    const id = await member("Bogdan", "bogdan@mail.com");
    await requestPasswordReset("bogdan", "203.0.113.2", io);
    expect((await flush())[0]!.subject).toMatch(/^Resetarea parolei — /);

    mails = [];
    await db.account.deleteMany({ where: { userId: id, providerId: "credential" } });
    await db.account.create({ data: { userId: id, accountId: "discord-1", providerId: "discord" } });
    expect(await requestPasswordReset("bogdan@mail.com", "203.0.113.2", io)).toEqual({ status: "sent" });
    const [mail] = await flush();
    expect(mail!.subject).toMatch(/^Cum intri în cont — /);
    expect(mail!.html).toContain("Discord");
    expect(mail!.html).toContain('href="http://localhost:3000/login"');
    expect(mail!.html).not.toContain("reset-password");
  });

  test("fără emailul configurat → no_email; oprit din ACP → disabled; nu pleacă nimic", async () => {
    await member("Cezar", "cezar@mail.com");
    await setAcpSetting("email.smtp_host", "");
    expect(await requestPasswordReset("cezar@mail.com", "203.0.113.3", io)).toEqual({ status: "no_email" });
    await setAcpSetting("email.smtp_host", "smtp.example.com");
    await setAcpSetting("auth.password_reset_enabled", false);
    expect(await requestPasswordReset("cezar@mail.com", "203.0.113.3", io)).toEqual({ status: "disabled" });
    expect(await flush()).toHaveLength(0);
  });

  test("limita pe IP: a 11-a cerere de pe același IP → GcsRateLimited, cu sau fără cont", async () => {
    await member("Dana", "dana@mail.com");
    for (let i = 0; i < 10; i++) await requestPasswordReset(`x${i}@mail.com`, "203.0.113.4", io);
    await expect(requestPasswordReset("dana@mail.com", "203.0.113.4", io)).rejects.toBeInstanceOf(GcsRateLimited);
    await expect(requestPasswordReset("y@mail.com", "203.0.113.4", io)).rejects.toBeInstanceOf(GcsRateLimited);
  });
});

describe("„Am uitat parola” (parola nouă)", () => {
  test("politica și confirmarea, apoi parola nouă: vechea nu mai merge, sesiunile se închid, blocarea dispare, 2FA rămâne, pleacă anunțul", async () => {
    const id = await member("Emil", "emil@mail.com");
    // Blocat după parole greșite (ACP → Setări → Securitate).
    await setAcpSetting("security.login_max_attempts", 3);
    expect((await signIn("emil@mail.com", OLD)).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await signIn("emil@mail.com", "gresita-123")).status).toBe(401);
    expect((await signIn("emil@mail.com", OLD)).status).toBe(403);
    expect(await db.session.count({ where: { userId: id } })).toBeGreaterThan(0);

    await requestPasswordReset("emil@mail.com", "203.0.113.5", io);
    const token = tokenOf((await flush())[0]!);
    mails = [];
    const session = null;

    const mismatch = await completePasswordReset({ token, password: NEW, confirm: "alta", ip: "203.0.113.5", session }, io).catch((e: unknown) => e);
    expect((mismatch as GcsValidationError).fields).toEqual({ confirm: "password_mismatch" });
    const weak = await completePasswordReset({ token, password: "doarlitere", confirm: "doarlitere", ip: "203.0.113.5", session }, io).catch((e: unknown) => e);
    expect(weak).toBeInstanceOf(GcsValidationError);
    expect((weak as GcsValidationError).fields).toEqual({ password: "password_needs_mix" });

    await completePasswordReset({ token, password: NEW, confirm: NEW, ip: "203.0.113.5", session }, io);
    expect(await db.session.count({ where: { userId: id } })).toBe(0);
    const [notice] = await flush();
    expect(notice).toMatchObject({ to: "emil@mail.com", subject: expect.stringMatching(/^Parola a fost schimbată — /) });
    expect(notice!.html).toContain("203.0.113.5");
    expect(notice!.html).toContain('href="http://localhost:3000/forgot-password"');
    expect(await db.auditLog.count({ where: { action: "auth.password_reset", targetId: id } })).toBe(1);

    // Parola veche nu mai merge (fără blocare), cea nouă da.
    expect((await signIn("emil@mail.com", OLD)).status).toBe(401);
    expect((await signIn("emil@mail.com", NEW)).status).toBe(200);
    // Linkul nu merge a doua oară.
    await expect(completePasswordReset({ token, password: "a-treia-parola-7", confirm: "a-treia-parola-7", ip: null, session }, io)).rejects.toBeInstanceOf(GcsNotFound);

    // 2FA activ: după o resetare, autentificarea cere din nou codul.
    await db.user.update({ where: { id }, data: { twoFactorEnabled: true } });
    await requestPasswordReset("emil@mail.com", "203.0.113.6", io);
    const second = tokenOf((await flush()).at(-1)!);
    await completePasswordReset({ token: second, password: "parola-a-treia-789", confirm: "parola-a-treia-789", ip: "203.0.113.6", session }, io);
    const twoFactor = await signIn("emil@mail.com", "parola-a-treia-789");
    expect(twoFactor.status).toBe(200);
    expect(await twoFactor.json()).toMatchObject({ twoFactorRedirect: true });
  });

  test("cu setarea oprită, sesiunile rămân deschise", async () => {
    const id = await member("Flavia", "flavia@mail.com");
    await setAcpSetting("auth.password_reset_revoke_sessions", false);
    expect((await signIn("flavia@mail.com", OLD)).status).toBe(200);
    const before = await db.session.count({ where: { userId: id } });
    await requestPasswordReset("flavia@mail.com", "203.0.113.7", io);
    const token = tokenOf((await flush())[0]!);
    await completePasswordReset({ token, password: NEW, confirm: NEW, ip: "203.0.113.7", session: null }, io);
    expect(await db.session.count({ where: { userId: id } })).toBe(before);
  });
});
