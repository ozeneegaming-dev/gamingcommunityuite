import { Parser } from "htmlparser2";

/** Mărimea maximă a unui SVG încărcat (textul, înainte de curățare). */
export const SVG_MAX_BYTES = 512 * 1024;

/** Elementele de desen păstrate (fără `script`, `foreignObject`, `use` spre alte fișiere, `image`, `a`, animații). */
const TAGS = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "pattern",
  "symbol",
  "use",
  "filter",
  "fegaussianblur",
  "feoffset",
  "feblend",
  "fecolormatrix",
  "fecomposite",
  "feflood",
  "femerge",
  "femergenode",
  "fedropshadow",
]);

/** Numele SVG cu majuscule (parserul le scrie cu litere mici; rasterizatorul are nevoie de forma corectă). */
const CASED: Record<string, string> = {
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  clippath: "clipPath",
  fegaussianblur: "feGaussianBlur",
  feoffset: "feOffset",
  feblend: "feBlend",
  fecolormatrix: "feColorMatrix",
  fecomposite: "feComposite",
  feflood: "feFlood",
  femerge: "feMerge",
  femergenode: "feMergeNode",
  fedropshadow: "feDropShadow",
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  gradientunits: "gradientUnits",
  gradienttransform: "gradientTransform",
  patternunits: "patternUnits",
  patterncontentunits: "patternContentUnits",
  patterntransform: "patternTransform",
  clippathunits: "clipPathUnits",
  maskunits: "maskUnits",
  maskcontentunits: "maskContentUnits",
  stddeviation: "stdDeviation",
  floodcolor: "flood-color",
  spreadmethod: "spreadMethod",
  textlength: "textLength",
  lengthadjust: "lengthAdjust",
  filterunits: "filterUnits",
};

/** Atributele de prezentare și geometrie păstrate (fără `on*`, `style` cu reguli libere, legături externe). */
const ATTRS = new Set([
  "id",
  "class",
  "xmlns",
  "version",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "d",
  "points",
  "transform",
  "viewbox",
  "preserveaspectratio",
  "fill",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "patternunits",
  "patterncontentunits",
  "patterntransform",
  "clippathunits",
  "clip-path",
  "mask",
  "maskunits",
  "maskcontentunits",
  "filter",
  "filterunits",
  "stddeviation",
  "dx",
  "dy",
  "in",
  "in2",
  "result",
  "mode",
  "operator",
  "values",
  "type",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "textlength",
  "lengthadjust",
  "href",
  "xlink:href",
  "xmlns:xlink",
  "display",
  "visibility",
]);

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * O valoare de atribut sigură: legăturile doar spre același document (`#id`), `url(#id)` doar intern, nimic cu
 * `javascript:`, `data:`, adrese sau caractere de control.
 */
function safeValue(name: string, value: string): boolean {
  if (/[\u0000-\u001f]/.test(value) || value.length > 20_000) return false;
  if (name === "href" || name === "xlink:href") return /^#[A-Za-z][\w.-]{0,60}$/.test(value);
  if (name === "xmlns") return value === "http://www.w3.org/2000/svg";
  if (name === "xmlns:xlink") return value === "http://www.w3.org/1999/xlink";
  if (/url\s*\(/i.test(value)) return /^url\(\s*#[A-Za-z][\w.-]{0,60}\s*\)$/.test(value.trim());
  return !/(?:javascript|data|https?)\s*:|expression\s*\(|[<>]/i.test(value);
}

/**
 * Curăță un SVG încărcat (iconițe, fundaluri): doar elementele de desen și atributele de prezentare (listă albă), fără
 * scripturi, evenimente, `foreignObject`, imagini sau legături externe, fără `<!DOCTYPE>` / entități. Întoarce SVG-ul
 * curățat sau `null` dacă textul nu e un SVG (rădăcina trebuie să fie `<svg>`). Apelantul îl rasterizează apoi în WebP.
 */
export function sanitizeSvg(input: string): string | null {
  if (input.length > SVG_MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(input)) return null;
  let out = "";
  let depth = 0;
  let skip = 0;
  let root = false;
  let rootClosed = false;
  // Închiderile făcute de `end()` sunt ale etichetelor rămase deschise: un SVG neterminat e refuzat.
  let ending = false;
  let unclosed = false;
  const parser = new Parser(
    {
      onopentag(rawName, attrs) {
        const name = rawName.toLowerCase();
        if (skip > 0 || !TAGS.has(name) || rootClosed || (depth === 0 && name !== "svg")) {
          skip++;
          return;
        }
        if (depth === 0) root = true;
        depth++;
        let tag = `<${CASED[name] ?? name}`;
        for (const [rawAttr, value] of Object.entries(attrs)) {
          const attr = rawAttr.toLowerCase();
          if (!ATTRS.has(attr) || !safeValue(attr, value)) continue;
          tag += ` ${CASED[attr] ?? attr}="${escapeAttr(value)}"`;
        }
        if (name === "svg" && depth === 1 && !("xmlns" in attrs)) tag += ' xmlns="http://www.w3.org/2000/svg"';
        out += `${tag}>`;
      },
      ontext(text) {
        if (skip === 0 && depth > 0) out += escapeText(text);
      },
      onclosetag(rawName) {
        if (ending) unclosed = true;
        if (skip > 0) {
          skip--;
          return;
        }
        if (depth === 0) return;
        depth--;
        const name = rawName.toLowerCase();
        out += `</${CASED[name] ?? name}>`;
        if (depth === 0) rootClosed = true;
      },
    },
    { xmlMode: true, decodeEntities: true, recognizeSelfClosing: true },
  );
  parser.write(input.replace(/^﻿/, "").replace(/<\?xml[^>]*\?>/i, ""));
  ending = true;
  parser.end();
  return root && rootClosed && !unclosed ? out : null;
}

/** Dacă textul unui fișier pare SVG (fără magic bytes: începe, după declarația XML și comentarii, cu `<svg`). */
export function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 2048).toString("utf8").replace(/^﻿/, "");
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head);
}
