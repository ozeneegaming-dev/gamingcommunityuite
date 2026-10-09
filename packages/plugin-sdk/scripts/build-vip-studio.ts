/**
 * Construiește pluginul Studio VIP (`plugins/vip-studio`): codul server (`src/server.ts` → `server.mjs`) și JS-ul din
 * browser (`client/vip.ts` → `assets/vip.js`) cu esbuild, desenele originale (SVG din `art/`, randate în PNG / WebP cu
 * sharp), apoi arhiva cu manifestul, textele, migrațiile și fișierele client. Arhiva iese **nesemnată**; semnarea e un
 * pas separat (`scripts/sign-plugin.ts`, cheia privată doar din `GCS_PLUGIN_SIGNING_KEY`).
 *
 * `pnpm --filter @gcs/plugin-sdk build:vip-studio` scrie `plugins/vip-studio/dist/gcs.vip_studio-<versiune>.zip`; cu
 * `-- --no-js`, `…-fara-js.zip` (fără JS în browser, instalabil și nesemnat).
 * Testele și E2E folosesc `buildVipStudio()` direct.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { FRAME_ART } from "../plugins/vip-studio/art/frames";
import { SCENES } from "../plugins/vip-studio/art/scenes";
import { WEAPON_ART } from "../plugins/vip-studio/art/weapons";
import { ART_KEYS } from "../plugins/vip-studio/src/presets";
import { packPlugin, readPluginDir, type GcsPluginSigningKey } from "../src/pack";

const here = path.dirname(fileURLToPath(import.meta.url));
export const VIP_STUDIO_DIR = path.resolve(here, "../plugins/vip-studio");

/** sharp vine din `@gcs/core` (deja dependența lui), ca SDK-ul să nu mai aducă un modul nativ doar pentru construire. */
type SharpChain = { resize(o: object): SharpChain; png(o?: object): SharpChain; webp(o?: object): SharpChain; toBuffer(): Promise<Buffer> };
type SharpFactory = (input: Buffer, opts?: object) => SharpChain;
function loadSharp(): SharpFactory {
  const fromCore = createRequire(path.resolve(here, "../../core/package.json"));
  return fromCore("sharp") as SharpFactory;
}

export type GcsBuildVipStudioOptions = {
  version?: string;
  /**
   * Fără JS în browser (fără capabilitatea `client-js`): pachetul se poate instala și nesemnat; studioul merge atunci
   * doar cu formularele și previzualizarea din plăci.
   */
  noScripts?: boolean;
  mutate?: (files: Map<string, Buffer>) => void;
  sign?: GcsPluginSigningKey;
};

async function bundle(entry: string, format: "esm" | "iife", platform: "neutral" | "browser"): Promise<string> {
  const result = await build({
    entryPoints: [path.join(VIP_STUDIO_DIR, entry)],
    bundle: true,
    format,
    platform,
    target: format === "esm" ? "es2022" : "es2020",
    write: false,
    legalComments: "none",
    minify: format === "iife",
    logLevel: "warning",
  });
  return result.outputFiles[0]!.text;
}

/** Desenele (rame, arme, carduri, fundaluri) randate din SVG. */
async function renderArt(): Promise<Map<string, Buffer>> {
  const sharp = loadSharp();
  const out = new Map<string, Buffer>();
  const svg = (s: string) => Buffer.from(s, "utf8");
  for (const key of ART_KEYS.frames) {
    const art = FRAME_ART.find((a) => a.key === key);
    if (!art) throw new Error(`frame art missing: ${key}`);
    out.set(`assets/frames/${key}.png`, await sharp(svg(art.render()), { density: 144 }).resize({ width: 256, height: 256 }).png({ compressionLevel: 9 }).toBuffer());
  }
  for (const key of ART_KEYS.weapons) {
    const art = WEAPON_ART.find((a) => a.key === key);
    if (!art) throw new Error(`weapon art missing: ${key}`);
    out.set(`assets/weapons/${key}.png`, await sharp(svg(art.render())).resize({ width: 96, height: 96 }).png({ compressionLevel: 9 }).toBuffer());
  }
  for (const key of ART_KEYS.cards) {
    const scene = SCENES[key];
    if (!scene) throw new Error(`card art missing: ${key}`);
    out.set(`assets/cards/${key}.webp`, await sharp(svg(scene(720, 400))).webp({ quality: 82 }).toBuffer());
  }
  for (const key of ART_KEYS.backgrounds) {
    const scene = SCENES[key];
    if (!scene) throw new Error(`background art missing: ${key}`);
    out.set(`assets/backgrounds/${key}.webp`, await sharp(svg(scene(1600, 900))).webp({ quality: 80 }).toBuffer());
    out.set(`assets/backgrounds/${key}-thumb.webp`, await sharp(svg(scene(480, 270))).webp({ quality: 78 }).toBuffer());
  }
  return out;
}

/** Arhiva pluginului (nesemnată, dacă nu primește `sign`). */
export async function buildVipStudio(opts: GcsBuildVipStudioOptions = {}): Promise<Buffer> {
  const all = await readPluginDir(VIP_STUDIO_DIR);
  const files = new Map<string, Buffer>();
  for (const [name, data] of all) {
    if (name === "plugin.json" || name === "README.md" || name === "THIRD-PARTY-NOTICES.md" || /^lang\/[a-z]{2}\.json$/.test(name) || /^migrations\/[^/]+\.sql$/.test(name) || name === "assets/vip.css") files.set(name, data);
  }
  if (opts.version || opts.noScripts) {
    const manifest = JSON.parse(await readFile(path.join(VIP_STUDIO_DIR, "plugin.json"), "utf8")) as { version: string; capabilities: string[]; client: { styles: string[]; scripts?: string[] } };
    if (opts.version) manifest.version = opts.version;
    if (opts.noScripts) {
      manifest.capabilities = manifest.capabilities.filter((c) => c !== "client-js");
      manifest.client = { styles: manifest.client.styles };
    }
    files.set("plugin.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  }
  files.set("server.mjs", Buffer.from(await bundle("src/server.ts", "esm", "neutral")));
  if (!opts.noScripts) files.set("assets/vip.js", Buffer.from(await bundle("client/vip.ts", "iife", "browser")));
  for (const [name, data] of await renderArt()) files.set(name, data);
  opts.mutate?.(files);
  return packPlugin(files, opts.sign ? { sign: opts.sign } : {});
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(VIP_STUDIO_DIR, "plugin.json"), "utf8")) as { key: string; version: string };
  const noScripts = process.argv.includes("--no-js");
  const zip = await buildVipStudio({ noScripts });
  const out = path.join(VIP_STUDIO_DIR, "dist", `${manifest.key}-${manifest.version}${noScripts ? "-fara-js" : ""}.zip`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, zip);
  console.log(`${out} (${zip.length} octeți, nesemnat)`);
}

if (process.argv[1] && /build-vip-studio\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
