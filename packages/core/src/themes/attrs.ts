import { THEME_FORUM_STATS, THEME_HEADER_IMAGE_AREAS, THEME_LIST_LAYOUTS, THEME_LOADERS, type GcsThemeSettings } from "./settings";

/**
 * Atributele de pe `<html>` ale setărilor de sistem care schimbă aspectul componentelor (orice temă): aspectul listelor,
 * statisticile forumurilor, stilul loader-ului, banda „Sus / Jos”, bara de derulare, fragmentul din lista topicurilor și
 * imaginea antetului (unde stă și dacă apare pe telefon). CSS-ul de bază (`lists.css`, `loaders.css`, `scroll.css`,
 * `header-menus.css`) le citește; layout-ul rădăcină le pune la randare, iar sincronizarea (navigarea ACP ↔ site) și
 * previzualizarea editorului vizual le schimbă live.
 */
export const THEME_HTML_ATTRS = [
  "data-gcs-lists",
  "data-gcs-stats",
  "data-gcs-loader",
  "data-gcs-rail",
  "data-gcs-scrollbar",
  "data-gcs-snippet",
  "data-gcs-header-image",
  "data-gcs-header-image-mobile",
] as const;
export type GcsThemeHtmlAttr = (typeof THEME_HTML_ATTRS)[number];
export type GcsThemeHtmlAttrs = Record<GcsThemeHtmlAttr, string>;

const onOff = (v: boolean) => (v ? "on" : "off");

export function themeHtmlAttrs(s: Pick<GcsThemeSettings, "lists" | "loader" | "scroll" | "layout" | "header">): GcsThemeHtmlAttrs {
  const image = s.header.image !== null || s.header.art !== "none";
  return {
    "data-gcs-lists": s.lists.layout,
    "data-gcs-stats": s.lists.stats,
    "data-gcs-loader": s.loader.style,
    "data-gcs-rail": onOff(s.scroll.rail),
    "data-gcs-scrollbar": onOff(s.scroll.bar),
    "data-gcs-snippet": onOff(s.layout.topicSnippet),
    // Fără imagine (nici încărcată, nici inclusă), antetul își păstrează fundalul temei.
    "data-gcs-header-image": image ? s.header.imageArea : "off",
    "data-gcs-header-image-mobile": onOff(s.header.imageMobile),
  };
}

/** Valorile permise ale fiecărui atribut (previzualizarea primește atributele prin `postMessage`). */
const ALLOWED: Record<GcsThemeHtmlAttr, readonly string[]> = {
  "data-gcs-lists": THEME_LIST_LAYOUTS,
  "data-gcs-stats": THEME_FORUM_STATS,
  "data-gcs-loader": THEME_LOADERS,
  "data-gcs-rail": ["on", "off"],
  "data-gcs-scrollbar": ["on", "off"],
  "data-gcs-snippet": ["on", "off"],
  "data-gcs-header-image": ["off", ...THEME_HEADER_IMAGE_AREAS],
  "data-gcs-header-image-mobile": ["on", "off"],
};

/** Atributele primite sunt exact cele cunoscute, cu valori permise. */
export function isThemeHtmlAttrs(v: unknown): v is GcsThemeHtmlAttrs {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Object.keys(o).length === THEME_HTML_ATTRS.length && THEME_HTML_ATTRS.every((k) => typeof o[k] === "string" && ALLOWED[k].includes(o[k] as string));
}
