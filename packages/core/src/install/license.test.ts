import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
  checkLicenseOnline,
  GCS_DEV_LICENSE_TOKEN,
  installDomain,
  licenseDomainMatches,
  licenseIncludesApp,
  licenseServerFor,
  GCS_LICENSE_SERVER_DEFAULT,
  licenseTrustedKeys,
  signLicense,
  verifyLicense,
  type GcsLicensePayload,
} from "./license";

// O cheie de unică folosință, generată în test (niciodată cheia reală de semnare).
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ format: "der", type: "spki" });
const PUB = Buffer.from(spki.subarray(spki.length - 32)).toString("base64");
const trusted = licenseTrustedKeys(`test=${PUB}`);

const payload = (over: Partial<GcsLicensePayload> = {}): GcsLicensePayload => ({
  v: 1,
  kid: "test",
  id: "lic-1",
  licensee: "Comunitatea Test",
  domains: ["forum.exemplu.ro"],
  package: "standard",
  apps: ["servers"],
  issuedAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2027-10-01T00:00:00.000Z",
  ...over,
});
const now = new Date("2026-10-17T12:00:00Z");
const opts = { domain: "forum.exemplu.ro", now, trusted, production: true };

describe("licența GCS (token Ed25519, verificare offline)", () => {
  test("o licență validă trece și listează aplicațiile premium", () => {
    const result = verifyLicense(signLicense(payload(), privateKey), opts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.license.licensee).toBe("Comunitatea Test");
    expect(licenseIncludesApp(result.license, "servers")).toBe(true);
  });

  test("lipsă de aplicație: o aplicație premium neinclusă nu e permisă", () => {
    const result = verifyLicense(signLicense(payload({ apps: [] }), privateKey), opts);
    expect(result.ok && licenseIncludesApp(result.license, "chat_pro")).toBe(false);
  });

  test("expirată → expired; fără expirare → validă", () => {
    expect(verifyLicense(signLicense(payload({ expiresAt: "2026-10-16T00:00:00Z" }), privateKey), opts)).toEqual({ ok: false, error: "expired" });
    expect(verifyLicense(signLicense(payload({ expiresAt: null }), privateKey), opts).ok).toBe(true);
  });

  test("domeniu greșit → domain; www. și wildcard se potrivesc", () => {
    const token = signLicense(payload(), privateKey);
    expect(verifyLicense(token, { ...opts, domain: "alt-site.ro" })).toEqual({ ok: false, error: "domain" });
    expect(verifyLicense(token, { ...opts, domain: "https://www.forum.exemplu.ro:443/x" }).ok).toBe(true);
    expect(licenseDomainMatches("a.b.exemplu.ro", ["*.exemplu.ro"])).toBe(true);
    expect(licenseDomainMatches("exemplu.ro.evil.com", ["*.exemplu.ro"])).toBe(false);
    expect(licenseDomainMatches("evilforum.exemplu.ro", ["forum.exemplu.ro"])).toBe(false);
  });

  test("modificată după semnare → bad_signature", () => {
    const token = signLicense(payload(), privateKey);
    const [prefix, body, sig] = token.split(".");
    const forged = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as GcsLicensePayload;
    forged.apps = ["servers", "chat_pro"];
    const tampered = `${prefix}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    expect(verifyLicense(tampered, opts)).toEqual({ ok: false, error: "bad_signature" });
  });

  test("altă cheie / format stricat / gol", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    expect(verifyLicense(signLicense(payload(), other), opts)).toEqual({ ok: false, error: "bad_signature" });
    expect(verifyLicense(signLicense(payload({ kid: "necunoscut" }), privateKey), opts)).toEqual({ ok: false, error: "unknown_key" });
    expect(verifyLicense("GCS1.abc", opts)).toEqual({ ok: false, error: "malformed" });
    expect(verifyLicense("ceva oarecare", opts)).toEqual({ ok: false, error: "malformed" });
    expect(verifyLicense("  ", opts)).toEqual({ ok: false, error: "missing" });
  });

  test("licența de test: doar în afara producției, cu toate aplicațiile premium", () => {
    expect(verifyLicense(GCS_DEV_LICENSE_TOKEN, opts).ok).toBe(false);
    const dev = verifyLicense(GCS_DEV_LICENSE_TOKEN, { ...opts, production: false, premiumApps: ["servers", "chat_pro"] });
    expect(dev.ok && dev.license.dev && dev.license.apps).toEqual(["servers", "chat_pro"]);
  });

  test("domeniul instalării: GCS_DOMAIN, altfel GCS_BASE_URL", () => {
    expect(installDomain({ GCS_DOMAIN: "Forum.Exemplu.ro" })).toBe("forum.exemplu.ro");
    expect(installDomain({ GCS_BASE_URL: "http://localhost:3101" })).toBe("localhost");
  });
});

describe("verificarea online (platforma-mamă, simulată)", () => {
  test("dezactivată când GCS_LICENSE_SERVER e gol", async () => {
    const fetchMock = vi.fn();
    expect(await checkLicenseOnline("t", { domain: "x.ro", server: "", fetch: fetchMock })).toEqual({ status: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("validă / revocată / indisponibilă", async () => {
    const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
    const server = "https://licente.exemplu.test";
    const valid = reply({ valid: true });
    expect(await checkLicenseOnline("t", { domain: "https://x.ro", server, fetch: valid })).toEqual({ status: "valid" });
    expect(valid).toHaveBeenCalledWith(new URL("/api/license/verify", server), expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "t", domain: "x.ro" }) }));
    expect(await checkLicenseOnline("t", { domain: "x.ro", server, fetch: reply({ valid: false }) })).toEqual({ status: "revoked" });
    expect(await checkLicenseOnline("t", { domain: "x.ro", server, fetch: reply({}, 500) })).toEqual({ status: "unreachable" });
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await checkLicenseOnline("t", { domain: "x.ro", server, fetch: down })).toEqual({ status: "unreachable" });
  });
});

describe("Data Center-ul (licențele emise de el)", () => {
  const dcToken = signLicense(payload({ kid: "gcs-lic-dc-2026", id: "dc-7" }), privateKey);
  const offlineToken = signLicense(payload({ kid: "gcs-lic-2026" }), privateKey);

  test("serverul: implicit doar pentru cheile Data Center-ului; GCS_LICENSE_SERVER îl schimbă sau îl oprește (off)", () => {
    expect(licenseServerFor(dcToken, {})).toBe(GCS_LICENSE_SERVER_DEFAULT);
    expect(licenseServerFor(offlineToken, {})).toBe("");
    expect(licenseServerFor("GCS-DEV-LICENSE", {})).toBe("");
    expect(licenseServerFor(dcToken, { GCS_LICENSE_SERVER: "off" })).toBe("");
    expect(licenseServerFor(offlineToken, { GCS_LICENSE_SERVER: "https://alt.test" })).toBe("https://alt.test");
  });

  test("cererea: instanța, versiunea, ediția; răspunsul: motivul invalidității și tokenul nou", async () => {
    const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const server = "https://dc.exemplu.test";
    const fresh = signLicense(payload({ kid: "gcs-lic-dc-2026", id: "dc-7", expiresAt: "2028-10-01T00:00:00.000Z" }), privateKey);
    const valid = reply({ valid: true, status: "active", token: fresh });
    expect(await checkLicenseOnline(dcToken, { domain: "forum.exemplu.ro", server, fetch: valid, instanceUuid: "inst-1", version: "1.2.0", edition: "lite" })).toEqual({ status: "valid", token: fresh });
    expect(valid).toHaveBeenCalledWith(
      new URL("/api/license/verify", server),
      expect.objectContaining({ body: JSON.stringify({ token: dcToken, domain: "forum.exemplu.ro", instance_uuid: "inst-1", version: "1.2.0", edition: "lite" }) }),
    );
    expect(await checkLicenseOnline(dcToken, { domain: "x.ro", server, fetch: reply({ valid: false, status: "suspended" }) })).toEqual({ status: "revoked", reason: "suspended" });
    // Un „token” care nu e o licență GCS e ignorat.
    expect(await checkLicenseOnline(dcToken, { domain: "x.ro", server, fetch: reply({ valid: true, token: "<html>" }) })).toEqual({ status: "valid" });
  });
});
