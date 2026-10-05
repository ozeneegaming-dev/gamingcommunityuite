import { describe, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./passwords";

describe("parole Argon2id", () => {
  test("hash + verify", async () => {
    const hash = await hashPassword("x");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).toContain("m=19456,t=2,p=1");
    await expect(verifyPassword(hash, "x")).resolves.toBe(true);
    await expect(verifyPassword(hash, "y")).resolves.toBe(false);
  });

  test("un hash invalid întoarce false, fără excepție", async () => {
    await expect(verifyPassword("nu-e-hash", "x")).resolves.toBe(false);
  });
});
