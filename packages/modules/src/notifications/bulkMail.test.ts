import type { GcsMail } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { BULK_MAIL_RATE_SETTING, GcsBulkMailService, unsubscribeToken } from "./bulkMail";

let w: GcsRemovalWorld;
let sent: GcsMail[];
let bulk: GcsBulkMailService;
const SECRET = "secret-de-test";

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  sent = [];
  bulk = new GcsBulkMailService({ db: w.s.db, acp: w.s.acp, settings: w.s.settings, mailer: async (m) => void sent.push(m), secret: () => SECRET, baseUrl: async () => "https://site.test" });
});

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const all = { groupIds: [] as number[], primaryOnly: false, activeDays: null };

/** Un membru cu email confirmat (ținta obișnuită a unui email în masă). */
async function verified(name: string, group = "member") {
  const actor = await w.user(name, group);
  await w.s.db.user.update({ where: { id: actor.userId! }, data: { emailVerified: true } });
  return actor;
}

describe("email în masă", () => {
  test("publicul: doar emailuri confirmate și reale, fără banați, spammeri sau dezabonați; filtrul pe grupuri", async () => {
    const root = await verified("RootMail", "root_admin");
    const ana = await verified("Ana");
    await verified("Bogdan", "vip_gold");
    await w.user("Neconfirmat");
    const steam = await verified("Steam");
    await w.s.db.user.update({ where: { id: steam.userId! }, data: { email: "7656@steam.invalid" } });
    const spam = await verified("Spammer");
    await w.s.db.user.update({ where: { id: spam.userId! }, data: { isSpammer: true } });
    const banned = await verified("Banat");
    await w.s.db.ban.create({ data: { type: "ACCOUNT", value: banned.userId!, userId: banned.userId!, reason: "test" } });
    const out = await verified("Dezabonat");
    await bulk.setOptOut(out.userId!, true);

    expect(await bulk.count(root, all)).toBe(3); // RootMail, Ana, Bogdan
    expect(await bulk.count(root, { ...all, groupIds: [w.group("vip_gold")] })).toBe(1);
    await w.s.db.user.update({ where: { id: ana.userId! }, data: { lastActiveAt: new Date() } });
    expect(await bulk.count(root, { ...all, activeDays: 7 })).toBe(1);
    await expect(bulk.count(ana, all)).rejects.toThrow();
  });

  test("ciorna se editează doar cât e ciornă; testul pleacă doar la admin; trimiterea pe loturi, cu dezabonare în fiecare", async () => {
    const root = await verified("RootSend", "root_admin");
    for (const n of ["M1", "M2", "M3", "M4"]) await verified(n);
    await w.s.settings.set(BULK_MAIL_RATE_SETTING, 5, w.system());
    const { id } = await bulk.save(root, null, { subject: "Turneu {site}", body: doc("Salut, {name}! Turneul începe sâmbătă."), audience: all });
    await bulk.save(root, id, { subject: "Turneu sâmbătă", body: doc("Salut, {name}! Ne vedem sâmbătă."), audience: all });
    await expect(bulk.save(root, id, { subject: "x", body: doc("Salut"), audience: all })).rejects.toMatchObject({ fields: { subject: "length" } });

    expect(await bulk.sendTest(root, id)).toMatch(/@mail\.com$/);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("[Test] Turneu sâmbătă");
    expect(sent[0]!.html).toContain("Salut, RootSend!");
    sent = [];

    expect(await bulk.start(root, id)).toBe(5);
    await expect(bulk.save(root, id, { subject: "Prea târziu", body: doc("x x x x x"), audience: all })).rejects.toMatchObject({ status: 404 });
    // Primul minut: 5 emailuri (limita), apoi lista se termină la al doilea.
    expect(await bulk.tick()).toBe(5);
    expect((await w.s.db.bulkMail.findUniqueOrThrow({ where: { id } })).status).toBe("sending");
    expect(await bulk.tick()).toBe(0);
    const done = await w.s.db.bulkMail.findUniqueOrThrow({ where: { id } });
    expect(done).toMatchObject({ status: "sent", sent: 5, failed: 0, total: 5 });
    expect(new Set(sent.map((m) => m.to)).size).toBe(5);
    const m1 = sent.find((m) => m.html.includes("Salut, M1!"))!;
    const user = await w.s.db.user.findFirstOrThrow({ where: { name: "M1" } });
    expect(m1.html).toContain(`https://site.test/unsubscribe?u=${user.id}&amp;t=${unsubscribeToken(SECRET, user.id)}`);
    expect(m1.text).toContain("Dezabonare: https://site.test/unsubscribe?u=");

    // Linkul semnat dezabonează; unul falsificat nu.
    expect(await bulk.unsubscribe(user.id, "fals")).toBe(false);
    expect(await bulk.unsubscribe(user.id, unsubscribeToken(SECRET, user.id))).toBe(true);
    expect(await bulk.optedOut(user.id)).toBe(true);
    expect(await bulk.count(root, all)).toBe(4);
  });

  test("oprirea, duplicarea și ștergerea (nu în timpul trimiterii)", async () => {
    const root = await verified("RootStop", "root_admin");
    await verified("X1");
    const { id } = await bulk.save(root, null, { subject: "Anunț important", body: doc("Text suficient de lung."), audience: all });
    await bulk.start(root, id);
    await expect(bulk.remove(root, id)).rejects.toMatchObject({ status: 404 });
    await bulk.cancel(root, id);
    expect(await bulk.tick()).toBe(0);
    const copy = await bulk.duplicate(root, id);
    expect(await w.s.db.bulkMail.findUniqueOrThrow({ where: { id: copy.id } })).toMatchObject({ status: "draft", subject: "Anunț important" });
    await bulk.remove(root, id);
    expect(await w.s.db.bulkMail.count()).toBe(1);
  });

  test("fără destinatari nu pornește; un public invalid e refuzat", async () => {
    const root = await verified("RootEmpty", "root_admin");
    const { id } = await bulk.save(root, null, { subject: "Doar VIP Legend", body: doc("Text suficient de lung."), audience: { ...all, groupIds: [w.group("vip_legend")] } });
    await expect(bulk.start(root, id)).rejects.toMatchObject({ fields: { audience: "empty" } });
    await expect(bulk.save(root, null, { subject: "Public stricat", body: doc("Text suficient."), audience: { groupIds: ["x"], primaryOnly: false, activeDays: null } as never })).rejects.toMatchObject({ fields: { audience: "invalid" } });
  });
});
