import { createHash, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeZip } from "./zip";

/** Fișierul semnăturii din arhivă (nu intră în mesajul semnat). */
export const PLUGIN_SIGNATURE_FILE = "gcs-signature.json";
const SIGNATURE_HEADER = "GCS-PLUGIN-SIGNATURE-V1\n";

/**
 * Mesajul semnat: antetul, apoi câte un rând `<sha256>  <cale>` pentru fiecare fișier (fără semnătură), sortat după cale.
 * Trebuie să fie identic cu verificarea din GCS (`packages/core/src/plugins/signature.ts`).
 */
export function pluginSignatureMessage(files: ReadonlyMap<string, Uint8Array>): Buffer {
  const lines = [...files.keys()]
    .filter((name) => name !== PLUGIN_SIGNATURE_FILE)
    .sort()
    .map((name) => `${createHash("sha256").update(files.get(name)!).digest("hex")}  ${name}\n`);
  return Buffer.from(SIGNATURE_HEADER + lines.join(""), "utf8");
}

export type GcsPluginSigningKey = { keyId: string; privateKey: KeyObject | string };

/** O pereche de chei Ed25519 nouă: cheia privată (PEM) și cea publică (base64, 32 de octeți) pentru `GCS_PLUGIN_TRUSTED_KEYS`. */
export function generateSigningKey(): { privateKeyPem: string; publicKeyBase64: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyBase64: Buffer.from(spki.subarray(spki.length - 32)).toString("base64"),
  };
}

/** Semnătura (`gcs-signature.json`) pentru fișierele date. */
export function signatureFile(files: ReadonlyMap<string, Uint8Array>, key: GcsPluginSigningKey): Buffer {
  const privateKey = typeof key.privateKey === "string" ? createPrivateKey(key.privateKey) : key.privateKey;
  const signature = sign(null, pluginSignatureMessage(files), privateKey).toString("base64");
  return Buffer.from(JSON.stringify({ algorithm: "ed25519", keyId: key.keyId, signature }, null, 2), "utf8");
}

/** Arhiva unui plugin din fișierele lui (cale → conținut), semnată opțional. */
export function packPlugin(files: ReadonlyMap<string, Uint8Array | string>, opts: { sign?: GcsPluginSigningKey } = {}): Buffer {
  const bytes = new Map<string, Uint8Array>([...files].map(([name, data]) => [name, typeof data === "string" ? Buffer.from(data, "utf8") : data]));
  bytes.delete(PLUGIN_SIGNATURE_FILE);
  if (opts.sign) bytes.set(PLUGIN_SIGNATURE_FILE, signatureFile(bytes, opts.sign));
  return writeZip([...bytes.keys()].sort().map((name) => ({ name, data: bytes.get(name)!, mode: 0o100644 })));
}

/** Toate fișierele dintr-un folder (căi relative cu `/`), fără `node_modules`, `dist` și fișierele ascunse. */
export async function readPluginDir(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  async function walk(rel: string): Promise<void> {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) out.set(child, await readFile(path.join(dir, child)));
    }
  }
  await walk("");
  return out;
}
