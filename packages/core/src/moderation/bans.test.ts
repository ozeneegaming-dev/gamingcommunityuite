import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsValidationError } from "../errors";
import { isLocalIp } from "./bans";

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

describe("banurile pe intervale IP și pe domenii de email (antispam)", () => {
  test("isLocalIp: adresele locale / private nu se banează automat; cele publice da", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.0.133", "169.254.1.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "nu-e-ip"]) expect(isLocalIp(ip), ip).toBe(true);
    for (const ip of ["203.0.113.77", "100.72.0.9", "8.8.8.8", "2001:db8::1", "172.32.0.1"]) expect(isLocalIp(ip), ip).toBe(false);
  });

  test("un interval CIDR (IPv4 și IPv6) prinde adresele din el, nu și pe cele din afară; ridicat → liber imediat", async () => {
    const root = await rootActor();
    const ban = await w.bans.ban({ type: "IP", value: "203.0.113.0/24", reason: "rețea de spam" }, root);
    await w.bans.ban({ type: "IP", value: "2001:db8::/32", reason: "rețea de spam" }, root);
    await expect(w.actors.getActor({ ip: "203.0.113.77" })).resolves.toMatchObject({ isBanned: true });
    await expect(w.actors.getActor({ ip: "::ffff:203.0.113.5" })).resolves.toMatchObject({ isBanned: true });
    await expect(w.actors.getActor({ ip: "2001:db8:1::9" })).resolves.toMatchObject({ isBanned: true });
    await expect(w.actors.getActor({ ip: "203.0.114.1" })).resolves.toMatchObject({ isBanned: false });
    await w.bans.lift(ban.id, root);
    await expect(w.actors.getActor({ ip: "203.0.113.77" })).resolves.toMatchObject({ isBanned: false });
  });

  test("un domeniu de email (`@domeniu` sau `*@domeniu`) banează orice adresă de pe el; validarea refuză valorile greșite", async () => {
    const root = await rootActor();
    const ban = await w.bans.ban({ type: "EMAIL", value: "*@Mail-Spam.ro", reason: "spam" }, root);
    expect(ban.value).toBe("@mail-spam.ro");
    await expect(w.bans.activeFor({ email: "oricine@mail-spam.ro" })).resolves.toMatchObject({ id: ban.id });
    await expect(w.bans.activeFor({ email: "oricine@mail.ro" })).resolves.toBeNull();
    await expect(w.bans.ban({ type: "IP", value: "203.0.113.0/40", reason: "x" }, root)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.bans.ban({ type: "EMAIL", value: "@nu-e-domeniu", reason: "x" }, root)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("lista din ACP: active / toate, pe tip, căutare; numele membrului și al celui care a banat", async () => {
    const root = await rootActor();
    const target = await w.createUser("Țintă", "member");
    const a = await w.bans.ban({ type: "ACCOUNT", value: target.id, userId: target.id, reason: "reclame" }, root);
    await w.bans.ban({ type: "IP", value: "198.51.100.9", reason: "boți" }, root);
    await w.bans.lift(a.id, root);
    const active = await w.bans.list({});
    expect(active.rows.map((r) => r.type)).toEqual(["IP"]);
    const all = await w.bans.list({ state: "all", type: "ACCOUNT" });
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({ user: { name: "Țintă" }, createdBy: { name: "Root" } });
    expect((await w.bans.list({ state: "all", q: "boți" })).rows).toHaveLength(1);
  });
});
