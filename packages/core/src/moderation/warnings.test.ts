import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsValidationError } from "../errors";

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
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
});
