import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsValidationError } from "../errors";
import { GcsWarningService, memberWriteGate } from "./warnings";

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("GcsWarningService", () => {
  test("avertismente 2 + 1 puncte → actionTaken.action === MODERATE_POSTS", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member");

    const first = await w.warnings.warn({ userId: target.id, points: 2, reason: "limbaj" }, root);
    expect(first.actionTaken).toBeNull();

    const second = await w.warnings.warn({ userId: target.id, points: 1, reason: "spam" }, root);
    expect(second.actionTaken?.action).toBe("MODERATE_POSTS");
    expect(second.warning.points).toBe(1);
    expect(w.events.find((e) => e.name === "user.warning_action")?.payload).toMatchObject({
      userId: target.id,
      action: "MODERATE_POSTS",
      durationHours: 72,
    });
  });

  test("un avertisment expirat nu se mai adună", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member");
    await w.db.warning.create({
      data: { userId: target.id, points: 5, reason: "vechi", expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(w.warnings.activePoints(target.id)).resolves.toBe(0);

    const result = await w.warnings.warn({ userId: target.id, points: 1, reason: "nou" }, root);
    expect(result.actionTaken).toBeNull();
    await expect(w.warnings.activePoints(target.id)).resolves.toBe(1);
  });

  test("dovada se păstrează; `authorized` lasă apelantul să-și verifice dreptul, protecția Root rămâne", async () => {
    const mod = await w.actorFor(await w.createUser("Mod", "moderator"));
    const target = await w.createUser("Tinta", "member");
    // Fără dreptul ACP: refuzat; cu dreptul verificat de apelant (ex. `chat.warn`): acceptat, cu dovada.
    await expect(w.warnings.warn({ userId: target.id, points: 1, reason: "spam" }, mod)).rejects.toThrow();
    const evidence = { type: "chat.message", id: 7, channel: "general", body: "reclamă" };
    const { warning } = await w.warnings.warn({ userId: target.id, points: 1, reason: "spam", evidence }, mod, { authorized: true });
    expect(warning.evidence).toEqual(evidence);
    const root = await w.createUser("Root", "root_admin");
    await expect(w.warnings.warn({ userId: root.id, points: 1, reason: "x" }, mod, { authorized: true })).rejects.toMatchObject({ params: { reason: "root_protected" } });
  });

  test("pragul BAN dă un ban permanent pe cont", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member");
    const result = await w.warnings.warn({ userId: target.id, points: 10, reason: "grav" }, root);
    expect(result.actionTaken?.action).toBe("BAN");
    await expect(w.bans.activeFor({ userId: target.id })).resolves.toMatchObject({ type: "ACCOUNT", expiresAt: null });
  });

  test("puncte invalide → GcsValidationError", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member");
    await expect(w.warnings.warn({ userId: target.id, points: 0, reason: "x" }, root)).rejects.toBeInstanceOf(
      GcsValidationError,
    );
  });

  test("pragul RESTRICT oprește scrierea; anularea avertismentului ridică restricțiile", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member");
    const { warning } = await w.warnings.warn({ userId: target.id, points: 5, reason: "repetat" }, root);
    const user = await w.db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(user.postsModeratedUntil).not.toBeNull();
    expect(user.postingRestrictedUntil!.getTime()).toBeGreaterThan(Date.now() + 160 * 3_600_000);
    await expect(w.warnings.assertCanWrite(target.id)).rejects.toMatchObject({ params: { reason: "posting_restricted" } });

    await w.warnings.revoke(warning.id, root);
    await expect(w.warnings.activePoints(target.id)).resolves.toBe(0);
    const after = await w.db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.postsModeratedUntil).toBeNull();
    expect(after.postingRestrictedUntil).toBeNull();
    expect(w.events.some((e) => e.name === "user.warning_revoked")).toBe(true);
    // Avertismentul anulat nu mai cere confirmare.
    await expect(w.warnings.writeGate(target.id)).resolves.toEqual({ restrictedUntil: null, ackPending: false, moderated: false });
  });

  test("un ban de prag se ridică când punctele scad sub prag", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member");
    const { warning } = await w.warnings.warn({ userId: target.id, points: 10, reason: "grav" }, root);
    await expect(w.bans.activeFor({ userId: target.id })).resolves.not.toBeNull();
    await w.warnings.revoke(warning.id, root);
    await expect(w.bans.activeFor({ userId: target.id })).resolves.toBeNull();
    expect(w.events.some((e) => e.name === "user.unbanned")).toBe(true);
  });

  test("confirmarea: avertismentul neconfirmat oprește scrierea; doar destinatarul îl poate confirma", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member");
    const other = await w.actorFor(await w.createUser("Altul", "member"));
    const { warning } = await w.warnings.warn({ userId: target.id, points: 1, reason: "off-topic" }, root);
    await expect(w.warnings.assertCanWrite(target.id)).rejects.toMatchObject({ params: { reason: "warning_ack" } });
    // Fără setarea „confirmă înainte să postezi”, membrul poate scrie.
    const relaxed = new GcsWarningService({ db: w.db, bus: w.bus, acp: w.acp, bans: w.bans, ackRequired: async () => false });
    await expect(relaxed.assertCanWrite(target.id)).resolves.toBeUndefined();

    await expect(w.warnings.acknowledge(other, warning.id)).rejects.toMatchObject({ code: "not_found" });
    await w.warnings.acknowledge(await w.actorFor(target), warning.id);
    await expect(w.warnings.assertCanWrite(target.id)).resolves.toBeUndefined();
    const [mine] = await w.warnings.mine(target.id);
    expect(mine).toMatchObject({ id: warning.id, active: true, appeal: null });
    expect(mine!.acknowledgedAt).not.toBeNull();
  });

  test("contestația: una pe avertisment, respinsă sau acceptată (acceptată = avertisment anulat)", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member");
    const me = await w.actorFor(target);
    const a = await w.warnings.warn({ userId: target.id, points: 1, reason: "unu" }, root);
    const b = await w.warnings.warn({ userId: target.id, points: 1, reason: "doi" }, root);

    await expect(w.warnings.appeal(me, a.warning.id, "scurt")).rejects.toBeInstanceOf(GcsValidationError);
    const first = await w.warnings.appeal(me, a.warning.id, "Nu am scris eu mesajul acela.");
    expect(first.status).toBe("pending");
    expect((await w.db.warning.findUniqueOrThrow({ where: { id: a.warning.id } })).acknowledgedAt).not.toBeNull();
    expect(w.events.some((e) => e.name === "warning.appealed")).toBe(true);
    await expect(w.warnings.appeal(me, a.warning.id, "Încă o dată, vă rog.")).rejects.toMatchObject({ params: { reason: "already_appealed" } });

    await expect(w.warnings.appeals(me)).rejects.toThrow();
    const pending = await w.warnings.appeals(root);
    expect(pending.map((p) => [p.id, p.user?.name])).toEqual([[first.id, "Tinta"]]);

    await w.warnings.decideAppeal(root, first.id, false, "Dovada e clară.");
    await expect(w.warnings.decideAppeal(root, first.id, true, "")).rejects.toMatchObject({ params: { reason: "already_decided" } });
    await expect(w.warnings.activePoints(target.id)).resolves.toBe(2);

    const second = await w.warnings.appeal(me, b.warning.id, "A fost o neînțelegere în chat.");
    await w.warnings.decideAppeal(root, second.id, true, "");
    await expect(w.warnings.activePoints(target.id)).resolves.toBe(1);
    expect(w.events.filter((e) => e.name === "warning.appeal_decided").map((e) => (e.payload as { accepted: boolean }).accepted)).toEqual([false, true]);
    await expect(w.warnings.appeals(root)).resolves.toEqual([]);

    // Un avertisment expirat nu se mai poate contesta.
    const old = await w.db.warning.create({ data: { userId: target.id, points: 1, reason: "vechi", expiresAt: new Date(Date.now() - 1000) } });
    await expect(w.warnings.appeal(me, old.id, "Prea târziu, dar încerc.")).rejects.toMatchObject({ params: { reason: "warning_inactive" } });
  });

  test("jobul de expirare golește restricțiile când avertismentele au expirat", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member");
    await w.warnings.warn({ userId: target.id, points: 3, reason: "spam", expiresAt: new Date(Date.now() + 3_600_000) }, root);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: target.id } })).postsModeratedUntil).not.toBeNull();
    await expect(memberWriteGate(w.db, target.id, { ackRequired: false })).resolves.toMatchObject({ moderated: true, restrictedUntil: null });

    await expect(w.warnings.expireSweep(new Date())).resolves.toBe(1);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: target.id } })).postsModeratedUntil).not.toBeNull();
    // Peste două ore avertismentul a expirat: postările nu mai trec prin aprobare.
    await w.warnings.expireSweep(new Date(Date.now() + 2 * 3_600_000));
    expect((await w.db.user.findUniqueOrThrow({ where: { id: target.id } })).postsModeratedUntil).toBeNull();
    await expect(w.warnings.expireSweep(new Date())).resolves.toBe(0);
  });

  test("motive predefinite și praguri: validare, pragul dublat e refuzat", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const mod = await w.actorFor(await w.createUser("Mod", "moderator"));
    await expect(w.warnings.saveReason(mod, { name: "Spam", points: 2, expiresDays: 30 })).rejects.toThrow();
    await expect(w.warnings.saveReason(root, { name: "S", points: 0, expiresDays: 0 })).rejects.toMatchObject({ fields: { name: "invalid_length", points: "invalid_points", expiresDays: "invalid_range" } });
    const reason = await w.warnings.saveReason(root, { name: "Spam", points: 2, expiresDays: 30 });
    await w.warnings.saveReason(root, { id: reason.id, name: "Spam / reclamă", points: 3, expiresDays: null });
    await expect(w.warnings.reasons()).resolves.toMatchObject([{ id: reason.id, name: "Spam / reclamă", points: 3, expiresDays: null }]);

    const target = await w.createUser("Tinta", "member");
    const { warning } = await w.warnings.warn({ userId: target.id, points: 3, reason: "Spam / reclamă", reasonId: reason.id }, root);
    expect(warning.reasonId).toBe(reason.id);
    await w.warnings.deleteReason(root, reason.id);
    await expect(w.warnings.reasons()).resolves.toEqual([]);

    await expect(w.warnings.saveThreshold(root, { threshold: 5, action: "BAN", durationHours: 24 })).rejects.toMatchObject({ fields: { threshold: "taken" } });
    const th = await w.warnings.saveThreshold(root, { threshold: 7, action: "BAN", durationHours: 24 });
    await expect(w.warnings.thresholds()).resolves.toHaveLength(4);
    await w.warnings.deleteThreshold(root, th.id);
    await expect(w.warnings.thresholds()).resolves.toHaveLength(3);
  });
});
