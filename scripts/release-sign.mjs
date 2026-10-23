#!/usr/bin/env node
/**
 * Semnează pachetele premium ale unui release (Ed25519, același format ca pluginurile: `gcs-signature.json`).
 *
 *   pnpm release:sign -- --key <cale spre cheia privată PEM> [--key-id gcs-2026] [--dir dist/release/<versiune>]
 *
 * Comanda o rulează proprietarul, cu cheia lui. Cheia privată se citește doar din fișierul dat: nu se afișează, nu se
 * copiază și nu ajunge în pachete (semnarea propriu-zisă e `packages/plugin-sdk/scripts/sign-plugin.ts`). După semnare,
 * suma fiecărui pachet (`<pachet>.sha256`) se scrie din nou. Testele folosesc o cheie de unică folosință, generată în test.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

/** Ultimul release din `dist/release/` (după versiune). */
function latestRelease(root) {
  const base = path.join(root, "dist", "release");
  if (!existsSync(base)) return undefined;
  const versions = readdirSync(base).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return versions.length ? path.join(base, versions.at(-1)) : undefined;
}

/** Semnează fiecare `premium/*.gcs` din release și întoarce pachetele semnate. */
export function signRelease({ root = ROOT, dir, key, keyId = "gcs-2026" }) {
  if (!key || !existsSync(key)) throw new Error("--key lipsește sau fișierul nu există (calea spre cheia privată PEM)");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error("--key-id invalid");
  const releaseDir = dir ?? latestRelease(root);
  const premium = releaseDir ? path.join(releaseDir, "premium") : undefined;
  if (!premium || !existsSync(premium)) throw new Error("nu găsesc pachetele premium (rulează întâi pnpm release)");
  const packages = readdirSync(premium).filter((n) => n.endsWith(".gcs"));
  if (packages.length === 0) throw new Error(`niciun pachet .gcs în ${premium}`);
  const sdk = path.join(root, "packages", "plugin-sdk");
  const signer = path.join(sdk, "scripts", "sign-plugin.ts");
  // tsx din SDK, rulat direct cu Node (fără shell: căile cu spații rămân întregi pe Windows).
  const tsx = createRequire(path.join(sdk, "package.json")).resolve("tsx/cli");
  for (const name of packages) {
    const file = path.join(premium, name);
    const res = spawnSync(process.execPath, [tsx, signer, file], {
      cwd: sdk,
      env: { ...process.env, GCS_PLUGIN_SIGNING_KEY: path.resolve(key), GCS_PLUGIN_SIGNING_KEY_ID: keyId },
      encoding: "utf8",
    });
    if (res.status !== 0) throw new Error(`semnarea ${name} a eșuat: ${res.stderr || res.stdout}`);
    writeFileSync(`${file}.sha256`, `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${name}\n`);
  }
  return packages.map((n) => path.join(premium, n));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const signed = signRelease({ dir: arg(process.argv, "dir"), key: arg(process.argv, "key"), keyId: arg(process.argv, "key-id") });
    for (const file of signed) console.log(`semnat: ${path.relative(ROOT, file)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
