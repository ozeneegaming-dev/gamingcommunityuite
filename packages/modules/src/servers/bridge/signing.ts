import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Cheile serverelor de joc și semnarea cererilor (specul 2026-10-08-servere-bridge §5.1–5.2). Secretul nu circulă pe
 * rețea: fiecare cerere poartă o semnătură peste șirul canonic, făcută cu `K = hex(SHA-256(secret))`.
 */

/** Baza rutelor protocolului; CALE din șirul canonic e partea de după ea. */
export const BRIDGE_BASE_PATH = "/api/servers/bridge/v1";
export const BRIDGE_KEY_PREFIX = "gcs1";

const KEY_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const KEY_ID = /^[a-z0-9]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE = /^(hmac-sha256|sha256-env)=([0-9a-fA-F]{64})$/;

export type GcsBridgeSignatureAlg = "hmac-sha256" | "sha256-env";

export type GcsGeneratedBridgeKey = {
  keyId: string;
  secret: string;
  /** Ce se arată adminului o singură dată și se scrie în configul pluginului. */
  token: string;
  /** `K`: hash-ul secretului (hex), singurul păstrat (sigilat) în baza de date. */
  signingKey: string;
};

/** `K = hex(SHA-256(secret))`, secretul luat ca text (forma base64url din cheie). */
export function signingKeyOf(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** O cheie nouă: `keyId` (12 caractere `[a-z0-9]`, public) și secretul (32 de octeți aleatori, base64url). */
export function generateBridgeKey(): GcsGeneratedBridgeKey {
  const keyId = Array.from({ length: 12 }, () => KEY_ID_ALPHABET[randomInt(KEY_ID_ALPHABET.length)]).join("");
  const secret = randomBytes(32).toString("base64url");
  return { keyId, secret, token: `${BRIDGE_KEY_PREFIX}.${keyId}.${secret}`, signingKey: signingKeyOf(secret) };
}

/** Desface o cheie `gcs1.<keyId>.<secret>`; `null` pentru orice altă formă. */
export function parseBridgeKey(token: string): { keyId: string; secret: string } | null {
  const [prefix, keyId, secret, ...rest] = token.trim().split(".");
  if (prefix !== BRIDGE_KEY_PREFIX || rest.length > 0 || !keyId || !secret || !KEY_ID.test(keyId) || !SECRET.test(secret)) return null;
  return { keyId, secret };
}

export function isBridgeKeyId(value: string): boolean {
  return KEY_ID.test(value);
}

/** `hex(SHA-256(corp))`; corpul gol are hash-ul șirului gol. */
export function bodyHash(body: string | Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Șirul canonic: `METODĂ \n CALE \n TIMESTAMP \n NONCE \n hex(SHA-256(corp))`. */
export function canonicalString(method: string, path: string, timestamp: number | string, nonce: string, body: string | Uint8Array): string {
  return [method.toUpperCase(), path, String(timestamp), nonce, bodyHash(body)].join("\n");
}

/** Semnătura, în forma antetului `X-GCS-Signature` (fără prefix). */
export function signCanonical(signingKey: string, canonical: string, alg: GcsBridgeSignatureAlg): string {
  if (alg === "hmac-sha256") return createHmac("sha256", Buffer.from(signingKey, "ascii")).update(canonical, "utf8").digest("hex");
  // „Plicul”: cheia la ambele capete, deci fără extensia de lungime (pentru runtime-uri fără HMAC, ex. AMX Mod X).
  return createHash("sha256").update(`${signingKey}\n${canonical}\n${signingKey}`, "utf8").digest("hex");
}

/** Verifică antetul `X-GCS-Signature` (`hmac-sha256=<hex>` sau `sha256-env=<hex>`), comparat în timp constant. */
export function verifyBridgeSignature(signingKey: string, canonical: string, header: string | null | undefined): boolean {
  const m = SIGNATURE.exec(header ?? "");
  if (!m) return false;
  const expected = Buffer.from(signCanonical(signingKey, canonical, m[1] as GcsBridgeSignatureAlg), "hex");
  const given = Buffer.from(m[2]!.toLowerCase(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Anteturile unei cereri semnate (serverul fals, testele; pluginurile fac la fel în limbajul lor). `path` = calea de
 * după baza protocolului, cu query-ul exact cum se trimite.
 */
export function signBridgeRequest(opts: {
  token: string;
  method: string;
  path: string;
  body: string;
  timestamp: number;
  nonce?: string;
  alg?: GcsBridgeSignatureAlg;
}): Record<"X-GCS-Key" | "X-GCS-Timestamp" | "X-GCS-Nonce" | "X-GCS-Signature", string> {
  const key = parseBridgeKey(opts.token);
  if (!key) throw new Error("Cheie GCS invalidă");
  const nonce = opts.nonce ?? randomBytes(18).toString("base64url");
  const canonical = canonicalString(opts.method, opts.path, opts.timestamp, nonce, opts.body);
  const alg = opts.alg ?? "hmac-sha256";
  return {
    "X-GCS-Key": key.keyId,
    "X-GCS-Timestamp": String(opts.timestamp),
    "X-GCS-Nonce": nonce,
    "X-GCS-Signature": `${alg}=${signCanonical(signingKeyOf(key.secret), canonical, alg)}`,
  };
}
