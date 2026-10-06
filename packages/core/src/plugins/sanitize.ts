import sanitizeHtml from "sanitize-html";

/** HTML-ul maxim acceptat de la un plugin (înainte de sanitizare). */
export const PLUGIN_HTML_MAX = 200_000;

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
];

const ICON_NAME = /^fa-(?:solid|regular|brands) fa-[a-z0-9-]{1,60}$/;

export type GcsPluginHtmlOptions = {
  /** SVG-ul unei iconițe Font Awesome după nume (`<gcs-icon name="…">`); `null` = iconiță necunoscută (se omite). */
  icon?: (name: string) => string | null;
};

/**
 * Curăță HTML-ul randat de un plugin (widget-uri, pagini, puncte de extensie), cu o listă albă:
 * - fără `script`, `style`, `iframe`, `form`/`input`/`button`, `svg`, `object`, comentarii;
 * - fără `style`, `id`, `name`, `on*`, `srcset`; atributele `data-*` doar `data-gcsp-*`;
 * - clase doar `gcsp-*` și câteva clase GCS de prezentare (fără clasele de layout, modale sau sertare ale site-ului);
 * - linkuri `http(s)`, `mailto` sau relative, cu `rel="noopener noreferrer nofollow ugc"`; imagini `https` sau relative;
 * - `<gcs-icon name="fa-solid fa-star"></gcs-icon>` devine iconița Font Awesome (SVG generat de GCS).
 */
export function sanitizePluginHtml(html: string, opts: GcsPluginHtmlOptions = {}): string {
  if (typeof html !== "string" || html.length === 0) return "";
  const input = html.length > PLUGIN_HTML_MAX ? html.slice(0, PLUGIN_HTML_MAX) : html;
  const clean = sanitizeHtml(input, {
    allowedTags: TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel", "hreflang"],
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
      "*": ["class", "title", "lang", "dir", "role", "aria-*", "data-gcsp-*"],
    },
    allowedClasses: { "*": ["gcsp-*", ...PLUGIN_GCS_CLASSES] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    parser: { recognizeSelfClosing: true },
    transformTags: {
      a: (tagName, attribs) => {
        const out: Record<string, string> = { ...attribs, rel: "noopener noreferrer nofollow ugc" };
        if (attribs.target !== undefined) out.target = "_blank";
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
    },
  });
  return clean.replace(/<gcs-icon name="([^"]*)"><\/gcs-icon>|<gcs-icon><\/gcs-icon>/g, (_m, name: string | undefined) => {
    if (!name || !ICON_NAME.test(name)) return "";
    return opts.icon?.(name) ?? "";
  });
}

/** Escapează text pentru HTML (titluri, mesaje). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
