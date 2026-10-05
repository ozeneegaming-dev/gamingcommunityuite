import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsNotFound } from "../errors";
import { resetRootPassword } from "./adminReset";
import { hashPassword, verifyPassword } from "./passwords";

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("resetRootPassword (gcs reset-admin-password)", () => {
  test("pe un user care nu e Root Admin → GcsForbidden (not_root)", async () => {
    await w.createUser("Krypt", "admin");
    const error = await resetRootPassword(w.db, "Krypt").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GcsForbidden);
    expect((error as GcsForbidden).params).toEqual({ reason: "not_root" });
  });

  test("un nume inexistent → GcsNotFound", async () => {
    await expect(resetRootPassword(w.db, "Nimeni")).rejects.toBeInstanceOf(GcsNotFound);
  });

  test("pe un Root Admin: parolă nouă de 20 de caractere, 2FA dezactivat, sesiunile șterse", async () => {
    const root = await w.createUser("Ștefan", "root_admin");
    await w.db.account.create({ data: { userId: root.id, accountId: root.id, providerId: "credential", password: await hashPassword("veche-parola-1") } });
    await w.db.user.update({ where: { id: root.id }, data: { twoFactorEnabled: true } });
    await w.db.twoFactor.create({ data: { userId: root.id, secret: "s", backupCodes: "b" } });
    await w.db.session.create({ data: { token: "t1", userId: root.id, expiresAt: new Date(Date.now() + 3_600_000) } });

    // Numele se caută fără diacritice și fără majuscule.
    const password = await resetRootPassword(w.db, "stefan");
    expect(password).toHaveLength(20);

    const account = await w.db.account.findFirstOrThrow({ where: { userId: root.id, providerId: "credential" } });
    await expect(verifyPassword(account.password!, password)).resolves.toBe(true);
    await expect(verifyPassword(account.password!, "veche-parola-1")).resolves.toBe(false);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: root.id } })).twoFactorEnabled).toBe(false);
    expect(await w.db.twoFactor.count({ where: { userId: root.id } })).toBe(0);
    expect(await w.db.session.count({ where: { userId: root.id } })).toBe(0);
    expect(await w.db.auditLog.count({ where: { action: "user.password_reset", targetId: root.id } })).toBe(1);
  });

  test("un Root Admin fără parolă (doar Discord/Steam) primește un cont cu parolă", async () => {
    const root = await w.createUser("Fondator", "admin", ["root_admin"]);
    const password = await resetRootPassword(w.db, "Fondator");
    const account = await w.db.account.findFirstOrThrow({ where: { userId: root.id, providerId: "credential" } });
    await expect(verifyPassword(account.password!, password)).resolves.toBe(true);
  });
});
