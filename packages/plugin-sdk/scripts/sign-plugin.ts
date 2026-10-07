/**
 * Semnează un pachet de plugin deja construit (Ed25519, formatul din `packages/core/src/plugins/signature.ts`).
 *
 *   GCS_PLUGIN_SIGNING_KEY=<cale spre cheia privată PEM> [GCS_PLUGIN_SIGNING_KEY_ID=gcs-2026] \
 *     pnpm --filter @gcs/plugin-sdk sign:plugin <arhivă.zip> [--out <semnată.zip>]
 *
 * Cheia privată se citește doar din fișierul indicat de variabila de mediu: nu se afișează, nu se copiază și nu ajunge
 * în arhivă. Fără `--out`, arhiva se semnează pe loc. Semnătura acoperă fiecare fișier (sha256), deci orice
 * modificare ulterioară a pachetului îl face „semnătură invalidă” la instalare.
 */
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { packPlugin, PLUGIN_SIGNATURE_FILE } from "../src/pack";
import { readZip } from "../src/zip";

export async function signPluginZip(zip: Buffer, key: { keyId: string; privateKeyPem: string }): Promise<Buffer> {
  const files = readZip(zip);
  files.delete(PLUGIN_SIGNATURE_FILE);
  return packPlugin(files, { sign: { keyId: key.keyId, privateKey: createPrivateKey(key.privateKeyPem) } });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith("--"));
  const outAt = args.indexOf("--out");
  const output = outAt >= 0 ? args[outAt + 1] : input;
  const keyPath = process.env.GCS_PLUGIN_SIGNING_KEY;
  const keyId = process.env.GCS_PLUGIN_SIGNING_KEY_ID ?? "gcs-2026";
  if (!input || !output) throw new Error("folosire: sign-plugin <arhivă.zip> [--out <semnată.zip>]");
  if (!keyPath) throw new Error("GCS_PLUGIN_SIGNING_KEY lipsește (calea spre cheia privată PEM)");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error("GCS_PLUGIN_SIGNING_KEY_ID invalid");
  const pem = await readFile(keyPath, "utf8");
  const signed = await signPluginZip(await readFile(input), { keyId, privateKeyPem: pem });
  await writeFile(output, signed);
  // Doar cheia publică (pentru GCS_PLUGIN_TRUSTED_KEYS) și amprenta arhivei; cheia privată nu se afișează.
  const spki = createPublicKey(createPrivateKey(pem)).export({ format: "der", type: "spki" });
  console.log(`${path.resolve(output)} semnat cu ${keyId}`);
  console.log(`cheia publică: ${Buffer.from(spki.subarray(spki.length - 32)).toString("base64")}`);
  console.log(`sha256: ${createHash("sha256").update(signed).digest("hex")}`);
}

if (process.argv[1] && /sign-plugin\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
