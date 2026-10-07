import { forbiddenCss, normalizeCssNewlines } from "../plugins/css";

/**
 * Stilurile scrise în CSS de un admin, în ACP-ul unui plugin cu `appearance` (stil de nume sau de banner). Adminul e de
 * încredere ca la CSS-ul temei, dar textul e tot verificat și închis de nucleu:
 * - doar declarații, blocuri `::before { }` / `::after { }` și `@keyframes nume { }` (fără niciun selector scris de
 *   admin: selectorul îl pune nucleul — clasa stilului și numele membrilor care l-au ales);
 * - aceleași interdicții ca la CSS-ul pluginurilor (`<`, `\`, `@import`, `expression(`, `javascript:`, `behavior:`,
 *   `-moz-binding`…), fără `!important`, fără `position: fixed / sticky`, fără `image-set(` / `src(`;
 * - `url()` doar spre fișierele pluginului (`/plugins/<cheie>/assets/…` sau `/plugins/<cheie>/media/…`);
 * - numele `@keyframes` primesc prefixul stilului (nu ating animațiile site-ului), iar animațiile se opresc singure sub
 *   `prefers-reduced-motion`.
 * Erorile au linia lor, ca formularul din ACP să le poată arăta.
 */

export const CUSTOM_STYLE_KINDS = ["name", "banner"] as const;
export type GcsCustomStyleKind = (typeof CUSTOM_STYLE_KINDS)[number];
export const CUSTOM_STYLE_KEY = /^[a-z0-9_]{1,40}$/;
export const CUSTOM_STYLE_MAX = 12_000;

export type GcsCustomStyleError = { line: number; code: string; detail?: string };
type Decl = { prop: string; value: string };
export type GcsParsedCustomStyle = { main: Decl[]; before: Decl[]; after: Decl[]; keyframes: { name: string; frames: { selector: string; decls: Decl[] }[] }[] };
export type GcsCustomStyleParse = { ok: true; style: GcsParsedCustomStyle } | { ok: false; errors: GcsCustomStyleError[] };

const PROP = /^(?:--[a-z0-9-]{1,40}|-?[a-z][a-z0-9-]{0,40})$/i;
const KEYFRAME_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const KEYFRAME_SELECTOR = /^(?:from|to|\d{1,3}(?:\.\d{1,3})?%)(?:\s*,\s*(?:from|to|\d{1,3}(?:\.\d{1,3})?%))*$/i;
const MAX_DECLS = 80;
const MAX_KEYFRAMES = 8;

/** Clasa unui stil (pe numele sau banner-ul membrilor care l-au ales și în previzualizările pluginului). */
export function customStyleClass(pluginKey: string, kind: GcsCustomStyleKind, key: string): string {
  return `gcs-${kind}Style--${pluginKey.replace(/[^a-z0-9_]/g, "-")}--${key}`;
}

/** Calea unui fișier al pluginului în `url()`: doar imagini din pachet sau încărcate. */
function ownUrl(raw: string, pluginKey: string): string | null {
  const url = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
  const prefix = `/plugins/${pluginKey}/`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  if (rest.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
  return /^(?:assets\/[A-Za-z0-9_-][A-Za-z0-9._/-]{0,180}\.(?:png|jpe?g|gif|webp)|media\/[a-z0-9]{10,40}\.(?:webp|png|jpg|gif))$/.test(rest) ? url : null;
}

/**
 * Citește și verifică CSS-ul unui stil. Gramatica e mică: declarații `proprietate: valoare;`, blocurile `::before` și
 * `::after` (doar declarații) și `@keyframes nume { from / to / N% { declarații } }`.
 */
export function parseCustomStyle(source: string, opts: { pluginKey: string }): GcsCustomStyleParse {
  const errors: GcsCustomStyleError[] = [];
  if (typeof source !== "string") return { ok: false, errors: [{ line: 1, code: "css_empty" }] };
  if (source.length > CUSTOM_STYLE_MAX) return { ok: false, errors: [{ line: 1, code: "css_too_large", detail: String(CUSTOM_STYLE_MAX) }] };
  const css = normalizeCssNewlines(source);
  const lineAt = (index: number) => css.slice(0, index).split("\n").length;
  const bad = forbiddenCss(css);
  if (bad) return { ok: false, errors: [{ line: lineAt(bad.index), code: "css_forbidden", detail: bad.detail === "control" ? "control" : bad.detail.trim() }] };

  let pos = 0;
  const style: GcsParsedCustomStyle = { main: [], before: [], after: [], keyframes: [] };

  /** Sare peste spații și comentarii; un comentariu neînchis e o eroare. */
  const skip = (): boolean => {
    for (;;) {
      while (pos < css.length && /\s/.test(css[pos]!)) pos++;
      if (css.startsWith("/*", pos)) {
        const end = css.indexOf("*/", pos + 2);
        if (end === -1) {
          errors.push({ line: lineAt(pos), code: "css_syntax", detail: "comment" });
          pos = css.length;
          return false;
        }
        pos = end + 2;
        continue;
      }
      return true;
    }
  };

  /** Textul până la unul dintre caracterele date (în afara șirurilor și a parantezelor). */
  const until = (stops: string): { text: string; stop: string | null; start: number } => {
    const start = pos;
    let depth = 0;
    while (pos < css.length) {
      const c = css[pos]!;
      if (c === '"' || c === "'") {
        const end = css.indexOf(c, pos + 1);
        const newline = css.indexOf("\n", pos + 1);
        if (end === -1 || (newline !== -1 && newline < end)) {
          errors.push({ line: lineAt(pos), code: "css_syntax", detail: "string" });
          pos = css.length;
          return { text: css.slice(start), stop: null, start };
        }
        pos = end + 1;
        continue;
      }
      if (css.startsWith("/*", pos)) {
        const end = css.indexOf("*/", pos + 2);
        pos = end === -1 ? css.length : end + 2;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0 && stops.includes(c)) return { text: css.slice(start, pos), stop: c, start };
      pos++;
    }
    return { text: css.slice(start), stop: null, start };
  };

  const declaration = (raw: string, start: number): Decl | null => {
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
    if (!text) return null;
    const line = lineAt(start + (raw.length - raw.trimStart().length));
    const colon = text.indexOf(":");
    if (colon === -1) {
      errors.push({ line, code: "css_declaration", detail: text.slice(0, 60) });
      return null;
    }
    const prop = text.slice(0, colon).trim().toLowerCase();
    let value = text.slice(colon + 1).trim();
    if (!PROP.test(prop)) {
      errors.push({ line, code: "css_property", detail: prop.slice(0, 60) });
      return null;
    }
    if (!value) {
      errors.push({ line, code: "css_declaration", detail: prop });
      return null;
    }
    if (/!\s*important/i.test(value)) {
      errors.push({ line, code: "css_important", detail: prop });
      return null;
    }
    if (prop === "position" && /\b(?:fixed|sticky)\b/i.test(value)) {
      errors.push({ line, code: "css_position", detail: value.slice(0, 30) });
      return null;
    }
    if (/(?:image-set|src)\s*\(/i.test(value)) {
      errors.push({ line, code: "css_url", detail: /(?:image-set|src)\s*\(/i.exec(value)![0] });
      return null;
    }
    let urlError: string | null = null;
    value = value.replace(/url\(\s*([^)]*?)\s*\)/gi, (_m, inner: string) => {
      const ok = ownUrl(inner, opts.pluginKey);
      if (!ok) urlError = inner.slice(0, 80);
      return ok ? `url("${ok}")` : "none";
    });
    if (urlError !== null) {
      errors.push({ line, code: "css_url", detail: urlError });
      return null;
    }
    if (value.length > 800) {
      errors.push({ line, code: "css_value_too_long", detail: prop });
      return null;
    }
    return { prop, value };
  };

  /** Declarațiile unui bloc, până la `}`. */
  const declarations = (into: Decl[], openedAt: number): void => {
    for (;;) {
      if (!skip()) return;
      if (pos >= css.length) {
        errors.push({ line: lineAt(openedAt), code: "css_braces" });
        return;
      }
      if (css[pos] === "}") {
        pos++;
        return;
      }
      if (css[pos] === "{" || css[pos] === "@") {
        errors.push({ line: lineAt(pos), code: "css_nested", detail: css.slice(pos, pos + 20).split("\n")[0] });
        // Sare blocul greșit, ca să găsească și alte erori.
        const close = css.indexOf("}", pos);
        pos = close === -1 ? css.length : close + 1;
        continue;
      }
      const { text, stop, start } = until(";}{");
      if (stop === "{") {
        errors.push({ line: lineAt(start), code: "css_selector", detail: text.trim().slice(0, 60) });
        const close = css.indexOf("}", pos);
        pos = close === -1 ? css.length : close + 1;
        continue;
      }
      const d = declaration(text, start);
      if (d) {
        if (into.length >= MAX_DECLS) errors.push({ line: lineAt(start), code: "css_too_many_declarations" });
        else into.push(d);
      }
      if (stop === ";") pos++;
    }
  };

  while (pos < css.length) {
    if (!skip() || pos >= css.length) break;
    const at = pos;
    if (css[pos] === "}") {
      errors.push({ line: lineAt(pos), code: "css_braces" });
      pos++;
      continue;
    }
    if (css[pos] === "@") {
      const { text, stop } = until("{;");
      const m = /^@keyframes\s+([^\s{]+)\s*$/i.exec(text.trim());
      if (stop !== "{" || !m) {
        errors.push({ line: lineAt(at), code: "css_at_rule", detail: text.trim().split(/\s/)[0]?.slice(0, 30) });
        if (stop === "{") {
          let depth = 0;
          for (; pos < css.length; pos++) {
            if (css[pos] === "{") depth++;
            else if (css[pos] === "}" && --depth === 0) break;
          }
        }
        pos++;
        continue;
      }
      const name = m[1]!;
      if (!KEYFRAME_NAME.test(name)) errors.push({ line: lineAt(at), code: "css_keyframes_name", detail: name.slice(0, 40) });
      if (style.keyframes.length >= MAX_KEYFRAMES) errors.push({ line: lineAt(at), code: "css_too_many_keyframes" });
      if (style.keyframes.some((k) => k.name === name)) errors.push({ line: lineAt(at), code: "css_keyframes_duplicate", detail: name });
      pos++;
      const frames: { selector: string; decls: Decl[] }[] = [];
      for (;;) {
        if (!skip()) break;
        if (pos >= css.length) {
          errors.push({ line: lineAt(at), code: "css_braces" });
          break;
        }
        if (css[pos] === "}") {
          pos++;
          break;
        }
        const sel = until("{};");
        if (sel.stop !== "{") {
          errors.push({ line: lineAt(sel.start), code: "css_keyframes_selector", detail: sel.text.trim().slice(0, 30) });
          pos++;
          continue;
        }
        const selector = sel.text.trim();
        if (!KEYFRAME_SELECTOR.test(selector)) errors.push({ line: lineAt(sel.start), code: "css_keyframes_selector", detail: selector.slice(0, 30) });
        pos++;
        const decls: Decl[] = [];
        declarations(decls, sel.start);
        frames.push({ selector: selector.toLowerCase(), decls });
      }
      style.keyframes.push({ name, frames });
      continue;
    }
    if (css[pos] === ":") {
      const { text, stop, start } = until("{;}");
      const head = text.trim().toLowerCase();
      if (stop === "{" && (head === "::before" || head === ":before" || head === "::after" || head === ":after")) {
        pos++;
        declarations(head.endsWith("before") ? style.before : style.after, start);
        continue;
      }
      errors.push({ line: lineAt(start), code: stop === "{" ? "css_selector" : "css_declaration", detail: head.slice(0, 60) });
      if (stop === "{") {
        const close = css.indexOf("}", pos);
        pos = close === -1 ? css.length : close + 1;
      } else pos++;
      continue;
    }
    const { text, stop, start } = until(";{}");
    if (stop === "{") {
      errors.push({ line: lineAt(start), code: "css_selector", detail: text.trim().slice(0, 60) });
      const close = css.indexOf("}", pos);
      pos = close === -1 ? css.length : close + 1;
      continue;
    }
    const d = declaration(text, start);
    if (d) {
      if (style.main.length >= MAX_DECLS) errors.push({ line: lineAt(start), code: "css_too_many_declarations" });
      else style.main.push(d);
    }
    if (stop === ";") pos++;
  }
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 30) };
  if (style.main.length + style.before.length + style.after.length === 0) return { ok: false, errors: [{ line: 1, code: "css_empty" }] };
  return { ok: true, style };
}

/** Prefixul animațiilor unui stil (nume valide de `@keyframes`). */
export function customStylePrefix(pluginKey: string, kind: GcsCustomStyleKind, key: string): string {
  return `gcsu-${pluginKey.replace(/[^a-z0-9_]/g, "_")}-${kind}-${key}-`;
}

/** Declarațiile cu numele animațiilor proprii prefixate (doar în `animation` / `animation-name`). */
function renamed(decls: Decl[], names: Set<string>, prefix: string): string {
  return decls
    .map((dcl) => {
      if (dcl.prop !== "animation" && dcl.prop !== "animation-name") return `${dcl.prop}:${dcl.value}`;
      const value = dcl.value.replace(/(^|[\s,])([A-Za-z][A-Za-z0-9_-]*)(?=$|[\s,])/g, (m, lead: string, ident: string) => (names.has(ident) ? `${lead}${prefix}${ident}` : m));
      return `${dcl.prop}:${value}`;
    })
    .join(";");
}

/**
 * CSS-ul unui stil verificat, pe selectorii dați de nucleu (clasa stilului și numele membrilor), cu animațiile
 * prefixate și oprite sub `prefers-reduced-motion`.
 */
export function compileCustomStyle(style: GcsParsedCustomStyle, opts: { selectors: string[]; prefix: string }): string {
  if (opts.selectors.length === 0) return "";
  const names = new Set(style.keyframes.map((k) => k.name));
  const sel = opts.selectors.join(",");
  const pseudo = (p: string) => opts.selectors.map((s) => `${s}${p}`).join(",");
  const out: string[] = [];
  if (style.main.length) out.push(`${sel}{${renamed(style.main, names, opts.prefix)}}`);
  if (style.before.length) out.push(`${pseudo("::before")}{${renamed(style.before, names, opts.prefix)}}`);
  if (style.after.length) out.push(`${pseudo("::after")}{${renamed(style.after, names, opts.prefix)}}`);
  for (const k of style.keyframes) out.push(`@keyframes ${opts.prefix}${k.name}{${k.frames.map((f) => `${f.selector}{${renamed(f.decls, names, opts.prefix)}}`).join("")}}`);
  out.push(`@media (prefers-reduced-motion: reduce){${sel},${pseudo("::before")},${pseudo("::after")}{animation:none!important;transition:none!important}}`);
  return out.join("\n");
}
