/**
 * Construiește pluginul de exemplu (`examples/hello`): `src/server.ts` → `server.mjs` (esbuild, un singur fișier ESM,
 * fără importuri la rulare), apoi arhiva cu manifestul, textele, migrațiile și fișierele client.
 *
 * `pnpm --filter @gcs/plugin-sdk build:example` scrie `examples/hello/dist/gcs.hello-<versiune>.zip`.
 * Testele și E2E folosesc `buildExamplePlugin()` direct (cu altă versiune sau fișiere modificate).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { packPlugin, readPluginDir, type GcsPluginSigningKey } from "../src/pack";

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_DIR = path.resolve(here, "../examples/hello");

export type GcsBuildExampleOptions = {
  /** Altă versiune decât cea din `plugin.json` (ex. testele de actualizare). */
  version?: string;
  /** Modifică fișierele înainte de împachetare (cale → conținut). */
  mutate?: (files: Map<string, Buffer>) => void;
  sign?: GcsPluginSigningKey;
};

/** Codul server compilat (`server.mjs`). */
export async function buildExampleServer(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(EXAMPLE_DIR, "src/server.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
    legalComments: "none",
    logLevel: "warning",
  });
  return result.outputFiles[0]!.text;
}

/** Arhiva pluginului de exemplu. */
export async function buildExamplePlugin(opts: GcsBuildExampleOptions = {}): Promise<Buffer> {
  const all = await readPluginDir(EXAMPLE_DIR);
  const files = new Map<string, Buffer>();
  for (const [name, data] of all) {
    if (name.startsWith("src/") || name.endsWith(".zip")) continue;
    files.set(name, data);
  }
  if (opts.version) {
    const manifest = JSON.parse(await readFile(path.join(EXAMPLE_DIR, "plugin.json"), "utf8")) as Record<string, unknown>;
    manifest.version = opts.version;
    files.set("plugin.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  }
  files.set("server.mjs", Buffer.from(await buildExampleServer()));
  opts.mutate?.(files);
  return packPlugin(files, opts.sign ? { sign: opts.sign } : {});
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(EXAMPLE_DIR, "plugin.json"), "utf8")) as { key: string; version: string };
  const zip = await buildExamplePlugin();
  const out = path.join(EXAMPLE_DIR, "dist", `${manifest.key}-${manifest.version}.zip`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, zip);
  console.log(`${path.relative(process.cwd(), out)} (${zip.length} octeți)`);
}

if (process.argv[1] && /build-example\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
