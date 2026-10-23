import { sign, verify, type KeyObject } from "node:crypto";
import { ed25519PublicKey } from "../plugins/signature";

/**
 * Licența GCS (etapa 11, Redistribuire): un token semnat Ed25519, verificat OFFLINE cu cheia publică inclusă în release.
 *
 *   GCS1.<payload base64url>.<semnătura base64url>
 *
 * Mesajul semnat e `GCS-LICENSE-V1\n` + payload-ul (base64url, exact cum apare în token). Payload-ul (JSON) listează
 * licențiatul, domeniile, pachetul (standard), aplicațiile premium incluse și expirarea. Tokenul se ține doar pe server
 * (folderul de configurare, 0600), niciodată în browser după pasul „Licență”.
 */
export const GCS_LICENSE_PREFIX = "GCS1";
const SIGNED_HEADER = "GCS-LICENSE-V1\n";

/**
 * Cheile publice de licență incluse în release (`id` → cheia Ed25519 în base64, 32 de octeți). Goală în surse: build-ul
 * de release o completează cu `--license-pubkey` (cheia publică a proprietarului). Pe lângă ele, `GCS_LICENSE_TRUSTED_KEYS`.
 */
export const GCS_LICENSE_KEYS: Record<string, string> = {};

/** Tokenul de test al modului dev: acceptat doar când `NODE_ENV !== "production"`. */
export const GCS_DEV_LICENSE_TOKEN = "GCS-DEV-LICENSE";

export type GcsLicensePayload = {
  v: 1;
  /** Cheia cu care a fost semnată (din `GCS_LICENSE_KEYS` / `GCS_LICENSE_TRUSTED_KEYS`). */
  kid: string;
  /** Identificatorul licenței la platforma-mamă. */
  id: string;
  licensee: string;
  /** Domeniile permise: exact (`forum.exemplu.ro`, cu `www.` tolerat) sau `*.exemplu.ro` (orice subdomeniu). */
  domains: string[];
  package: "standard";
  /** Aplicațiile premium incluse (chei de modul, ex. `servers`, `chat_pro`). */
  apps: string[];
  issuedAt: string;
  /** ISO 8601 sau `null` (fără expirare). */
  expiresAt: string | null;
};

export type GcsLicense = GcsLicensePayload & { dev?: true };

export type GcsLicenseError = "missing" | "malformed" | "unknown_key" | "bad_signature" | "expired" | "domain" | "revoked";

export type GcsLicenseResult = { ok: true; license: GcsLicense } | { ok: false; error: GcsLicenseError };

const b64url = (buf: Buffer) => buf.toString("base64url");
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Semnează o licență (folosit de platforma-mamă și de teste, cu cheia lor). */
export function signLicense(payload: GcsLicensePayload, privateKey: KeyObject): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = sign(null, Buffer.from(SIGNED_HEADER + body, "utf8"), privateKey);
  return `${GCS_LICENSE_PREFIX}.${body}.${b64url(signature)}`;
}

/** Cheile de licență de încredere: cele incluse în release și cele din `GCS_LICENSE_TRUSTED_KEYS` (`id=base64,…`). */
export function licenseTrustedKeys(env: string | undefined = process.env.GCS_LICENSE_TRUSTED_KEYS): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  const add = (id: string, value: string) => {
    const key = KEY_ID.test(id) ? ed25519PublicKey(value) : null;
    if (key) keys.set(id, key);
  };
  for (const [id, value] of Object.entries(GCS_LICENSE_KEYS)) add(id, value);
  for (const part of (env ?? "").split(",")) {
    const at = part.indexOf("=");
    if (at > 0) add(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return keys;
}

/** Domeniul fără port, cu litere mici și fără punctul final. */
export function normalizeDomain(value: string): string {
  let host = value.trim().toLowerCase();
  if (/^[a-z]+:\/\//.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return "";
    }
  }
  return host.replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Domeniul site-ului se potrivește cu unul din domeniile licenței. */
export function licenseDomainMatches(domain: string, patterns: readonly string[]): boolean {
  const host = normalizeDomain(domain);
  if (!host) return false;
  return patterns.some((raw) => {
    const p = normalizeDomain(raw);
    if (!p) return false;
    if (p.startsWith("*.")) {
      const base = p.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    return host === p || host === `www.${p}`;
  });
}

function isPayload(v: unknown): v is GcsLicensePayload {
  const p = v as Partial<GcsLicensePayload> | null;
  return (
    !!p &&
    p.v === 1 &&
    typeof p.kid === "string" &&
    typeof p.id === "string" &&
    typeof p.licensee === "string" &&
    Array.isArray(p.domains) &&
    p.domains.every((d) => typeof d === "string") &&
    p.package === "standard" &&
    Array.isArray(p.apps) &&
    p.apps.every((a) => typeof a === "string") &&
    typeof p.issuedAt === "string" &&
    (p.expiresAt === null || (typeof p.expiresAt === "string" && !Number.isNaN(Date.parse(p.expiresAt))))
  );
}

export type GcsLicenseVerifyOptions = {
  /** Domeniul site-ului (din `GCS_DOMAIN` / `GCS_BASE_URL`). */
  domain: string;
  /** Aplicațiile premium cunoscute (licența de test le primește pe toate). */
  premiumApps?: readonly string[];
  now?: Date;
  trusted?: ReadonlyMap<string, KeyObject>;
  /** Producția nu acceptă tokenul de test. Implicit: `NODE_ENV === "production"`. */
  production?: boolean;
};

/**
 * Verifică OFFLINE o licență: formatul, semnătura (cheie de încredere), expirarea și domeniul.
 * În afara producției, `GCS-DEV-LICENSE` dă o licență de test cu toate aplicațiile premium, pe orice domeniu.
 */
export function verifyLicense(token: string | null | undefined, opts: GcsLicenseVerifyOptions): GcsLicenseResult {
  const raw = (token ?? "").trim();
  if (!raw) return { ok: false, error: "missing" };
  const production = opts.production ?? process.env.NODE_ENV === "production";
  if (raw === GCS_DEV_LICENSE_TOKEN) {
    if (production) return { ok: false, error: "malformed" };
    return {
      ok: true,
      license: {
        v: 1,
        kid: "dev",
        id: "dev",
        licensee: "Dev / test",
        domains: ["*"],
        package: "standard",
        apps: [...(opts.premiumApps ?? [])],
        issuedAt: new Date(0).toISOString(),
        expiresAt: null,
        dev: true,
      },
    };
  }
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== GCS_LICENSE_PREFIX || !parts[1] || !parts[2]) return { ok: false, error: "malformed" };
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (!isPayload(payload)) return { ok: false, error: "malformed" };
  const key = (opts.trusted ?? licenseTrustedKeys()).get(payload.kid);
  if (!key) return { ok: false, error: "unknown_key" };
  const signature = Buffer.from(parts[2], "base64url");
  if (signature.length !== 64 || !verify(null, Buffer.from(SIGNED_HEADER + parts[1], "utf8"), key, signature)) {
    return { ok: false, error: "bad_signature" };
  }
  const now = opts.now ?? new Date();
  if (payload.expiresAt !== null && Date.parse(payload.expiresAt) <= now.getTime()) return { ok: false, error: "expired" };
  if (!licenseDomainMatches(opts.domain, payload.domains)) return { ok: false, error: "domain" };
  return { ok: true, license: payload };
}

/** Licența include aplicația premium (sau e licența de test). */
export const licenseIncludesApp = (license: Pick<GcsLicense, "apps">, appKey: string) => license.apps.includes(appKey);

export type GcsLicenseOnlineResult = { status: "disabled" | "valid" | "revoked" | "unreachable" };

/**
 * Verificarea ONLINE, opțională, la platforma-mamă (`GCS_LICENSE_SERVER`; dezactivată când e gol):
 * `POST <server>/api/license/verify` cu `{ token, domain }` → `{ valid: boolean }`. O licență revocată blochează;
 * un server indisponibil nu blochează (verificarea offline e suficientă).
 */
export async function checkLicenseOnline(
  token: string,
  opts: { domain: string; server?: string | undefined; fetch?: typeof fetch; timeoutMs?: number },
): Promise<GcsLicenseOnlineResult> {
  const server = (opts.server ?? process.env.GCS_LICENSE_SERVER ?? "").trim();
  if (!server) return { status: "disabled" };
  const doFetch = opts.fetch ?? fetch;
  try {
    const res = await doFetch(new URL("/api/license/verify", server), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, domain: normalizeDomain(opts.domain) }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) return { status: "unreachable" };
    const body = (await res.json().catch(() => null)) as { valid?: unknown } | null;
    if (body?.valid === true) return { status: "valid" };
    if (body?.valid === false) return { status: "revoked" };
    return { status: "unreachable" };
  } catch {
    return { status: "unreachable" };
  }
}

/** Domeniul instalării: `GCS_DOMAIN`, altfel host-ul din `GCS_BASE_URL`. */
export function installDomain(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GCS_DOMAIN) return normalizeDomain(env.GCS_DOMAIN);
  return env.GCS_BASE_URL ? normalizeDomain(env.GCS_BASE_URL) : "";
}
