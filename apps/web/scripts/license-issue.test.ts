import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyLicense } from "@gcs/core";
import { afterAll, describe, expect, test } from "vitest";
import { issueLicense, parseIssueArgs } from "../../../scripts/license-issue.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "gcs-license-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** O pereche de chei de test, generată aici (cheia privată în fișier, ca a proprietarului). */
function testKey(): { keyFile: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyFile = path.join(tmp, `key-${Math.random().toString(36).slice(2)}.pem`);
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  return { keyFile, publicKey };
}
const NOW = new Date("2026-10-23T12:00:00Z");

describe("emiterea unei licențe (pnpm license:issue)", () => {
  test("licența emisă trece verificarea installer-ului: licențiatul, domeniile, aplicațiile premium, expirarea", () => {
    const { keyFile, publicKey } = testKey();
    const { token, license } = issueLicense({ key: keyFile, keyId: "gcs-lic-2026", licensee: "Comunitatea X SRL", domains: ["forum.x.ro", "*.x.ro"], apps: ["servers", "chat_pro"], expires: "2027-10-23", now: NOW });
    expect(token.startsWith("GCS1.")).toBe(true);
    expect(license).toMatchObject({ kid: "gcs-lic-2026", licensee: "Comunitatea X SRL", domains: ["forum.x.ro", "*.x.ro"], apps: ["servers", "chat_pro"], package: "standard", expiresAt: "2027-10-23T23:59:59.000Z" });
    const trusted = new Map([["gcs-lic-2026", publicKey]]);
    const ok = verifyLicense(token, { domain: "forum.x.ro", trusted, now: NOW, production: true });
    expect(ok).toMatchObject({ ok: true, license: { apps: ["servers", "chat_pro"] } });
    expect(verifyLicense(token, { domain: "alt.x.ro", trusted, now: NOW, production: true })).toMatchObject({ ok: true });
    expect(verifyLicense(token, { domain: "alt-forum.ro", trusted, now: NOW, production: true })).toEqual({ ok: false, error: "domain" });
    expect(verifyLicense(token, { domain: "forum.x.ro", trusted, now: new Date("2027-10-24T00:00:01Z"), production: true })).toEqual({ ok: false, error: "expired" });
  });

  test("fără expirare („never”), fără aplicații premium; id-ul generat e unic", () => {
    const { keyFile } = testKey();
    const a = issueLicense({ key: keyFile, keyId: "k", licensee: "A", domains: ["a.ro"], expires: "never", now: NOW });
    const b = issueLicense({ key: keyFile, keyId: "k", licensee: "A", domains: ["a.ro"], expires: "never", now: NOW });
    expect(a.license).toMatchObject({ expiresAt: null, apps: [] });
    expect(a.license.id).not.toBe(b.license.id);
  });

  test("datele greșite sunt refuzate înainte de semnare", () => {
    const { keyFile } = testKey();
    const base = { key: keyFile, keyId: "gcs-lic-2026", licensee: "X", domains: ["x.ro"], now: NOW };
    expect(() => issueLicense({ ...base, licensee: " " })).toThrow(/licențiatul/);
    expect(() => issueLicense({ ...base, domains: [] })).toThrow(/domeniu/);
    expect(() => issueLicense({ ...base, domains: ["https://x.ro/forum"] })).toThrow(/domeniu invalid/);
    expect(() => issueLicense({ ...base, apps: ["teleport"] })).toThrow(/aplicație premium necunoscută/);
    expect(() => issueLicense({ ...base, expires: "2026-01-01" })).toThrow(/expirarea/);
    expect(() => issueLicense({ ...base, expires: "mâine" })).toThrow(/expirarea/);
    expect(() => issueLicense({ ...base, keyId: "x y" })).toThrow(/key-id/);
    expect(() => issueLicense({ ...base, key: path.join(tmp, "nu-exista.pem") })).toThrow(/--key/);
  });

  test("argumentele din linia de comandă (domenii și aplicații repetate sau cu virgulă)", () => {
    expect(parseIssueArgs(["--key", "k.pem", "--licensee", "Comunitatea X", "--domain", "a.ro", "--domain", "*.b.ro", "--apps", "servers,chat_pro", "--expires", "never", "--out", "lic.txt"])).toEqual({
      key: "k.pem",
      keyId: "gcs-lic-2026",
      licensee: "Comunitatea X",
      domains: ["a.ro", "*.b.ro"],
      apps: ["servers", "chat_pro"],
      expires: "never",
      out: "lic.txt",
    });
  });
});
