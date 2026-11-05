/**
 * Construiește pluginul Recrutare (`plugins/recruitment`): codul server (`src/server.ts` → `server.mjs`) cu esbuild,
 * apoi arhiva cu manifestul, textele, migrațiile și CSS-ul. Fără JS în browser, deci pachetul se poate instala și
 * nesemnat (Root Admin, cu codul 2FA); semnarea e un pas separat (`scripts/sign-plugin.ts`).
 *
 * `pnpm --filter @gcs/plugin-sdk build:recruitment` scrie `plugins/recruitment/dist/gcs.recruitment-<versiune>.zip`.
 * Testele folosesc `buildRecruitment()` direct.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { packPlugin, readPluginDir, type GcsPluginSigningKey } from "../src/pack";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RECRUITMENT_DIR = path.resolve(here, "../plugins/recruitment");

export type GcsBuildRecruitmentOptions = { version?: string; sign?: GcsPluginSigningKey };

/** Arhiva pluginului (nesemnată, dacă nu primește `sign`). */
export async function buildRecruitment(opts: GcsBuildRecruitmentOptions = {}): Promise<Buffer> {
  const all = await readPluginDir(RECRUITMENT_DIR);
  const files = new Map<string, Buffer>();
  for (const [name, data] of all) {
    if (name === "plugin.json" || name === "README.md" || /^lang\/[a-z]{2}\.json$/.test(name) || /^migrations\/[^/]+\.sql$/.test(name) || /^assets\/[^/]+\.css$/.test(name)) files.set(name, data);
  }
  if (opts.version) {
    const manifest = JSON.parse(await readFile(path.join(RECRUITMENT_DIR, "plugin.json"), "utf8")) as { version: string };
    manifest.version = opts.version;
    files.set("plugin.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  }
  const result = await build({
    entryPoints: [path.join(RECRUITMENT_DIR, "src/server.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
    legalComments: "none",
    logLevel: "warning",
  });
  files.set("server.mjs", Buffer.from(result.outputFiles[0]!.text));
  return packPlugin(files, opts.sign ? { sign: opts.sign } : {});
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(RECRUITMENT_DIR, "plugin.json"), "utf8")) as { key: string; version: string };
  const zip = await buildRecruitment();
  const out = path.join(RECRUITMENT_DIR, "dist", `${manifest.key}-${manifest.version}.zip`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, zip);
  console.log(`${out} (${zip.length} octeți, nesemnat)`);
}

if (process.argv[1] && /build-recruitment\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
