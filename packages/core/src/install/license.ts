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
 *
 * Clientul primește de obicei o cheie scurtă (`GCS-7KQ4-M2XD-9PRH`, vezi `normalizeLicenseKey`): installerul și ACP-ul
 * o schimbă la Data Center pe tokenul semnat (`activateLicenseKey`). Tokenul lung rămâne acceptat (licențe offline).
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

export type GcsLicenseOnlineResult = {
  status: "disabled" | "valid" | "revoked" | "unreachable";
  /** Motivul unei licențe invalide, cum îl dă Data Center-ul (ex. `suspended`, `revoked`, `expired`, `domain`). */
  reason?: string;
  /** Un token mai nou al aceleiași licențe (ex. după o prelungire), de verificat offline înainte de păstrare. */
  token?: string;
};

/** Platforma-mamă (Data Center-ul): verifică licențele emise de ea (cheile `gcs-lic-dc-*`). */
export const GCS_LICENSE_SERVER_DEFAULT = "https://client.gamingcommunitysuite.com";

/** Cheia cu care e semnat tokenul (fără verificare: doar pentru alegerea serverului). */
function tokenKeyId(token: string): string | null {
  const body = token.trim().split(".")[1];
  if (!body) return null;
  try {
    const kid = (JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { kid?: unknown }).kid;
    return typeof kid === "string" ? kid : null;
  } catch {
    return null;
  }
}

/**
 * Serverul verificării online: `GCS_LICENSE_SERVER` (`off` o oprește), altfel Data Center-ul pentru licențele emise de
 * el (cheile `gcs-lic-dc-*`); licențele emise offline de proprietar nu au o evidență online (`""` = fără verificare).
 */
export function licenseServerFor(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.GCS_LICENSE_SERVER ?? "").trim();
  if (configured === "off") return "";
  if (configured) return configured;
  return tokenKeyId(token)?.startsWith("gcs-lic-dc-") ? GCS_LICENSE_SERVER_DEFAULT : "";
}

/**
 * Verificarea ONLINE la platforma-mamă (vezi `licenseServerFor`): `POST <server>/api/license/verify` cu
 * `{ token, domain, instance_uuid?, version?, edition? }` → `{ valid, status?, token? }`. O licență invalidă e
 * `revoked` (cu motivul în `reason`); un server indisponibil nu blochează (verificarea offline e suficientă).
 */
export async function checkLicenseOnline(
  token: string,
  opts: {
    domain: string;
    server?: string | undefined;
    fetch?: typeof fetch;
    timeoutMs?: number;
    instanceUuid?: string;
    version?: string;
    edition?: string;
  },
): Promise<GcsLicenseOnlineResult> {
  const server = (opts.server ?? licenseServerFor(token)).trim();
  if (!server) return { status: "disabled" };
  const doFetch = opts.fetch ?? fetch;
  try {
    const res = await doFetch(new URL("/api/license/verify", server), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        domain: normalizeDomain(opts.domain),
        ...(opts.instanceUuid ? { instance_uuid: opts.instanceUuid } : {}),
        ...(opts.version ? { version: opts.version } : {}),
        ...(opts.edition ? { edition: opts.edition } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) return { status: "unreachable" };
    const body = (await res.json().catch(() => null)) as { valid?: unknown; status?: unknown; token?: unknown } | null;
    const fresh = typeof body?.token === "string" && body.token.startsWith(`${GCS_LICENSE_PREFIX}.`) ? { token: body.token } : {};
    if (body?.valid === true) return { status: "valid", ...fresh };
    if (body?.valid === false) return { status: "revoked", ...(typeof body.status === "string" ? { reason: body.status.slice(0, 32) } : {}) };
    return { status: "unreachable" };
  } catch {
    return { status: "unreachable" };
  }
}

// ─── Cheia scurtă (`GCS-7KQ4-M2XD-9PRH`), schimbată la Data Center pe tokenul semnat ───────────────────────────────

/** Alfabetul cheilor scurte ale Data Center-ului (`LicenseEngine::generateRawKey`): fără 0 / O / 1 / I. */
export const GCS_LICENSE_KEY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const KEY_BODY = new RegExp(`^[${GCS_LICENSE_KEY_ALPHABET}]+$`);

/**
 * Forma canonică a unei chei scurte (cum o hash-uiește Data Center-ul): `GCS-XXXX-XXXX-XXXX` (12 caractere) sau
 * formatul vechi `GCS-XXXXX-XXXXX-XXXXX-XXXXX` (20). Acceptă litere mici, spații, fără cratime și fără prefixul `GCS`;
 * `null` dacă nu e o cheie scurtă (ex. un token `GCS1.…`).
 */
export function normalizeLicenseKey(value: string | null | undefined): string | null {
  const compact = (value ?? "").replace(/[\s-]+/g, "").toUpperCase();
  const rest = compact.startsWith("GCS") ? compact.slice(3) : "";
  const body = rest.length === 12 || rest.length === 20 ? rest : compact.length === 12 || compact.length === 20 ? compact : "";
  if (!body || !KEY_BODY.test(body)) return null;
  const size = body.length === 12 ? 4 : 5;
  return ["GCS", ...(body.match(new RegExp(`.{${size}}`, "g")) ?? [])].join("-");
}

/** Cheia mascată, ca în panoul Data Center-ului: `GCS-7KQ4-****-****`. */
export function maskLicenseKey(key: string): string {
  const [prefix, first, ...rest] = key.split("-");
  return [prefix, first, ...rest.map((part) => "*".repeat(part.length))].join("-");
}

export type GcsLicenseActivationError =
  | "format"
  | "invalid_key"
  | "revoked"
  | "suspended"
  | "expired"
  | "blocked"
  | "domain"
  | "bad_domain"
  | "rate_limited"
  | "unreachable"
  | "disabled"
  | "invalid_token";

export type GcsLicenseActivationResult = { ok: true; token: string } | { ok: false; error: GcsLicenseActivationError };

const ACTIVATION_ERRORS: readonly string[] = ["invalid_key", "revoked", "suspended", "expired", "blocked", "domain", "rate_limited"];

/** Serverul activării cheilor scurte: `GCS_LICENSE_SERVER` (`off` = fără activare online), altfel Data Center-ul. */
export function licenseActivationServer(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.GCS_LICENSE_SERVER ?? "").trim();
  if (configured === "off") return "";
  return configured || GCS_LICENSE_SERVER_DEFAULT;
}

/**
 * Activarea unei chei scurte la Data Center: `POST <server>/api/license/activate` cu
 * `{ key, domain, instance_uuid?, version?, edition?, files_sha256? }` → `{ ok: true, token }` sau `{ ok: false, error }`. Data
 * Center-ul verifică cheia (doar hash-ul ei e la el), statusul, expirarea și domeniul (prima activare îl fixează) și
 * întoarce tokenul GCS1 semnat, pe care aplicația îl verifică apoi offline ca pe orice token.
 */
export async function activateLicenseKey(
  key: string,
  opts: {
    domain: string;
    server?: string | undefined;
    fetch?: typeof fetch;
    timeoutMs?: number;
    instanceUuid?: string;
    version?: string;
    edition?: string;
    /** Amprenta fișierelor livrate (`CHECKSUMS.sha256`), pentru recunoașterea versiunii oficiale la Data Center. */
    filesSha256?: string;
  },
): Promise<GcsLicenseActivationResult> {
  const canonical = normalizeLicenseKey(key);
  if (!canonical) return { ok: false, error: "format" };
  const server = (opts.server ?? licenseActivationServer()).trim();
  if (!server) return { ok: false, error: "disabled" };
  const doFetch = opts.fetch ?? fetch;
  try {
    const res = await doFetch(new URL("/api/license/activate", server), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: canonical,
        domain: normalizeDomain(opts.domain),
        ...(opts.instanceUuid ? { instance_uuid: opts.instanceUuid } : {}),
        ...(opts.version ? { version: opts.version } : {}),
        ...(opts.edition ? { edition: opts.edition } : {}),
        ...(opts.filesSha256 ? { files_sha256: opts.filesSha256 } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    // 400: cererea e bună de la noi, deci domeniul e cel refuzat (o adresă IP, un domeniu gol sau invalid).
    if (res.status === 400) return { ok: false, error: "bad_domain" };
    if (!res.ok) return { ok: false, error: "unreachable" };
    const body = (await res.json().catch(() => null)) as { ok?: unknown; token?: unknown; error?: unknown } | null;
    if (body?.ok === true && typeof body.token === "string" && body.token.startsWith(`${GCS_LICENSE_PREFIX}.`)) return { ok: true, token: body.token };
    if (body?.ok === false && typeof body.error === "string" && ACTIVATION_ERRORS.includes(body.error)) {
      return { ok: false, error: body.error as GcsLicenseActivationError };
    }
    return { ok: false, error: "unreachable" };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

/** Domeniul instalării: `GCS_DOMAIN`, altfel host-ul din `GCS_BASE_URL`. */
export function installDomain(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GCS_DOMAIN) return normalizeDomain(env.GCS_DOMAIN);
  return env.GCS_BASE_URL ? normalizeDomain(env.GCS_BASE_URL) : "";
}
