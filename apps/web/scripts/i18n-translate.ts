/**
 * Generează pachetele de limbă `de`, `es`, `fr`, `ru` din `en` prin LibreTranslate (specul etapei 5 §5).
 *
 * Folosire: `pnpm --filter @gcs/web i18n:translate [--endpoint http://127.0.0.1:5005] [--only de,fr] [--all]`
 *
 * - Traduce doar cheile noi sau cele al căror text englez s-a schimbat (manifestul `.translations.json` ține hash-ul
 *   sursei pentru fiecare cheie tradusă); `--all` le retraduce pe toate.
 * - Un mesaj care nu trece validarea (argumente pierdute, ICU invalid) rămâne în engleză și se reîncearcă data viitoare.
 * - Cheile șterse din `en` dispar și din pachete. Ordinea cheilor urmează `en.json`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptPlurals, flatten, translateMessages, unflatten, type GcsHtmlTranslator } from "./i18n-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../messages");
const TARGETS = ["de", "es", "fr", "ru"] as const;
const MANIFEST = path.join(dir, ".translations.json");
/** Glosarul interfeței: etichetele scurte, traduse fix (un traducător automat le greșește fără context). */
const GLOSSARY = JSON.parse(readFileSync(path.join(dir, "glossary.json"), "utf8")) as Record<string, Record<string, string> | string>;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const endpoint = (arg("endpoint") ?? process.env.LIBRETRANSLATE_URL ?? "http://127.0.0.1:5005").replace(/\/$/, "");
const only = arg("only")?.split(",") ?? [...TARGETS];
const retranslateAll = process.argv.includes("--all");

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback);

const libreTranslate: GcsHtmlTranslator = async (html, target) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${endpoint}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: html, source: "en", target, format: "text" }),
      });
      if (!res.ok) throw new Error(`LibreTranslate ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { translatedText: string[] | string };
      return Array.isArray(body.translatedText) ? body.translatedText : [body.translatedText];
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
};

async function main() {
  const source = flatten(JSON.parse(readFileSync(path.join(dir, "en.json"), "utf8")) as Record<string, unknown>);
  const order = Object.keys(source);
  const manifest = readJson<Record<string, Record<string, string>>>(MANIFEST, {});

  for (const target of only) {
    if (!TARGETS.includes(target as (typeof TARGETS)[number])) throw new Error(`Limbă necunoscută: ${target}`);
    const file = path.join(dir, `${target}.json`);
    const current = flatten(readJson<Record<string, unknown>>(file, {}));
    const done = (manifest[target] ??= {});
    const glossary = (text: string) => {
      const entry = GLOSSARY[text];
      return typeof entry === "object" ? entry[target] : undefined;
    };
    const todo = order.filter((k) => !glossary(source[k]!) && (retranslateAll || done[k] !== hash(source[k]!) || !(k in current)));
    console.log(`[i18n] ${target}: ${todo.length} de mesaje de tradus din ${order.length}`);

    const next: Record<string, string> = {};
    for (const k of order) next[k] = k in current && !todo.includes(k) ? current[k]! : adaptPlurals(source[k]!, target);
    const chunk = 80;
    let failed = 0;
    for (let i = 0; i < todo.length; i += chunk) {
      const keys = todo.slice(i, i + chunk);
      const out = await translateMessages(keys.map((k) => source[k]!), target, libreTranslate);
      keys.forEach((k, j) => {
        const t = out[j];
        if (t) {
          next[k] = t;
          done[k] = hash(source[k]!);
        } else {
          // Rămâne textul englez, dar cu pluralele limbii țintă (ca pachetul să fie valid).
          next[k] = adaptPlurals(source[k]!, target);
          failed++;
          delete done[k];
        }
      });
      process.stdout.write(`\r[i18n] ${target}: ${Math.min(i + chunk, todo.length)}/${todo.length}`);
    }
    if (todo.length > 0) process.stdout.write("\n");
    for (const k of order) {
      const fixed = glossary(source[k]!);
      if (fixed) {
        next[k] = fixed;
        delete done[k];
      }
    }
    // Cheile care nu mai există în sursă dispar și din manifest.
    for (const k of Object.keys(done)) if (!(k in source)) delete done[k];
    writeFileSync(file, `${JSON.stringify(unflatten(next, order), null, 2)}\n`);
    console.log(`[i18n] ${target}: gata${failed ? ` (${failed} rămase în engleză, se reîncearcă data viitoare)` : ""}`);
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error("[i18n] eșec:", error);
  process.exit(1);
});
