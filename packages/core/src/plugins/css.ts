import { pluginCssScope } from "./catalog";

export type GcsPluginCssResult = { ok: true; css: string } | { ok: false; code: string; detail?: string };

const MAX_CSS = 200_000;

/**
 * Pregătește CSS-ul unui plugin (`client.styles`) pentru browser:
 * - respinge `<`, `@import`, `@charset`, `expression(`, `javascript:`, `behavior`, `-moz-binding`, escape-urile `\`
 *   (ar putea ascunde oricare dintre ele) și acoladele dezechilibrate (ar închide containerul);
 * - `url()` doar spre fișierele pluginului (căi relative, rescrise spre `/plugins/<cheie>/…`) sau `data:image/…`;
 *   nimic spre alte site-uri (fără exfiltrare prin CSS);
 * - totul e închis în clasa pluginului: `.gcsp--<vendor>--<nume> { … }` (CSS imbricat), deci nu atinge restul paginii.
 */
export function scopePluginCss(css: string, opts: { pluginKey: string; file: string }): GcsPluginCssResult {
  if (css.length > MAX_CSS) return { ok: false, code: "css_too_large" };
  // Browserul transformă CR, CRLF și FF în LF înainte de parsare (un șir se termină acolo); normalizăm la fel, ca textul
  // verificat mai jos să fie exact cel servit. Celelalte caractere de control (NUL, ESC, DEL…) nu au ce căuta în CSS.
  css = css.replace(/\r\n?|\f/g, "\n");
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(css)) return { ok: false, code: "css_forbidden", detail: "control" };
  if (/[<\\]/.test(css)) return { ok: false, code: "css_forbidden", detail: css.includes("<") ? "<" : "\\" };
  // `behavior:` (proprietatea veche a IE), dar nu `scroll-behavior` / `overscroll-behavior`.
  const forbidden = /@import|@charset|expression\s*\(|javascript\s*:|vbscript\s*:|(?<![\w-])behavior\s*:|-moz-binding|@namespace/i.exec(css);
  if (forbidden) return { ok: false, code: "css_forbidden", detail: forbidden[0] };

  // Acoladele, ignorând comentariile și șirurile: adâncimea nu poate coborî sub zero și trebuie să revină la zero.
  // Fiecare selector (textul dinaintea unei `{`) rămâne în container: fără `&` și fără `+`/`~` la început (frați ai
  // containerului); dintre at-rules, doar `@media`, `@supports` și `@container`.
  let depth = 0;
  let prelude = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) return { ok: false, code: "css_syntax", detail: "comment" };
      i = end + 1;
    } else if (c === '"' || c === "'") {
      const end = css.indexOf(c, i + 1);
      const newline = css.indexOf("\n", i + 1);
      if (end === -1 || (newline !== -1 && newline < end)) return { ok: false, code: "css_syntax", detail: "string" };
      prelude += "s";
      i = end;
    } else if (c === "{") {
      const head = prelude.trim();
      if (head.startsWith("@")) {
        if (!/^@(?:media|supports|container)\b/i.test(head)) return { ok: false, code: "css_unsupported", detail: head.split(/\s/)[0] };
      } else {
        for (const selector of head.split(",")) {
          const s = selector.trim();
          if (s === "" || s.includes("&") || /^[+~]/.test(s)) return { ok: false, code: "css_selector", detail: s.slice(0, 60) || "{" };
        }
      }
      depth++;
      prelude = "";
    } else if (c === "}") {
      if (--depth < 0) return { ok: false, code: "css_braces" };
      prelude = "";
    } else if (c === ";") prelude = "";
    else prelude += c;
  }
  if (depth !== 0) return { ok: false, code: "css_braces" };

  const dir = opts.file.includes("/") ? opts.file.slice(0, opts.file.lastIndexOf("/") + 1) : "";
  let bad: string | null = null;
  const rewritten = css.replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (_m, _q: string, raw: string) => {
    const url = raw.trim();
    if (/^data:image\/(?:png|gif|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(url)) return `url("${url}")`;
    const target = `${dir}${url.replace(/^\.\//, "")}`;
    if (!/^[A-Za-z0-9._/-]+$/.test(url) || url.startsWith("/") || target.split("/").some((s) => s === ".." || s === "." || s === "")) {
      bad = url.slice(0, 80);
      return "none";
    }
    return `url("/plugins/${opts.pluginKey}/${target}")`;
  });
  if (bad !== null) return { ok: false, code: "css_url", detail: bad };
  if (/url\s*\(/i.test(rewritten.replace(/url\("[^"]*"\)/g, ""))) return { ok: false, code: "css_url", detail: "url(" };
  if (/image-set\s*\(|@font-face|@keyframes/i.test(rewritten)) return { ok: false, code: "css_unsupported", detail: /image-set|@font-face|@keyframes/i.exec(rewritten)![0] };

  return { ok: true, css: `.${pluginCssScope(opts.pluginKey)} {\n${rewritten.trim()}\n}\n` };
}
