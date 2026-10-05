// Împachetează CLI-ul `gcs` într-un singur fișier (fără dependențe la runtime), copiat în imaginea Docker.
import { build } from "esbuild";

await build({
  entryPoints: ["cli/gcs.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "cli/dist/gcs.mjs",
  // Unele dependențe (ex. @inquirer/prompts) folosesc `require` intern.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
