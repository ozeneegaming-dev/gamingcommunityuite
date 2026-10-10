#!/usr/bin/env node
/**
 * Construiește pachetul unei teme din sursele ei (`themes/<nume>/theme.json` + `themes/<nume>/css/*.css`):
 * `node themes/build.mjs redline-official` scrie `themes/<nume>/<cheia>.gcs-theme.json`, fișierul care se încarcă în
 * ACP → Aspect → Teme → Importă o temă. Validarea completă o face serverul la import (și testul pachetelor incluse).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
if (!name) {
  console.error("Folosire: node themes/build.mjs <nume-temă>");
  process.exit(1);
}
const dir = path.join(here, name);
const src = JSON.parse(readFileSync(path.join(dir, "theme.json"), "utf8"));
const pkg = {
  format: "gcs-theme",
  version: 1,
  key: src.key,
  name: src.name,
  ...(src.description ? { description: src.description } : {}),
  ...(src.author ? { author: src.author } : {}),
  settings: src.settings,
  cssFiles: src.cssFiles.map((file) => ({ name: file, content: readFileSync(path.join(dir, "css", file), "utf8").trim() })),
};
for (const f of pkg.cssFiles) {
  if (f.content.includes("<")) throw new Error(`${f.name}: CSS-ul temei nu poate conține „<” (serverul îl scoate).`);
  if (f.content.length > 50_000) throw new Error(`${f.name}: peste 50 000 de caractere.`);
}
const out = path.join(dir, `${src.key}.gcs-theme.json`);
writeFileSync(out, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`${path.relative(process.cwd(), out)} (${pkg.cssFiles.length} fișiere CSS, ${Buffer.byteLength(JSON.stringify(pkg))} octeți)`);
