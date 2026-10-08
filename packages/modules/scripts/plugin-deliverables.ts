/**
 * Pachetele generice ale pluginurilor de server (specul 2026-10-08-servere-plugin-v2 §6), pentru distribuirea în afara
 * site-ului: aceleași arhive ca în ACP, dar cu adresa site-ului de completat și fără cheie (serverul se înrolează singur
 * după ce adresa e scrisă). Scrie, pentru fiecare joc, folderul despachetat și arhiva ZIP.
 *
 *   pnpm --filter @gcs/modules exec tsx scripts/plugin-deliverables.ts <folderul-de-ieșire>
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readZip } from "@gcs/plugin-sdk/zip";
import { buildPluginPackage, readPluginRelease } from "../src/servers/bridge/package";

const out = process.argv[2];
if (!out) {
  console.error("Folosire: tsx scripts/plugin-deliverables.ts <folderul-de-ieșire>");
  process.exit(2);
}
const release = readPluginRelease(process.env.GCS_PLUGIN_RELEASE_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../servers-plugins/release"));
for (const game of ["cs16", "cs2"] as const) {
  const zip = buildPluginPackage(release, game, "generic", { url: null, key: null });
  const dir = path.join(out, game);
  rmSync(dir, { recursive: true, force: true });
  for (const [name, data] of readZip(zip)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), data);
  }
  writeFileSync(path.join(out, `gcs-bridge-${game}.zip`), zip);
  console.log(`${game}: ${release.manifest.plugins[game].id}, ${zip.length} octeți`);
}
