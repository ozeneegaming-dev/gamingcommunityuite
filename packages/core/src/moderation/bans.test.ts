import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsValidationError } from "../errors";

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function rootActor() {
  return w.actorFor(await w.createUser("Root", "root_admin"));
}

describe("GcsBanService", () => {
  test("Review Focus #5: după ban, getActor cu vechiul token → vizitator banat; sesiunile sunt șterse", async () => {
    const target = await w.createUser("Spammer", "member");
    const session = await w.db.session.create({
      data: { token: "tok-spammer", userId: target.id, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await expect(w.actors.getActor({ sessionToken: session.token, ip: "1.1.1.1" })).resolves.toMatchObject({
      userId: target.id,
    });

    await w.bans.ban({ type: "ACCOUNT", value: target.id, userId: target.id, reason: "spam" }, await rootActor());

    expect(await w.db.session.count({ where: { userId: target.id } })).toBe(0);
    await expect(w.actors.getActor({ sessionToken: session.token, ip: "1.1.1.1" })).resolves.toMatchObject({
      userId: null,
      groupIds: [w.groups.guest],
      isBanned: true,
    });
    expect(w.events.find((e) => e.name === "user.banned")?.tags).toContain(`user:${target.id}`);
  });

  test("Review Focus #5: un ban pe IP → un vizitator de pe acel IP are isBanned:true", async () => {
    await w.bans.ban({ type: "IP", value: "198.51.100.23", reason: "abuz" }, await rootActor());
    await expect(w.actors.getActor({ ip: "198.51.100.23" })).resolves.toMatchObject({ userId: null, isBanned: true });
    await expect(w.actors.getActor({ ip: "198.51.100.24" })).resolves.toMatchObject({ isBanned: false });
  });

  test("Review Focus #5: un ban cu expiresAt = acum − 1 s → activeFor întoarce null", async () => {
    const target = await w.createUser("Temporar", "member");
    await w.db.ban.create({
      data: { type: "ACCOUNT", value: target.id, userId: target.id, reason: "x", expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(w.bans.activeFor({ userId: target.id })).resolves.toBeNull();
  });

  test("activeFor găsește bannurile pe cont, IP și email (case-insensitive)", async () => {
    const root = await rootActor();
    const target = await w.createUser("Tinta", "member");
    await w.bans.ban({ type: "EMAIL", value: "Rau@Mail.com", reason: "spam" }, root);
    await expect(w.bans.activeFor({ email: "rau@mail.com" })).resolves.toMatchObject({ type: "EMAIL", value: "rau@mail.com" });
    await expect(w.bans.activeFor({ userId: target.id, ip: "10.0.0.1" })).resolves.toBeNull();
  });

  test("lift ridică bannul: userul nu mai e blocat", async () => {
    const root = await rootActor();
    const target = await w.createUser("Iertat", "member");
    const ban = await w.bans.ban({ type: "ACCOUNT", value: target.id, userId: target.id, reason: "x" }, root);
    await w.bans.lift(ban.id, root);
    await expect(w.bans.activeFor({ userId: target.id })).resolves.toBeNull();
    expect(w.events.map((e) => e.name)).toContain("user.unbanned");
  });

  test("valori invalide → GcsValidationError", async () => {
    const root = await rootActor();
    await expect(w.bans.ban({ type: "IP", value: "nu-e-ip", reason: "x" }, root)).rejects.toBeInstanceOf(
      GcsValidationError,
    );
    await expect(w.bans.ban({ type: "ACCOUNT", value: "x", reason: "x" }, root)).rejects.toBeInstanceOf(
      GcsValidationError,
    );
    await expect(w.bans.ban({ type: "IP", value: "10.0.0.1", reason: " " }, root)).rejects.toBeInstanceOf(
      GcsValidationError,
    );
  });

  test("un membru fără drept ACP nu poate bana", async () => {
    const member = await w.actorFor(await w.createUser("Membru", "member"));
    await expect(w.bans.ban({ type: "IP", value: "10.0.0.1", reason: "x" }, member)).rejects.toBeInstanceOf(
      GcsForbidden,
    );
  });
});

describe("token revocat la ban", () => {
  test("un token nevalidat (staleSessionToken) doar semnalează bannul, nu autentifică", async () => {
    const target = await w.createUser("Cineva", "member");
    await w.db.session.create({
      data: { token: "tok-valid", userId: target.id, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await expect(w.actors.getActor({ staleSessionToken: "tok-valid", ip: "1.1.1.1" })).resolves.toMatchObject({
      userId: null,
      isBanned: false,
    });

    await w.bans.ban({ type: "ACCOUNT", value: target.id, userId: target.id, reason: "x" }, await rootActor());
    await expect(w.actors.getActor({ staleSessionToken: "tok-valid", ip: "1.1.1.1" })).resolves.toMatchObject({
      userId: null,
      isBanned: true,
    });
  });
});
