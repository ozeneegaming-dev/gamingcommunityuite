import { Parser } from "htmlparser2";
import sanitizeHtml from "sanitize-html";

/**
 * Sanitizer-ul HTML-ului produs de șabloane (specul etapei 6, §3.1): orice ieșire a unui șablon trece pe aici înainte
 * să ajungă în pagină sau într-un email. Lista e una de taguri și atribute **permise**: fără `script`, `style`,
 * `iframe`, `object`, `form`, `input`; fără atribute `on*`; linkuri și imagini doar `http(s)`, `mailto` sau căi
 * relative; `style` doar cu declarații verificate.
 */

const COMMON_TAGS = [
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "meter",
  "nav",
  "ol",
  "p",
  "pre",
  "progress",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
  // Iconițele (`{% icon %}`) și desene simple.
  "svg",
  "path",
  "g",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
];

const SVG_ATTRS = ["viewbox", "width", "height", "fill", "xmlns", "focusable", "preserveaspectratio", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "transform"];
const SHAPE_ATTRS = ["d", "fill", "fill-rule", "clip-rule", "stroke", "stroke-width", "opacity", "transform", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points"];

const COMMON_ATTRS: sanitizeHtml.IOptions["allowedAttributes"] = {
  "*": ["class", "id", "title", "role", "lang", "dir", "hidden", "tabindex", "style", "aria-*", "data-*"],
  a: ["href", "rel", "target", "hreflang"],
  img: ["src", "alt", "width", "height", "loading", "decoding"],
  time: ["datetime"],
  data: ["value"],
  td: ["colspan", "rowspan", "headers"],
  th: ["colspan", "rowspan", "scope", "headers"],
  col: ["span"],
  colgroup: ["span"],
  ol: ["start", "reversed", "type"],
  li: ["value"],
  details: ["open"],
  progress: ["value", "max"],
  meter: ["value", "min", "max", "low", "high", "optimum"],
  q: ["cite"],
  blockquote: ["cite"],
  svg: SVG_ATTRS,
  path: SHAPE_ATTRS,
  g: SHAPE_ATTRS,
  circle: SHAPE_ATTRS,
  rect: SHAPE_ATTRS,
  line: SHAPE_ATTRS,
  polyline: SHAPE_ATTRS,
  polygon: SHAPE_ATTRS,
};

/** Emailurile: tabelele de layout au nevoie de atributele vechi de prezentare. */
const EMAIL_TABLE_ATTRS = ["width", "height", "align", "valign", "bgcolor", "border", "cellpadding", "cellspacing"];

const ID_RE = /^[A-Za-z][\w-]{0,63}$/;
const PROPERTY_RE = /^(?:--[A-Za-z0-9-]{1,60}|-?[a-z][a-z-]{0,40})$/;
/** Ce nu poate apărea niciodată într-o valoare `style` (execuție veche de cod, încărcări, ieșiri din atribut). */
const FORBIDDEN_STYLE = /expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|@import|\\|<|\/\*|image-set\s*\(|src\s*\(/i;
const URL_IN_STYLE = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;

/** Împarte un `style` în declarații (`;` din paranteze sau ghilimele nu desparte). */
function declarations(style: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    const c = style[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      out.push(style.slice(start, i));
      start = i + 1;
    }
  }
  out.push(style.slice(start));
  return out.map((d) => d.trim()).filter(Boolean);
}

/**
 * Filtrează un atribut `style`: doar declarații `proprietate: valoare` cu nume valid, fără vectorii vechi de execuție
 * și cu `url()` doar spre `https:` sau fișierele site-ului (`/files/…`), ca în CSS-ul temelor.
 */
export function sanitizeStyleAttribute(style: string): string {
  const kept: string[] = [];
  for (const decl of declarations(style)) {
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const name = decl.slice(0, colon).trim();
    const prop = name.startsWith("--") ? name : name.toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!PROPERTY_RE.test(prop) || !value || value.length > 500 || FORBIDDEN_STYLE.test(value)) continue;
    // Fiecare `url(` trebuie să fie un `url(...)` complet, spre `https:` sau `/files/`.
    const opened = (value.match(/url\s*\(/gi) ?? []).length;
    if (opened > 0) {
      const urls = [...value.matchAll(URL_IN_STYLE)];
      if (urls.length !== opened || urls.some((m) => !/^(https:\/\/|\/files\/)/i.test(m[2]!.trim()))) continue;
    }
    kept.push(`${prop}:${value}`);
  }
  return kept.join(";");
}

function options(mode: "site" | "email"): sanitizeHtml.IOptions {
  const allowedAttributes = { ...COMMON_ATTRS };
  if (mode === "email") {
    for (const tag of ["table", "td", "th", "tr", "tbody", "thead", "tfoot", "img"]) {
      allowedAttributes[tag] = [...(allowedAttributes[tag] ?? []), ...EMAIL_TABLE_ATTRS];
    }
  } else {
    allowedAttributes["gcs-slot"] = ["data-name"];
  }
  return {
    allowedTags: mode === "site" ? [...COMMON_TAGS, "gcs-slot"] : COMMON_TAGS,
    allowedAttributes,
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attribs) => {
        const next = { ...attribs };
        if (next.target && next.target !== "_blank" && next.target !== "_self") delete next.target;
        if (next.target === "_blank") {
          const rel = new Set((next.rel ?? "").split(/\s+/).filter(Boolean));
          rel.add("noopener");
          next.rel = [...rel].join(" ");
        }
        return { tagName, attribs: next };
      },
      "*": (tagName, attribs) => {
        const next = { ...attribs };
        if (next.style !== undefined) {
          const style = sanitizeStyleAttribute(next.style);
          if (style) next.style = style;
          else delete next.style;
        }
        if (next.id !== undefined && !ID_RE.test(next.id)) delete next.id;
        if (next.tabindex !== undefined && !/^-?\d{1,3}$/.test(next.tabindex)) delete next.tabindex;
        return { tagName, attribs: next };
      },
    },
  };
}

const SITE_OPTIONS = options("site");
const EMAIL_OPTIONS = options("email");

/** HTML-ul unui șablon, gata de pus în pagină (`site`) sau într-un email (`email`: plus atributele tabelelor). */
export function sanitizeTemplateHtml(html: string, mode: "site" | "email" = "site"): string {
  return sanitizeHtml(html, mode === "site" ? SITE_OPTIONS : EMAIL_OPTIONS);
}

/** Un atribut `style` deja sanitizat → obiect (proprietățile cu numele din CSS: `font-size`, `--gcs-x`). */
export function parseStyleAttribute(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of declarations(style)) {
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const name = decl.slice(0, colon).trim();
    out[name.startsWith("--") ? name : name.toLowerCase()] = decl.slice(colon + 1).trim();
  }
  return out;
}

// ─── HTML → arbore (pentru React) ────────────────────────────────────────────

export type GcsHtmlNode = { type: "text"; text: string } | { type: "element"; name: string; attrs: Record<string, string>; children: GcsHtmlNode[] };

const VOID = new Set(["area", "br", "col", "hr", "img", "wbr", "source", "input", "meta", "link"]);

/**
 * Arborele unui HTML **deja sanitizat** (site-ul îl transformă în elemente React, fără `innerHTML`). Textul și
 * atributele sunt decodate (React le escapează din nou).
 */
export function parseHtmlTree(html: string): GcsHtmlNode[] {
  const root: GcsHtmlNode[] = [];
  const stack: { name: string; children: GcsHtmlNode[] }[] = [{ name: "#root", children: root }];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const el: GcsHtmlNode = { type: "element", name, attrs: { ...attrs }, children: [] };
        stack[stack.length - 1]!.children.push(el);
        if (!VOID.has(name)) stack.push({ name, children: el.children });
      },
      ontext(text) {
        const children = stack[stack.length - 1]!.children;
        const last = children[children.length - 1];
        if (last?.type === "text") last.text += text;
        else children.push({ type: "text", text });
      },
      onclosetag(name) {
        if (VOID.has(name)) return;
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i]!.name === name) {
            stack.length = i;
            return;
          }
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true },
  );
  parser.write(html);
  parser.end();
  return root;
}
