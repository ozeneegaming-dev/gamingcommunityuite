import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testKv } from "../../test/kv";
import type { GcsActor } from "../permissions/types";
import { GcsLoginLockout, IP_LOCK_FACTOR } from "./lockout";

const db = testDb();
const kv = testKv();
let values: Record<string, unknown> = {};
let ipLock = true;
const settings = { get: async <T,>(key: string): Promise<T> => (key in values ? values[key] : key.endsWith("max_attempts") ? 5 : 15) as T };
const lockout = new GcsLoginLockout({ db, kv, settings, ipLock: () => ipLock });
const admin: GcsActor = { userId: "admin-1", groupIds: [1], primaryGroupId: 1, isBanned: false, ip: "10.0.0.9" };

beforeEach(async () => {
  await truncateAll(db);
  await kv.flushAll();
  values = {};
  ipLock = true;
});

afterAll(async () => {
  await db.$disconnect();
});

async function fail(times: number, userId: string | null, ip: string | null) {
  let last = null;
  for (let i = 0; i < times; i++) last = await lockout.recordFailure({ userId, ip });
  return last;
}

describe("GcsLoginLockout", () => {
  test("a N-a parolă greșită blochează contul M minute, cu intrare în jurnal", async () => {
    values = { "security.login_max_attempts": 3, "security.login_lock_minutes": 20 };
    expect(await fail(2, "u1", "203.0.113.1")).toBeNull();
    expect(await lockout.status({ userId: "u1", ip: "203.0.113.1" })).toBeNull();

    const before = Date.now();
    const lock = await lockout.recordFailure({ userId: "u1", ip: "203.0.113.1" });
    expect(lock?.scope).toBe("account");
    expect(lock!.until.getTime() - before).toBeGreaterThanOrEqual(20 * 60_000 - 1000);
    expect(lock!.until.getTime() - before).toBeLessThanOrEqual(20 * 60_000 + 1000);

    // Blocat de pe orice IP, nu doar de pe cel cu încercările.
    await expect(lockout.status({ userId: "u1", ip: "198.51.100.7" })).resolves.toMatchObject({ scope: "account" });
    expect(await lockout.lockedUntil("u1")).not.toBeNull();
    const audit = await db.auditLog.findMany({ where: { action: "auth.login_locked" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ targetType: "user", targetId: "u1", ip: "203.0.113.1", after: { attempts: 3, minutes: 20 } });
  });

  test("blocarea expiră singură (data trecută = deblocat)", async () => {
    values = { "security.login_max_attempts": 1 };
    const lock = await lockout.recordFailure({ userId: "u1", ip: null });
    expect(lock).not.toBeNull();
    const later = new Date(lock!.until.getTime() + 1000);
    expect(await lockout.status({ userId: "u1", ip: null }, later)).toBeNull();
    expect(await lockout.lockedUntil("u1", later)).toBeNull();
  });

  test("o autentificare reușită uită încercările greșite", async () => {
    values = { "security.login_max_attempts": 3 };
    await fail(2, "u1", null);
    await lockout.recordSuccess("u1");
    expect(await fail(2, "u1", null)).toBeNull();
    expect(await lockout.status({ userId: "u1", ip: null })).toBeNull();
  });

  test("0 încercări = blocarea e oprită", async () => {
    values = { "security.login_max_attempts": 0 };
    expect(await fail(20, "u1", "203.0.113.1")).toBeNull();
    expect(await lockout.status({ userId: "u1", ip: "203.0.113.1" })).toBeNull();
  });

  test("IP-ul se blochează la de 3 ori mai multe încercări greșite (și pe emailuri necunoscute)", async () => {
    values = { "security.login_max_attempts": 2 };
    expect(await fail(2 * IP_LOCK_FACTOR - 1, null, "203.0.113.5")).toBeNull();
    const lock = await lockout.recordFailure({ userId: null, ip: "203.0.113.5" });
    expect(lock?.scope).toBe("ip");
    await expect(lockout.status({ userId: "alt-cont", ip: "203.0.113.5" })).resolves.toMatchObject({ scope: "ip" });
    expect(await lockout.status({ userId: "alt-cont", ip: "203.0.113.6" })).toBeNull();
  });

  test("blocarea pe IP se oprește odată cu rate limit-ul", async () => {
    values = { "security.login_max_attempts": 1 };
    ipLock = false;
    expect(await fail(10, null, "203.0.113.5")).toBeNull();
    expect(await lockout.status({ userId: null, ip: "203.0.113.5" })).toBeNull();
  });

  test("clear (parola resetată) uită blocarea și încercările contului, fără jurnal; blocarea IP-ului rămâne", async () => {
    values = { "security.login_max_attempts": 2 };
    await fail(2, "u1", "203.0.113.8");
    await fail(2 * IP_LOCK_FACTOR, null, "203.0.113.8");
    await expect(lockout.status({ userId: "u1", ip: null })).resolves.toMatchObject({ scope: "account" });
    await lockout.clear("u1");
    expect(await lockout.status({ userId: "u1", ip: null })).toBeNull();
    // Contorul a pornit de la zero: o singură parolă greșită nu blochează din nou.
    expect(await lockout.recordFailure({ userId: "u1", ip: null })).toBeNull();
    await expect(lockout.status({ userId: "u1", ip: "203.0.113.8" })).resolves.toMatchObject({ scope: "ip" });
    expect(await db.auditLog.count({ where: { action: "auth.login_unlocked" } })).toBe(0);
  });

  test("adminul deblochează contul (jurnal); a doua oară nu mai e nimic de deblocat", async () => {
    values = { "security.login_max_attempts": 1 };
    await lockout.recordFailure({ userId: "u1", ip: null });
    await expect(lockout.unlock(admin, "u1")).resolves.toBe(true);
    expect(await lockout.status({ userId: "u1", ip: null })).toBeNull();
    await expect(lockout.unlock(admin, "u1")).resolves.toBe(false);
    const audit = await db.auditLog.findMany({ where: { action: "auth.login_unlocked" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: "admin-1", targetId: "u1" });
  });
});
