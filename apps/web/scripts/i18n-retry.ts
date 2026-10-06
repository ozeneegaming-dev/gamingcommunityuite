/**
 * Reîncearcă, unul câte unul, mesajele pe care traducerea automată le-a lăsat identice cu engleza (LibreTranslate
 * întoarce uneori etichetele scurte neschimbate când sunt traduse în lot). Doar textele cu cel puțin două cuvinte,
 * care nu sunt în glosar; o traducere e păstrată doar dacă diferă de engleză și trece validarea (aceleași argumente).
 *
 * Folosire: `pnpm --filter @gcs/web exec tsx scripts/i18n-retry.ts --endpoint http://127.0.0.1:5005`
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flatten, translateMessages, unflatten, type GcsHtmlTranslator } from "./i18n-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "messages");
const MANIFEST = path.join(dir, ".translations.json");
const TARGETS = ["de", "es", "fr", "ru"];
const endpoint = process.argv[process.argv.indexOf("--endpoint") + 1] ?? "http://127.0.0.1:5005";
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const read = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;

const translator: GcsHtmlTranslator = async (texts, target) => {
  const res = await fetch(`${endpoint}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: texts, source: "en", target, format: "text" }),
  });
  if (!res.ok) throw new Error(`LibreTranslate ${res.status}`);
  const body = (await res.json()) as { translatedText: string[] | string };
  return Array.isArray(body.translatedText) ? body.translatedText : [body.translatedText];
};

async function main() {
  const enRaw = read<Record<string, unknown>>(path.join(dir, "en.json"));
  const en = flatten(enRaw);
  const order = Object.keys(en);
  const glossary = read<Record<string, unknown>>(path.join(dir, "glossary.json"));
  const manifest = read<Record<string, Record<string, string>>>(MANIFEST);
  for (const target of TARGETS) {
    const file = path.join(dir, `${target}.json`);
    const current = flatten(read<Record<string, unknown>>(file));
    const stale = order.filter((k) => current[k] === en[k] && !glossary[en[k]!] && en[k]!.split(/\s+/).length >= 2 && /[a-z]{3}/.test(en[k]!.replace(/\{[^}]*\}/g, "")));
    let fixed = 0;
    for (const k of stale) {
      // Câte unul: în lot, LibreTranslate întoarce uneori textul neschimbat. Etichetele care încep cu majusculă sunt
      // luate drept nume proprii: a doua încercare e cu prima literă mică, apoi o punem la loc.
      const source = en[k]!;
      let [out] = await translateMessages([source], target, translator, 1);
      if (!out || out === source) {
        const lower = source.charAt(0).toLowerCase() + source.slice(1);
        const [second] = await translateMessages([lower], target, translator, 1);
        out = second && second !== lower ? second.charAt(0).toLocaleUpperCase(target) + second.slice(1) : null;
      }
      // O traducere care pierde cuvinte (ex. „Posting & Editor” → „Editor”) e mai rea decât engleza.
      const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
      if (out && words(out) < words(source) - 1) out = null;
      if (out && out !== source) {
        current[k] = out;
        (manifest[target] ??= {})[k] = hash(en[k]!);
        fixed++;
      }
    }
    writeFileSync(file, `${JSON.stringify(unflatten(current, order), null, 2)}\n`);
    console.log(`[i18n] ${target}: ${fixed} din ${stale.length} retraduse`);
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

void main();
