/**
 * CSS-ul sursei (fișiere CSS, CSS din șabloane, LESS) → `assets/style.css` al pluginului:
 * - construcțiile de șablon (`{resource=…}`, `{{if}}`, `{{ property() }}`) dispar;
 * - declarațiile nesigure sau care nu pot funcționa în plugin dispar: `\` (escape-uri), `url()` (resursele sursei nu
 *   sunt în pachet), variabile și mixin-uri LESS (`@x`, `.mixin();`), `expression`, `behavior`;
 * - selectorii primesc aceleași clase prefixate ca HTML-ul (`.box` → `.gcsp-box`, `#id` → `.gcsp-id-id`);
 * - fiecare regulă de pe primul nivel trece prin `scopePluginCss` (aceeași verificare ca la instalare); cele respinse
 *   (`@import`, `@font-face`, `@keyframes`, selectori `&`…) se numără în raport.
 */
import { scopePluginCss } from "@gcs/core";
import { commentText } from "../text";
import type { GcsPortStyle } from "../types";
import { prefixClass } from "./template";

type CssItem = { prelude: string; body: string | CssItem[] } | { decls: string };

/** Împarte CSS-ul în reguli (`prelude { … }`) și declarații, recursiv pentru blocurile care conțin reguli. */
function parseItems(css: string): CssItem[] | null {
  const items: CssItem[] = [];
  let i = 0;
  let start = 0;
  while (i < css.length) {
    const c = css[i]!;
    if (c === '"' || c === "'") {
      const end = css.indexOf(c, i + 1);
      if (end === -1) return null;
      i = end + 1;
      continue;
    }
    if (c === "{") {
      let depth = 1;
      let j = i + 1;
      for (; j < css.length && depth > 0; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        else if (css[j] === '"' || css[j] === "'") {
          const end = css.indexOf(css[j]!, j + 1);
          if (end === -1) return null;
          j = end;
        }
      }
      if (depth > 0) return null;
      const prelude = css.slice(start, i).trim();
      const inner = css.slice(i + 1, j - 1);
      // Declarațiile dinaintea regulii (fără `;` final) rămân ale părintelui.
      const lastSemi = prelude.lastIndexOf(";");
      if (lastSemi !== -1) items.push({ decls: prelude.slice(0, lastSemi + 1) });
      const head = lastSemi === -1 ? prelude : prelude.slice(lastSemi + 1).trim();
      if (inner.includes("{")) {
        const nested = parseItems(inner);
        if (nested === null) return null;
        items.push({ prelude: head, body: nested });
      } else items.push({ prelude: head, body: inner });
      i = j;
      start = j;
      continue;
    }
    if (c === "}") return null;
    i++;
  }
  const rest = css.slice(start).trim();
  if (rest) items.push({ decls: rest });
  return items;
}

/** Declarațiile păstrate dintr-un bloc (`prop: valoare;`), fără cele nesigure sau LESS. */
function cleanDecls(body: string, stats: GcsCssStats): string {
  const out: string[] = [];
  for (const raw of body.split(";")) {
    const d = raw.trim();
    if (!d) continue;
    const colon = d.indexOf(":");
    const ok =
      colon > 0 &&
      /^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(d.slice(0, colon).trim()) &&
      !/[\\<>{}@]|url\s*\(|expression\s*\(|javascript:|behavior|-moz-binding|image-set/i.test(d);
    if (ok) out.push(d);
    else stats.declarations++;
  }
  return out.length ? `${out.join("; ")};` : "";
}

/** Selectorii cu clasele prefixate (`.box` → `.gcsp-box`, `#id` → `.gcsp-id-id`). */
export function prefixSelector(prelude: string): string {
  return prelude
    .replace(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g, (_m, name: string) => `.${prefixClass(name)}`)
    .replace(/#([A-Za-z][\w-]*)/g, (_m, id: string) => `.gcsp-id-${id}`);
}

function render(items: CssItem[], stats: GcsCssStats, depth: number): string {
  const out: string[] = [];
  for (const item of items) {
    if ("decls" in item) {
      // Pe primul nivel nu există declarații: sunt instrucțiuni (`@import`, variabile și mixin-uri LESS), scoase.
      if (depth === 0) stats.rules += item.decls.split(";").filter((s) => s.trim()).length;
      else {
        const d = cleanDecls(item.decls, stats);
        if (d) out.push(d);
      }
      continue;
    }
    const at = item.prelude.startsWith("@");
    if (at && !/^@(?:media|supports|container)\b/i.test(item.prelude)) {
      stats.rules++;
      continue;
    }
    if (!at && /&/.test(item.prelude)) {
      stats.rules++;
      continue;
    }
    const prelude = at ? item.prelude : prefixSelector(item.prelude);
    const body = typeof item.body === "string" ? cleanDecls(item.body, stats) : render(item.body, stats, depth + 1);
    if (body) out.push(`${prelude} {\n  ${body.replace(/\n/g, "\n  ")}\n}`);
  }
  return out.join("\n");
}

export type GcsCssStats = { rules: number; declarations: number; files: number };

/**
 * Toate stilurile sursei într-un singur fișier, verificat cu regulile de instalare (`scopePluginCss`). `null` dacă nu
 * rămâne nicio regulă.
 */
export function convertStyles(styles: GcsPortStyle[], pluginKey: string): { css: string | null; stats: GcsCssStats } {
  const stats: GcsCssStats = { rules: 0, declarations: 0, files: 0 };
  const parts: string[] = [];
  for (const style of styles.slice(0, 100)) {
    // Construcțiile de șablon și comentariile dispar înainte de parsare.
    const text = style.body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\{[\s\S]*?\}\}/g, "")
      .replace(/\{(?:\$|[a-z]+=)[^{}\n]*\}/g, "")
      .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, "");
    const items = parseItems(text);
    if (!items) {
      stats.files++;
      continue;
    }
    // Fiecare regulă de pe primul nivel se verifică separat: una respinsă nu strică restul fișierului.
    const kept: string[] = [];
    for (const item of items) {
      const rule = render([item], stats, 0);
      if (!rule) continue;
      if (scopePluginCss(rule, { pluginKey, file: "assets/style.css" }).ok) kept.push(rule);
      else stats.rules++;
    }
    if (kept.length) parts.push(`/* ${commentText(style.name).replace(/\*/g, "")} (${commentText(style.origin).replace(/\*/g, "")}) */\n${kept.join("\n")}`);
  }
  if (parts.length === 0) return { css: null, stats };
  const css = `/* Generat de asistentul de portare GCS: clasele sunt prefixate cu gcsp-, totul e închis în containerul pluginului. */\n${parts.join("\n\n")}\n`;
  return scopePluginCss(css, { pluginKey, file: "assets/style.css" }).ok ? { css, stats } : { css: null, stats: { ...stats, files: stats.files + 1 } };
}
