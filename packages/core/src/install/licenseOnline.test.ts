import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { signLicense, type GcsLicenseOnlineResult, type GcsLicensePayload } from "./license";
import { GCS_LICENSE_GRACE_DAYS, GcsLicenseOnline } from "./licenseOnline";
import { GcsInstallState } from "./state";

// O cheie de unică folosință, ca a Data Center-ului (niciodată cheia reală).
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ format: "der", type: "spki" });
const PUB = Buffer.from(spki.subarray(spki.length - 32)).toString("base64");
const env = { GCS_LICENSE_TRUSTED_KEYS: `gcs-lic-dc-2026=${PUB}`, GCS_DOMAIN: "forum.exemplu.ro" };

const payload = (over: Partial<GcsLicensePayload> = {}): GcsLicensePayload => ({
  v: 1,
  kid: "gcs-lic-dc-2026",
  id: "dc-7",
  licensee: "Comunitatea Test",
  domains: ["forum.exemplu.ro"],
  package: "standard",
  apps: ["servers"],
  issuedAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2099-10-01T00:00:00.000Z",
  ...over,
});

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function setup(token: string, replies: GcsLicenseOnlineResult[]) {
  const configDir = mkdtempSync(path.join(os.tmpdir(), "gcs-licence-online-"));
  dirs.push(configDir);
  const state = new GcsInstallState(configDir);
  await state.saveLicense(token);
  let clock = Date.parse("2026-10-24T03:37:00Z");
  const check = vi.fn(async () => replies.shift() ?? { status: "unreachable" as const });
  const prevEnv = { ...process.env };
  Object.assign(process.env, env);
  const online = new GcsLicenseOnline({ configDir, state, version: "1.0.0", edition: "lite", check, now: () => clock, env: { ...process.env, ...env } });
  return {
    online,
    state,
    check,
    advanceDays: (days: number) => {
      clock += days * 86_400_000;
    },
    restoreEnv: () => {
      for (const k of Object.keys(env)) if (prevEnv[k] === undefined) delete process.env[k];
    },
  };
}

describe("verificarea zilnică a licenței la Data Center", () => {
  test("validă cu un token nou (prelungire): tokenul se preia, după verificarea offline", async () => {
    const token = signLicense(payload(), privateKey);
    const renewed = signLicense(payload({ expiresAt: "2100-10-01T00:00:00.000Z" }), privateKey);
    const s = await setup(token, [{ status: "valid", token: renewed }]);
    const next = await s.online.run();
    expect(next).toMatchObject({ status: "valid", invalidSince: null });
    expect(next?.tokenUpdatedAt).not.toBeNull();
    expect(await s.state.readLicense()).toBe(renewed);
    expect(s.check).toHaveBeenCalledWith(token, expect.objectContaining({ domain: "forum.exemplu.ro", server: "https://client.gamingcommunitysuite.com", version: "1.0.0", edition: "lite", instanceUuid: expect.any(String) }));
    s.restoreEnv();
  });

  test("un token trimis de server, dar invalid pentru domeniu (sau falsificat), nu înlocuiește licența", async () => {
    const token = signLicense(payload(), privateKey);
    const other = signLicense(payload({ domains: ["alt.ro"] }), privateKey);
    const s = await setup(token, [{ status: "valid", token: other }]);
    await s.online.run();
    expect(await s.state.readLicense()).toBe(token);
    s.restoreEnv();
  });

  test("invalidă: avertisment 30 de zile, apoi aplicațiile premium se opresc; Data Center indisponibil nu schimbă nimic", async () => {
    const token = signLicense(payload(), privateKey);
    const s = await setup(token, [{ status: "revoked", reason: "suspended" }, { status: "unreachable" }, { status: "revoked", reason: "suspended" }, { status: "valid" }]);
    const first = await s.online.run();
    expect(first).toMatchObject({ status: "suspended" });
    expect(s.online.graceEndsAt(first)?.toISOString()).toBe("2026-11-23T03:37:00.000Z");
    expect(await s.online.premiumBlocked()).toBe(false);

    s.advanceDays(10);
    const down = await s.online.run();
    expect(down).toMatchObject({ status: "suspended", invalidSince: first!.invalidSince });

    s.advanceDays(GCS_LICENSE_GRACE_DAYS - 10);
    await s.online.run();
    expect(await s.online.premiumBlocked()).toBe(true);

    // Reînnoită: aplicațiile premium repornesc la verificarea următoare.
    s.advanceDays(1);
    expect(await s.online.run()).toMatchObject({ status: "valid", invalidSince: null });
    expect(await s.online.premiumBlocked()).toBe(false);
    s.restoreEnv();
  });

  test("licențele emise offline (altă cheie) și cea de test nu se verifică online", async () => {
    const offline = signLicense(payload({ kid: "gcs-lic-2026" }), privateKey);
    const s = await setup(offline, [{ status: "revoked" }]);
    expect(await s.online.run()).toMatchObject({ status: "disabled", invalidSince: null });
    expect(s.check).not.toHaveBeenCalled();
    s.restoreEnv();
  });

  test("același uuid al instanței la fiecare verificare", async () => {
    const token = signLicense(payload(), privateKey);
    const s = await setup(token, [{ status: "valid" }, { status: "valid" }]);
    const a = await s.online.run();
    const b = await s.online.run();
    expect(a?.instanceUuid).toBe(b?.instanceUuid);
    s.restoreEnv();
  });
});
