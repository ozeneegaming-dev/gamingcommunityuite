import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

/** Fișierul semnăturii din arhivă; nu intră în mesajul semnat. */
export const PLUGIN_SIGNATURE_FILE = "gcs-signature.json";
const SIGNATURE_HEADER = "GCS-PLUGIN-SIGNATURE-V1\n";
/** Prefixul DER (SPKI) al unei chei publice Ed25519; urmează cei 32 de octeți ai cheii. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Cheile publice ale marketplace-ului (Data Center), incluse în cod. Goală până la etapa Redistribuire; până atunci,
 * cheile de încredere vin doar din `GCS_PLUGIN_TRUSTED_KEYS`.
 */
export const MARKETPLACE_PLUGIN_KEYS: Record<string, string> = {};

/**
 * Mesajul semnat: antetul, apoi câte un rând `<sha256>  <cale>` pentru fiecare fișier (fără semnătură), sortat după cale.
 * Identic cu `pluginSignatureMessage` din `@gcs/plugin-sdk/pack`.
 */
export function pluginSignatureMessage(files: ReadonlyMap<string, Uint8Array>): Buffer {
  const lines = [...files.keys()]
    .filter((name) => name !== PLUGIN_SIGNATURE_FILE)
    .sort()
    .map((name) => `${createHash("sha256").update(files.get(name)!).digest("hex")}  ${name}\n`);
  return Buffer.from(SIGNATURE_HEADER + lines.join(""), "utf8");
}

/** O cheie publică Ed25519 din forma base64 (32 de octeți). `null` dacă nu e validă. */
export function ed25519PublicKey(base64: string): KeyObject | null {
  const raw = Buffer.from(base64.trim(), "base64");
  if (raw.length !== 32) return null;
  try {
    return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

/**
 * Cheile de încredere: cele ale marketplace-ului și cele din `GCS_PLUGIN_TRUSTED_KEYS` (`id=base64,id2=base64`).
 * Intrările invalide se ignoră (și se raportează în `invalid`).
 */
export function trustedPluginKeys(env: string | undefined = process.env.GCS_PLUGIN_TRUSTED_KEYS): { keys: Map<string, KeyObject>; invalid: string[] } {
  const keys = new Map<string, KeyObject>();
  const invalid: string[] = [];
  const add = (id: string, value: string) => {
    const key = /^[A-Za-z0-9._-]{1,64}$/.test(id) ? ed25519PublicKey(value) : null;
    if (key) keys.set(id, key);
    else invalid.push(id.slice(0, 64));
  };
  for (const [id, value] of Object.entries(MARKETPLACE_PLUGIN_KEYS)) add(id, value);
  for (const part of (env ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf("=");
    if (at <= 0) invalid.push(trimmed.slice(0, 64));
    else add(trimmed.slice(0, at), trimmed.slice(at + 1));
  }
  return { keys, invalid };
}

export type GcsPluginSignatureStatus =
  | { status: "signed"; keyId: string }
  | { status: "unsigned"; keyId?: string }
  | { status: "invalid"; keyId?: string; reason: "malformed" | "mismatch" };

/**
 * Verifică semnătura pachetului: `signed` (cheie de încredere, semnătură validă), `unsigned` (fără semnătură sau cheie
 * necunoscută) sau `invalid` (fișier de semnătură stricat, ori cheie de încredere și semnătură care nu se potrivește).
 */
export function verifyPluginSignature(files: ReadonlyMap<string, Uint8Array>, trusted: ReadonlyMap<string, KeyObject>): GcsPluginSignatureStatus {
  const file = files.get(PLUGIN_SIGNATURE_FILE);
  if (!file) return { status: "unsigned" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(file).toString("utf8"));
  } catch {
    return { status: "invalid", reason: "malformed" };
  }
  const sig = parsed as { algorithm?: unknown; keyId?: unknown; signature?: unknown };
  if (sig.algorithm !== "ed25519" || typeof sig.keyId !== "string" || typeof sig.signature !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(sig.keyId)) {
    return { status: "invalid", reason: "malformed" };
  }
  const key = trusted.get(sig.keyId);
  if (!key) return { status: "unsigned", keyId: sig.keyId };
  const signature = Buffer.from(sig.signature, "base64");
  if (signature.length !== 64) return { status: "invalid", keyId: sig.keyId, reason: "malformed" };
  const ok = verify(null, pluginSignatureMessage(files), key, signature);
  return ok ? { status: "signed", keyId: sig.keyId } : { status: "invalid", keyId: sig.keyId, reason: "mismatch" };
}
