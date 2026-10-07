import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { isLegacyPasswordHash, legacyPasswordHash, verifyLegacyPassword } from "./legacyPasswords";
import { upgradeLegacyPassword, verifyPassword } from "./passwords";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const sha1 = (s: string) => createHash("sha1").update(s, "utf8").digest("hex");

describe("hash-urile importate (formatele vechi, marcate)", () => {
  test("bcrypt: $2y$ (PHP), $2a$ și $2b$", async () => {
    const native = bcrypt.hashSync("parola-veche", 4);
    for (const variant of ["$2y$", "$2a$", "$2b$"]) {
      const stored = legacyPasswordHash({ scheme: "bcrypt", hash: variant + native.slice(4) });
      expect(stored.startsWith("legacy-bcrypt$")).toBe(true);
      await expect(verifyLegacyPassword(stored, "parola-veche")).resolves.toBe(true);
      await expect(verifyLegacyPassword(stored, "alta")).resolves.toBe(false);
    }
  });

  test("md5 cu sare: md5(md5(sare) . md5(parolă)), sarea poate conține `$`", async () => {
    const salt = "a$b!c";
    const stored = legacyPasswordHash({ scheme: "md5s", salt, hash: md5(md5(salt) + md5("secret123")) });
    await expect(verifyLegacyPassword(stored, "secret123")).resolves.toBe(true);
    await expect(verifyLegacyPassword(stored, "secret124")).resolves.toBe(false);
  });

  test("md5 cu sare: și varianta cu caracterele speciale escapate de platforma veche", async () => {
    const salt = "x1y2z";
    const escaped = "p&amp;&#036;&#33;&lt;&gt;&quot;&#39;&#092;";
    const stored = legacyPasswordHash({ scheme: "md5s", salt, hash: md5(md5(salt) + md5(escaped)) });
    await expect(verifyLegacyPassword(stored, "p&$!<>\"'\\")).resolves.toBe(true);
  });

  test("sha256 și sha1 cu sare: hash(hash(parolă) . sare)", async () => {
    const salt = sha256("sare");
    const s256 = legacyPasswordHash({ scheme: "sha256s", salt, hash: sha256(sha256("ParolaMea") + salt) });
    const s1 = legacyPasswordHash({ scheme: "sha1s", salt, hash: sha1(sha1("ParolaMea") + salt) });
    await expect(verifyLegacyPassword(s256, "ParolaMea")).resolves.toBe(true);
    await expect(verifyLegacyPassword(s256, "parolamea")).resolves.toBe(false);
    await expect(verifyLegacyPassword(s1, "ParolaMea")).resolves.toBe(true);
  });

  test("formatele invalide întorc false; doar hash-urile marcate sunt „vechi”", async () => {
    for (const bad of ["legacy-bcrypt$nu", "legacy-md5s$$", "legacy-sha256s$YQ$zz", "legacy-necunoscut$x", "legacy-"]) {
      await expect(verifyLegacyPassword(bad, "x")).resolves.toBe(false);
    }
    expect(isLegacyPasswordHash("legacy-md5s$YQ$" + md5("x"))).toBe(true);
    expect(isLegacyPasswordHash("$argon2id$v=19$m=19456")).toBe(false);
    expect(() => legacyPasswordHash({ scheme: "md5s", hash: "nu-e-hex", salt: "s" })).toThrow();
    expect(() => legacyPasswordHash({ scheme: "bcrypt", hash: "$1$abc" })).toThrow();
  });

  test("verifyPassword recunoaște prefixele (login-ul și reautentificarea ACP)", async () => {
    const stored = legacyPasswordHash({ scheme: "sha1s", salt: "s", hash: sha1(sha1("pw") + "s") });
    await expect(verifyPassword(stored, "pw")).resolves.toBe(true);
    await expect(verifyPassword(stored, "px")).resolves.toBe(false);
  });
});

describe("rehash la prima autentificare reușită", () => {
  let w: GcsTestWorld;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w.db.$disconnect();
    w.redis.disconnect();
  });

  test("hash-ul vechi devine Argon2id, iar parola rămâne aceeași", async () => {
    const user = await w.createUser("Importat", "member");
    const stored = legacyPasswordHash({ scheme: "sha256s", salt: "abc", hash: sha256(sha256("vechea-parola") + "abc") });
    await w.db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: stored } });

    expect(await upgradeLegacyPassword(w.db, stored, "vechea-parola")).toBe(1);
    const account = await w.db.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.password!.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(account.password!, "vechea-parola")).resolves.toBe(true);
    // Un hash care nu e vechi nu se atinge.
    expect(await upgradeLegacyPassword(w.db, account.password!, "vechea-parola")).toBe(0);
  });
});
