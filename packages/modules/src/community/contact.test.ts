import type { GcsActor, GcsMail } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { CONTACT_NOTIFICATION, CONTACT_SETTING, DEFAULT_CONTACT, GcsContactService, type GcsContactConfig } from "./contact";

let w: GcsRemovalWorld;
let sent: GcsMail[];
let contact: GcsContactService;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  sent = [];
  const s = w.s;
  contact = new GcsContactService({
    db: s.db,
    settings: s.settings,
    acp: s.acp,
    notifications: s.notifications,
    mailer: async (m) => void sent.push(m),
    rateLimiter: s.rateLimiter,
    antispam: s.antispam,
    siteName: async () => "Comunitatea Test",
  });
  // Captcha-ul oprit în afara testului lui (proof-of-work-ul are testele lui în anti-spam).
  await s.settings.set("antispam.captcha", "none", w.system());
});

let ipCounter = 0;
const guest = (): GcsActor => ({ userId: null, groupIds: [w.group("guest")], primaryGroupId: w.group("guest"), isBanned: false, ip: `198.51.100.${++ipCounter}` });
const input = (over: Partial<{ name: string; email: string; subject: string; body: string; pow: string | null }> = {}, ip = `203.0.113.${++ipCounter}`) => ({
  name: "Andrei Pop",
  email: "andrei@exemplu.ro",
  subject: DEFAULT_CONTACT.subjects[0]!,
  body: "Salut, am o întrebare despre serverul de CS2.",
  pow: null,
  ip,
  ...over,
});
const setConfig = (patch: Partial<GcsContactConfig>) => w.s.settings.set(CONTACT_SETTING, { ...DEFAULT_CONTACT, ...patch }, w.system());

describe("formularul de contact", () => {
  test("un vizitator trimite: mesajul se salvează, staff-ul e anunțat, copiile pleacă pe email", async () => {
    const root = await w.user("RootContact", "root_admin");
    await setConfig({ emails: ["admin@exemplu.ro"] });
    const { id } = await contact.submit(guest(), input(), null);
    expect(await w.s.db.contactMessage.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Andrei Pop", email: "andrei@exemplu.ro", status: "new", userId: null });
    expect(await w.s.db.notification.count({ where: { userId: root.userId!, type: CONTACT_NOTIFICATION } })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "admin@exemplu.ro", subject: `[Comunitatea Test] ${DEFAULT_CONTACT.subjects[0]}` });
  });

  test("membrii trimit cu datele contului; contul Steam (email fictiv) își scrie adresa; vizitatorii opriți → refuz", async () => {
    const member = await w.user("Mihai");
    const { id } = await contact.submit(member, input({ name: "Altul", email: "altul@x.ro" }), { name: "Mihai", email: "mihai@mail.com" });
    expect(await w.s.db.contactMessage.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Mihai", email: "mihai@mail.com", userId: member.userId });
    const steam = await w.user("SteamUser");
    const s = await contact.submit(steam, input({ email: "real@mail.com" }), { name: "SteamUser", email: "7656@steam.invalid" });
    expect((await w.s.db.contactMessage.findUniqueOrThrow({ where: { id: s.id } })).email).toBe("real@mail.com");

    await setConfig({ guests: false });
    await expect(contact.submit(guest(), input(), null)).rejects.toMatchObject({ params: { reason: "login_required" } });
    await setConfig({ enabled: false });
    await expect(contact.submit(member, input(), { name: "Mihai", email: "mihai@mail.com" })).rejects.toMatchObject({ status: 404 });
  });

  test("validarea: subiectul din listă, mesajul prea scurt, emailul; subiect liber fără listă", async () => {
    await expect(contact.submit(guest(), input({ subject: "Altceva" }), null)).rejects.toMatchObject({ fields: { subject: "invalid_choice" } });
    await expect(contact.submit(guest(), input({ body: "scurt" }), null)).rejects.toMatchObject({ fields: { body: "length" } });
    await expect(contact.submit(guest(), input({ email: "nu-e-email" }), null)).rejects.toMatchObject({ fields: { email: "invalid_email" } });
    await setConfig({ subjects: [] });
    await expect(contact.submit(guest(), input({ subject: "Subiect propriu" }), null)).resolves.toMatchObject({ id: expect.any(Number) });
  });

  test("limita: al patrulea mesaj în 10 minute de pe același IP e refuzat; captcha-ul cerut vizitatorilor", async () => {
    const ip = "192.0.2.77";
    for (let i = 0; i < 3; i++) await contact.submit(guest(), input({}, ip), null);
    await expect(contact.submit(guest(), input({}, ip), null)).rejects.toMatchObject({ status: 429 });
    await w.s.settings.set("antispam.captcha", "pow", w.system());
    await expect(contact.submit(guest(), input(), null)).rejects.toMatchObject({ params: { reason: "captcha_failed" } });
  });

  test("ACP: lista cu numărători, citit / arhivat, răspunsul pe email (în jurnal), ștergerea, curățarea", async () => {
    const root = await w.user("RootInbox", "root_admin");
    const member = await w.user("FaraDrept");
    const a = await contact.submit(guest(), input({ name: "Ana" }), null);
    const b = await contact.submit(guest(), input({ name: "Bogdan" }), null);
    await expect(contact.list(member, { page: 1 })).rejects.toThrow();

    await contact.setStatus(root, a.id, "archived");
    let list = await contact.list(root, { page: 1 });
    expect(list.items.map((m) => m.name)).toEqual(["Bogdan"]);
    expect(list.counts).toMatchObject({ new: 1, archived: 1 });
    expect((await contact.list(root, { page: 1, status: "archived" })).items.map((m) => m.name)).toEqual(["Ana"]);
    expect((await contact.list(root, { page: 1, status: "all", q: "Bog" })).total).toBe(1);

    await contact.reply(root, b.id, "Bună, Bogdan! Serverul e pornit.");
    expect(sent.at(-1)).toMatchObject({ to: "andrei@exemplu.ro", subject: `Re: ${DEFAULT_CONTACT.subjects[0]} · Comunitatea Test` });
    expect(sent.at(-1)!.text).toContain("> Salut, am o întrebare");
    expect((await w.s.db.contactMessage.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("answered");
    expect((await contact.replies([b.id])).get(b.id)).toEqual([expect.objectContaining({ actorId: root.userId, text: "Bună, Bogdan! Serverul e pornit." })]);
    await expect(contact.reply(member, b.id, "x x")).rejects.toThrow();

    await w.s.db.contactMessage.update({ where: { id: a.id }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000) } });
    expect(await contact.prune()).toBe(1);
    expect(await contact.remove(root, [b.id])).toBe(1);
    expect(await w.s.db.contactMessage.count()).toBe(0);
  });

  test("setările: validarea emailurilor, a adresei externe și a păstrării", async () => {
    const root = await w.user("RootCfg", "root_admin");
    await expect(contact.saveConfig(root, { ...DEFAULT_CONTACT, emails: ["nu-e-email"] })).rejects.toThrow();
    await expect(contact.saveConfig(root, { ...DEFAULT_CONTACT, redirectUrl: "javascript:alert(1)" })).rejects.toThrow();
    await expect(contact.saveConfig(root, { ...DEFAULT_CONTACT, keepDays: 5 })).rejects.toThrow();
    await contact.saveConfig(root, { ...DEFAULT_CONTACT, redirectUrl: "https://discord.gg/exemplu", subjects: ["Unban"] });
    expect(await contact.config()).toMatchObject({ redirectUrl: "https://discord.gg/exemplu", subjects: ["Unban"] });
    await expect(contact.submit(guest(), input({ subject: "Unban" }), null)).rejects.toMatchObject({ status: 404 });
  });
});
