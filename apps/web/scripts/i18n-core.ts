/**
 * Partea pură a traducerii automate a pachetelor de limbă (specul etapei 5 §5): un mesaj ICU devine text simplu în care
 * argumentele (`{name}`, `#`, `{n, number}`) și tag-urile HTML (din emailuri) sunt înlocuite cu jetoane-cuvânt `ZQX0`,
 * `ZQX1`…, pe care traducătorul (LibreTranslate, `format: "text"`) le păstrează și le pune unde cere gramatica.
 * Ramurile de plural/select se traduc separat și se reconstruiesc pe categoriile de plural ale limbii țintă
 * (ex. rusă: one, few, many, other).
 */
import { parse, TYPE, type MessageFormatElement, type PluralElement, type SelectElement } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";
import { IntlMessageFormat } from "intl-messageformat";

/** Traduce o listă de texte din engleză în limba țintă (aceeași ordine). */
export type GcsHtmlTranslator = (texts: string[], target: string) => Promise<string[]>;

const TOKEN_RE = /ZQX(\d+)/gi;
const HTML_TAG_RE = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/gi;

/** Ce stă în locul unui jeton: un element ICU sau un tag HTML. */
type Slot = { el: MessageFormatElement } | { html: string };
/** Un fragment de tradus: textul cu jetoane și ce înlocuiește fiecare jeton. */
type Job = { text: string; slots: Slot[] };

const isBranching = (el: MessageFormatElement): el is PluralElement | SelectElement => el.type === TYPE.plural || el.type === TYPE.select;

/**
 * Transformă o listă de elemente în text cu jetoane și înregistrează (în `jobs`) fragmentul. Ramurile de plural/select
 * devin și ele jetoane, iar opțiunile lor se înregistrează ca fragmente separate.
 */
function collect(elements: MessageFormatElement[], jobs: Job[]): number {
  const slots: Slot[] = [];
  let text = "";
  for (const el of elements) {
    if (el.type === TYPE.literal) {
      let last = 0;
      for (const m of el.value.matchAll(HTML_TAG_RE)) {
        text += `${el.value.slice(last, m.index)}ZQX${slots.length}`;
        slots.push({ html: m[0] });
        last = m.index + m[0].length;
      }
      text += el.value.slice(last);
      continue;
    }
    if (isBranching(el)) {
      for (const option of Object.values(el.options)) {
        (option as { job?: number }).job = collect(option.value, jobs);
      }
    }
    text += `ZQX${slots.length}`;
    slots.push({ el });
  }
  jobs.push({ text, slots });
  return jobs.length - 1;
}

/** Reconstruiește elementele din textul tradus; `null` dacă traducătorul a pierdut sau a dublat un jeton. */
function rebuild(job: Job, translated: string, translations: string[], jobs: Job[], target: string): MessageFormatElement[] | null {
  const out: MessageFormatElement[] = [];
  const seen = new Set<number>();
  let literal = "";
  let last = 0;
  const flush = () => {
    if (literal) out.push({ type: TYPE.literal, value: literal });
    literal = "";
  };
  for (const m of translated.matchAll(TOKEN_RE)) {
    literal += translated.slice(last, m.index);
    last = m.index + m[0].length;
    const index = Number(m[1]);
    const slot = job.slots[index];
    if (!slot || seen.has(index)) return null;
    seen.add(index);
    if ("html" in slot) {
      literal += slot.html;
      continue;
    }
    flush();
    if (isBranching(slot.el)) {
      const rebuilt = rebuildBranching(slot.el, translations, jobs, target);
      if (!rebuilt) return null;
      out.push(rebuilt);
    } else {
      out.push(slot.el);
    }
  }
  literal += translated.slice(last);
  flush();
  return seen.size === job.slots.length ? out : null;
}

/** Opțiunile unui plural pe categoriile limbii țintă: categoria din sursă, altfel `other`; `=N` rămân. */
function rebuildBranching(el: PluralElement | SelectElement, translations: string[], jobs: Job[], target: string): PluralElement | SelectElement | null {
  const translatedOption = (key: string): MessageFormatElement[] | null => {
    const option = el.options[key] as { job?: number } | undefined;
    if (option?.job === undefined) return null;
    return rebuild(jobs[option.job]!, translations[option.job]!, translations, jobs, target);
  };
  const options: Record<string, { value: MessageFormatElement[] }> = {};
  let keys = Object.keys(el.options);
  if (el.type === TYPE.plural && el.pluralType !== "ordinal") {
    const categories = new Intl.PluralRules(target).resolvedOptions().pluralCategories as string[];
    keys = [...keys.filter((k) => k.startsWith("=")), ...categories];
  }
  for (const key of keys) {
    const source = key in el.options ? key : "other";
    const value = translatedOption(source);
    if (!value) return null;
    options[key] = { value };
  }
  return { ...el, options } as PluralElement | SelectElement;
}

/** Textul literal în sintaxa ICU: apostroful se dublează doar unde ar porni un escape; acoladele (și `#` în plural) se escapează. */
function printLiteral(value: string, inPlural: boolean): string {
  return value
    .replace(/'(?=[{}#|'])/g, "''")
    .replace(/[{}]/g, (c) => `'${c}'`)
    .replace(/#/g, (c) => (inPlural ? `'${c}'` : c));
}

/** Printer-ul mesajelor, în formatul surselor (`{count, plural, one {…} other {…}}`). */
export function printMessage(elements: MessageFormatElement[], inPlural = false): string {
  return elements
    .map((el) => {
      switch (el.type) {
        case TYPE.literal:
          return printLiteral(el.value, inPlural);
        case TYPE.argument:
          return `{${el.value}}`;
        case TYPE.pound:
          return "#";
        case TYPE.plural:
        case TYPE.select: {
          const kind = el.type === TYPE.select ? "select" : el.pluralType === "ordinal" ? "selectordinal" : "plural";
          const offset = el.type === TYPE.plural && el.offset ? ` offset:${el.offset}` : "";
          const options = Object.entries(el.options)
            .map(([key, o]) => `${key} {${printMessage(o.value, el.type === TYPE.plural)}}`)
            .join(" ");
          return `{${el.value}, ${kind},${offset} ${options}}`;
        }
        default:
          // Număr, dată, oră (cu stilurile lor): printer-ul bibliotecii.
          return printAST([el]);
      }
    })
    .join("");
}

/**
 * Finisarea unei traduceri: punctele de suspensie din sursă rămân „…” (traducătorul le face „..”), iar spațiile
 * adăugate imediat după un tag de deschidere sau înaintea unuia de închidere dispar.
 */
export function polish(source: string, translated: string): string {
  let out = translated.replace(/<([a-z][a-z0-9]*)(\s[^<>]*)?>\s+/gi, "<$1$2>").replace(/\s+<\/([a-z][a-z0-9]*)>/gi, "</$1>");
  if (source.trimEnd().endsWith("…")) out = out.replace(/[.…]+(\s*)$/, "…$1");
  return out;
}

/**
 * Mesajul sursă, netradus, dar cu pluralele pe categoriile limbii țintă (ex. `many` în spaniolă și franceză): textul de
 * rezervă când traducerea unui mesaj nu trece validarea.
 */
export function adaptPlurals(message: string, target: string): string {
  const adapt = (els: MessageFormatElement[]): MessageFormatElement[] =>
    els.map((el) => {
      if (!isBranching(el)) return el;
      const options: Record<string, { value: MessageFormatElement[] }> = {};
      let keys = Object.keys(el.options);
      if (el.type === TYPE.plural && el.pluralType !== "ordinal") {
        const categories = new Intl.PluralRules(target).resolvedOptions().pluralCategories as string[];
        keys = [...keys.filter((k) => k.startsWith("=")), ...categories];
      }
      for (const key of keys) options[key] = { value: adapt((el.options[key] ?? el.options.other)!.value) };
      return { ...el, options } as PluralElement | SelectElement;
    });
  try {
    const els = parse(message, { ignoreTag: true });
    return els.some((e) => isBranching(e)) ? printMessage(adapt(els)) : message;
  } catch {
    return message;
  }
}

/** Numele argumentelor unui mesaj (pentru verificarea că traducerea le păstrează). */
export function argumentNames(message: string): string[] {
  const names = new Set<string>();
  const walk = (els: MessageFormatElement[]) => {
    for (const el of els) {
      if ("value" in el && typeof el.value === "string" && el.type !== TYPE.literal) names.add(el.value);
      if (isBranching(el)) for (const o of Object.values(el.options)) walk(o.value);
      if (el.type === TYPE.tag) walk(el.children);
    }
  };
  walk(parse(message, { ignoreTag: true }));
  return [...names].sort();
}

/** O traducere e acceptată doar dacă se compilează în limba țintă și are aceleași argumente ca sursa. */
export function isValidTranslation(source: string, translated: string, target: string): boolean {
  try {
    new IntlMessageFormat(translated, target, undefined, { ignoreTag: true });
    return JSON.stringify(argumentNames(source)) === JSON.stringify(argumentNames(translated));
  } catch {
    return false;
  }
}

/**
 * Traduce mai multe mesaje ICU (sursa: engleză). Un mesaj a cărui traducere nu trece validarea rămâne `null`
 * (apelantul păstrează textul englez și reîncearcă data viitoare).
 */
export async function translateMessages(messages: string[], target: string, translator: GcsHtmlTranslator, batchSize = 25): Promise<(string | null)[]> {
  const parsed = messages.map((m) => {
    try {
      const jobs: Job[] = [];
      const root = collect(parse(m, { ignoreTag: true }), jobs);
      return { jobs, root };
    } catch {
      return null;
    }
  });
  // Toate fragmentele, în loturi.
  const all: string[] = parsed.flatMap((p) => (p ? p.jobs.map((j) => j.text) : []));
  const translated: string[] = [];
  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize);
    // Fragmentele fără text (doar jetoane) nu se trimit.
    const needs = batch.map((h) => /[\p{L}]/u.test(h.replace(TOKEN_RE, "")));
    const sent = batch.filter((_, k) => needs[k]);
    const result = sent.length > 0 ? await translator(sent, target) : [];
    let r = 0;
    for (const [k, h] of batch.entries()) translated.push(needs[k] ? (result[r++] ?? h) : h);
  }
  let offset = 0;
  return parsed.map((p, i) => {
    if (!p) return null;
    const mine = translated.slice(offset, offset + p.jobs.length);
    offset += p.jobs.length;
    const elements = rebuild(p.jobs[p.root]!, mine[p.root]!, mine, p.jobs, target);
    if (!elements) return null;
    const out = polish(messages[i]!, printMessage(elements));
    return isValidTranslation(messages[i]!, out, target) ? out : null;
  });
}

/** `{ a: { b: "x" } }` → `{ "a.b": "x" }` și invers. */
export function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else if (typeof v === "string") out[key] = v;
  }
  return out;
}

export function unflatten(flat: Record<string, string>, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) {
    if (!(key in flat)) continue;
    const parts = key.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[parts[parts.length - 1]!] = flat[key];
  }
  return out;
}
