import sanitizeHtml from "sanitize-html";

/** HTML-ul maxim acceptat de la un plugin (înainte de sanitizare): widget-uri și puncte de extensie. */
export const PLUGIN_HTML_MAX = 200_000;
/** HTML-ul maxim al unei pagini de plugin (formulare cu multe opțiuni, ex. un catalog). */
export const PLUGIN_PAGE_HTML_MAX = 900_000;

const TAGS = [
  "div",
  "span",
  "p",
  "br",
  "hr",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "small",
  "sub",
  "sup",
  "mark",
  "code",
  "pre",
  "kbd",
  "blockquote",
  "q",
  "abbr",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "img",
  "figure",
  "figcaption",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "aside",
  "time",
  "details",
  "summary",
  "progress",
  "meter",
  "gcs-icon",
];

/** Clasele GCS de prezentare pe care le poate folosi un plugin (restul claselor trebuie să înceapă cu `gcsp-`). */
export const PLUGIN_GCS_CLASSES = [
  "gcs-muted",
  "gcs-prose",
  "gcs-badge",
  "gcs-badge--accent",
  "gcs-badge--ok",
  "gcs-badge--warn",
  "gcs-badge--neutral",
  "gcs-btn",
  "gcs-btn--primary",
  "gcs-btn--ghost",
  "gcs-btn--sm",
  "gcs-tag",
  "gcs-widgetList",
  "gcs-widgetRow",
  "gcs-widgetRow__body",
  "gcs-widgetRow__title",
  "gcs-widgetRow__meta",
  "gcs-sideCard__line",
  "gcs-statGrid",
  "gcs-table",
  "gcs-table__table",
  "gcs-table__th",
  "gcs-table__td",
  "gcs-table__row",
  "gcs-rep--pos",
  "gcs-rep--neg",
  // Forum v2 / Aspect forumuri: pastilele sistemului (insignele subforumurilor) în tonurile temei.
  "gcs-slotChip",
  "gcs-slotTone--accent",
  "gcs-slotTone--neutral",
  "gcs-slotTone--ok",
  "gcs-slotTone--warn",
  "gcs-slotTone--danger",
  "gcs-slotTone--info",
];

/**
 * Clasele GCS de prezentare a membrilor (Studio VIP): un plugin afișează numele și avatarul exact ca nucleul (stilul
 * numelui, rama, hover card-ul prin `data-user-id` pe linkuri).
 */
export const PLUGIN_GCS_MEMBER_CLASSES = [
  "gcs-userLink",
  "gcs-name--*",
  "gcs-avatar",
  "gcs-avatar__img",
  "gcs-avatarFrame",
  "gcs-avatarFrame--*",
  // Previzualizările efectelor numelui și ale stilurilor CSS ale pluginurilor (GCS 0.7.1).
  "gcs-nfx",
  "gcs-nfx--*",
  // Markup-ul comun al numelui (GCS 0.8.0): textul simplu și literele efectelor pe litere.
  "gcs-name",
  "gcs-name__t",
  "gcs-name__ls",
  "gcs-nameStyle--*",
  "gcs-bannerStyle--*",
];

const ICON_NAME = /^fa-(?:solid|regular|brands) fa-[a-z0-9-]{1,60}$/;

/** Formularele și controalele lor: doar în paginile pluginului (site și ACP). */
const FORM_TAGS = ["form", "input", "select", "option", "optgroup", "textarea", "button", "label", "fieldset", "legend", "output"];
/** Elementele media: doar în paginile pluginului, cu surse doar din fișierele lui. */
const MEDIA_TAGS = ["audio", "video", "source"];
const INPUT_TYPES = new Set(["text", "search", "number", "range", "color", "checkbox", "radio", "hidden", "file", "submit", "url"]);
const BUTTON_TYPES = new Set(["submit", "reset", "button"]);
const CONTROL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,59}$/;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Numele și valoarea unei variabile CSS: culoare hex, număr (cu unitate) sau identificator. Fără funcții, `url()`, ghilimele. */
const VAR_NAME = /^--[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const VAR_VALUE = /^(?:#[0-9a-fA-F]{3,8}|-?\d{1,6}(?:\.\d{1,4})?(?:px|%|deg|s|ms|em|rem|vw|vh|fr)?|[A-Za-z][A-Za-z0-9-]{0,40})$/;
const STYLE_MAX = 64 * 1024;
const STYLE_VARS_MAX = 4000;

type Attribs = Record<string, string>;

export type GcsPluginHtmlOptions = {
  /** SVG-ul unei iconițe Font Awesome după nume (`<gcs-icon name="…">`); `null` = iconiță necunoscută (se omite). */
  icon?: (name: string) => string | null;
  /** Cheia pluginului: acțiunile formularelor și sursele media trebuie să fie ale lui. */
  pluginKey?: string;
  /** O pagină a pluginului (site sau ACP): formulare și elemente media (cere `pluginKey`). */
  page?: boolean;
};

/**
 * `style` doar ca listă de variabile CSS (`--nume: valoare`), cu valori sigure. Orice altă declarație dispare; dacă nu
 * rămâne nimic, atributul dispare. Variabilele se moștenesc doar în containerul pluginului.
 */
export function pluginStyleVars(style: string | undefined): string | null {
  if (typeof style !== "string" || style.length === 0 || style.length > STYLE_MAX) return null;
  const out: string[] = [];
  for (const decl of style.split(";")) {
    const at = decl.indexOf(":");
    if (at === -1) continue;
    const name = decl.slice(0, at).trim();
    const value = decl.slice(at + 1).trim();
    if (VAR_NAME.test(name) && VAR_VALUE.test(value)) out.push(`${name}:${value}`);
    if (out.length >= STYLE_VARS_MAX) break;
  }
  return out.length > 0 ? out.join(";") : null;
}

/** O cale spre fișierele pluginului (`/plugins/<cheie>/assets/…` sau `/plugins/<cheie>/media/…`), fără `..` sau query. */
export function isOwnPluginFile(src: unknown, pluginKey: string): src is string {
  if (typeof src !== "string" || src.length > 300) return false;
  const prefix = `/plugins/${pluginKey}/`;
  if (!src.startsWith(prefix)) return false;
  const rest = src.slice(prefix.length);
  return /^(?:assets|media)\/[A-Za-z0-9_-][A-Za-z0-9._/-]*$/.test(rest) && !rest.split("/").some((s) => s === "" || s === "." || s === "..");
}

/** Acțiunea unui formular: POST doar spre API-ul pluginului, GET doar spre paginile lui (site sau ACP). */
export function isPluginFormAction(action: string | undefined, method: string, pluginKey: string): boolean {
  if (typeof action !== "string" || action.length > 300 || !/^\/[A-Za-z0-9._~/?=&%:-]*$/.test(action) || action.includes("..") || /%(?:2e|2f|5c)/i.test(action)) {
    return false;
  }
  const path = action.split("?")[0]!;
  const inside = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (method === "post") return inside(`/api/plugins/${pluginKey}`);
  return inside(`/p/${pluginKey}`) || inside(`/admin/plugins/${pluginKey}`);
}

/** `style` filtrat la variabilele CSS sigure (sanitize-html păstrează apoi atributul, escapat). */
function withStyle(attribs: Attribs): Attribs {
  const { style, ...rest } = attribs;
  const vars = pluginStyleVars(style);
  return vars ? { ...rest, style: vars } : rest;
}

/** `name` doar pe controale și doar cu un nume simplu. */
function named(attribs: Attribs): Attribs {
  const { name, ...rest } = attribs;
  return name !== undefined && CONTROL_NAME.test(name) ? { ...rest, name } : rest;
}

/** Transformările formularelor și ale elementelor media (doar paginile pluginului). */
function pageTransforms(key: string): Record<string, sanitizeHtml.Transformer> {
  const ownSrc = (attribs: Attribs, field: "src" | "poster"): Attribs => {
    const { [field]: value, ...rest } = attribs;
    return isOwnPluginFile(value, key) ? { ...rest, [field]: value } : rest;
  };
  return {
    form: (tagName, attribs) => {
      const method = (attribs.method ?? "get").toLowerCase();
      // O acțiune străină (alt site, altă parte a GCS): formularul devine un simplu `div`.
      if ((method !== "get" && method !== "post") || !isPluginFormAction(attribs.action, method, key)) {
        return { tagName: "div", attribs: attribs.class ? { class: attribs.class } : {} };
      }
      const out: Attribs = { ...withStyle(attribs), method, action: attribs.action! };
      if ((attribs.enctype ?? "").toLowerCase() === "multipart/form-data" && method === "post") out.enctype = "multipart/form-data";
      else delete out.enctype;
      return { tagName, attribs: out };
    },
    input: (tagName, attribs) => {
      const type = (attribs.type ?? "text").toLowerCase();
      return { tagName, attribs: { ...named(withStyle(attribs)), type: INPUT_TYPES.has(type) ? type : "text" } };
    },
    button: (tagName, attribs) => {
      const type = (attribs.type ?? "submit").toLowerCase();
      return { tagName, attribs: { ...named(withStyle(attribs)), type: BUTTON_TYPES.has(type) ? type : "submit" } };
    },
    select: (tagName, attribs) => ({ tagName, attribs: named(withStyle(attribs)) }),
    textarea: (tagName, attribs) => ({ tagName, attribs: named(withStyle(attribs)) }),
    // Video: mereu fără sunet și în pagină (doar așa `autoplay` are voie); audio: niciodată pornire automată.
    video: (tagName, attribs) => ({ tagName, attribs: { ...ownSrc(ownSrc(withStyle(attribs), "src"), "poster"), muted: "", playsinline: "" } }),
    audio: (tagName, attribs) => {
      const { autoplay: _autoplay, ...rest } = ownSrc(withStyle(attribs), "src");
      return { tagName, attribs: rest };
    },
    source: (tagName, attribs) => ({ tagName, attribs: ownSrc(attribs, "src") }),
  };
}

const CONTROL_ATTRIBUTES = ["name", "value", "disabled", "required", "autocomplete"];
const PAGE_ATTRIBUTES: Record<string, string[]> = {
  form: ["action", "method", "enctype", "autocomplete", "novalidate"],
  input: [...CONTROL_ATTRIBUTES, "type", "checked", "min", "max", "step", "maxlength", "minlength", "placeholder", "accept", "multiple", "readonly", "size", "inputmode"],
  select: [...CONTROL_ATTRIBUTES, "multiple", "size"],
  option: ["value", "selected", "disabled", "label"],
  optgroup: ["label", "disabled"],
  textarea: [...CONTROL_ATTRIBUTES, "rows", "cols", "maxlength", "minlength", "placeholder", "readonly", "wrap"],
  button: ["type", "name", "value", "disabled"],
  fieldset: ["disabled"],
  audio: ["src", "controls", "loop", "preload"],
  video: ["src", "poster", "controls", "loop", "preload", "muted", "playsinline", "autoplay", "width", "height"],
  source: ["src", "type"],
};

/**
 * Curăță HTML-ul randat de un plugin (widget-uri, pagini, puncte de extensie), cu o listă albă:
 * - fără `script`, `style`, `iframe`, `svg`, `object`, comentarii; formularele și `audio`/`video` doar în paginile
 *   pluginului (`page`), cu acțiuni și surse doar ale lui;
 * - fără `id`, `on*`, `srcset`; `style` doar cu variabile CSS sigure; `name` doar pe controalele formularelor;
 *   atributele `data-*` doar `data-gcsp-*` (plus `data-user-id` pe linkuri, pentru hover card, și `data-text`, textul
 *   dublat de efectele numelui);
 * - clase doar `gcsp-*` și câteva clase GCS de prezentare (fără clasele de layout, modale sau sertare ale site-ului);
 * - linkuri `http(s)`, `mailto` sau relative, cu `rel="noopener noreferrer nofollow ugc"`; imagini `https` sau relative;
 * - `<gcs-icon name="fa-solid fa-star"></gcs-icon>` devine iconița Font Awesome (SVG generat de GCS).
 */
export function sanitizePluginHtml(html: string, opts: GcsPluginHtmlOptions = {}): string {
  if (typeof html !== "string" || html.length === 0) return "";
  const key = opts.pluginKey;
  const page = Boolean(opts.page && key);
  const max = page ? PLUGIN_PAGE_HTML_MAX : PLUGIN_HTML_MAX;
  const input = html.length > max ? html.slice(0, max) : html;
  const tags = page ? [...TAGS, ...FORM_TAGS, ...MEDIA_TAGS] : TAGS;
  const transformTags: Record<string, sanitizeHtml.Transformer> = {};
  for (const tag of tags) transformTags[tag] = (tagName, attribs) => ({ tagName, attribs: withStyle(attribs) });
  transformTags.a = (tagName, attribs) => {
    const out: Attribs = { ...withStyle(attribs), rel: "noopener noreferrer nofollow ugc" };
    if (attribs.target !== undefined) out.target = "_blank";
    if (out["data-user-id"] !== undefined && !USER_ID.test(out["data-user-id"])) delete out["data-user-id"];
    return { tagName, attribs: out };
  };
  transformTags.img = (tagName, attribs) => ({ tagName, attribs: { ...withStyle(attribs), loading: "lazy" } });
  if (page && key) Object.assign(transformTags, pageTransforms(key));
  const clean = sanitizeHtml(input, {
    allowedTags: tags,
    allowedAttributes: {
      a: ["href", "title", "target", "rel", "hreflang", "data-user-id"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      "gcs-icon": ["name"],
      td: ["colspan", "rowspan", "headers"],
      th: ["colspan", "rowspan", "scope", "headers"],
      time: ["datetime"],
      abbr: ["title"],
      ol: ["start", "reversed"],
      details: ["open"],
      progress: ["value", "max"],
      meter: ["value", "min", "max", "low", "high", "optimum"],
      ...(page ? PAGE_ATTRIBUTES : {}),
      // `data-text`: textul dublat de efectele numelui (straturile `::before` / `::after`, doar ca text).
      // `data-c`: litera desenată a unui nume (efectele pe litere), doar ca text.
      "*": ["class", "title", "lang", "dir", "role", "aria-*", "data-gcsp-*", "data-text", "data-c", "style"],
    },
    allowedClasses: { "*": ["gcsp-*", ...PLUGIN_GCS_CLASSES, ...PLUGIN_GCS_MEMBER_CLASSES] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https"], audio: [], video: [], source: [] },
    allowedSchemesAppliedToAttributes: ["href", "src", "cite", "poster"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    parser: { recognizeSelfClosing: true },
    transformTags,
  });
  return clean.replace(/<gcs-icon name="([^"]*)"><\/gcs-icon>|<gcs-icon><\/gcs-icon>/g, (_m, name: string | undefined) => {
    if (!name || !ICON_NAME.test(name)) return "";
    return opts.icon?.(name) ?? "";
  });
}
