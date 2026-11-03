/**
 * Completează pachetele `de`, `es`, `fr`, `ru` cu cheile din `en` care lipsesc, cu textul ROMÂNESC (limba de bază a
 * site-ului), până le traduce `i18n:translate`; pluralele primesc categoriile limbii (ex. `many` la rusă). Cheile scoase
 * din `en` dispar. Manifestul traducerilor nu se atinge, deci traducerea le vede în continuare ca netraduse.
 *
 * Folosire: `pnpm --filter @gcs/web exec tsx scripts/i18n-fill.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptPlurals, flatten, unflatten } from "./i18n-core";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../messages");
const read = (lang: string) => flatten(JSON.parse(readFileSync(path.join(dir, `${lang}.json`), "utf8")) as Record<string, unknown>);

const en = read("en");
const ro = read("ro");
const order = Object.keys(en);
for (const lang of ["de", "es", "fr", "ru"]) {
  const current = read(lang);
  const next: Record<string, string> = {};
  let filled = 0;
  for (const k of order) {
    // Textul românesc pus de completarea anterioară (sau acum) primește pluralele limbii.
    const placeholder = !(k in current) || current[k] === ro[k];
    if (placeholder) filled++;
    next[k] = placeholder ? adaptPlurals(ro[k] ?? en[k]!, lang) : current[k]!;
  }
  writeFileSync(path.join(dir, `${lang}.json`), `${JSON.stringify(unflatten(next, order), null, 2)}\n`);
  console.log(`[i18n] ${lang}: ${filled} texte în română, în așteptarea traducerii`);
}
