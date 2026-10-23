import sanitizeHtml from "sanitize-html";

/**
 * Blocurile sigure din editor (Forum v2, macheta GiveawayBlocks): conținut structurat, desenat de nucleu în culorile
 * temei (închisă / deschisă), fără HTML brut. Fiecare familie de blocuri are permisiunea ei de grup
 * (`forums.block_<tip>`); blocul HTML e doar al Root Admin-ului și trece printr-o listă albă strictă.
 */
export const GCS_BLOCK_TYPES = ["section", "callout", "cards", "button", "columns", "steps", "progress", "hidden", "html"] as const;
export type GcsBlockType = (typeof GCS_BLOCK_TYPES)[number];

/** Familia fiecărui nod de bloc (nodurile-copil ale unei familii au aceeași permisiune). */
export const GCS_BLOCK_OF_NODE: Record<string, GcsBlockType> = {
  gcsSection: "section",
  gcsCallout: "callout",
  gcsCardGrid: "cards",
  gcsCard: "cards",
  gcsButton: "button",
  gcsColumns: "columns",
  gcsColumn: "columns",
  gcsSteps: "steps",
  gcsStep: "steps",
  gcsProgress: "progress",
  gcsHidden: "hidden",
  gcsHtml: "html",
};

/** Cheia permisiunii de grup a unei familii de blocuri. */
export const blockPermission = (type: GcsBlockType) => `forums.block_${type}`;

/** Tonurile secțiunilor (culorile temei) și tipurile casetelor de atenționare. */
export const GCS_BLOCK_TONES = ["accent", "neutral", "ok", "warn", "danger", "info"] as const;
export const GCS_CALLOUT_KINDS = ["info", "warning", "success"] as const;
/** Cine vede un bloc „conținut ascuns”: cine a răspuns în topic, membrii logați sau anumite grupuri. */
export const GCS_HIDDEN_MODES = ["reply", "members", "groups"] as const;
export type GcsHiddenMode = (typeof GCS_HIDDEN_MODES)[number];

/** Un bloc „conținut ascuns” scos din HTML-ul postării: arătat per vizitator (`revealHidden` în modulul Forum). */
export type GcsHiddenPart = { id: string; mode: GcsHiddenMode; groups: number[]; label: string | null; html: string };

/**
 * HTML-ul blocului „HTML (doar Root)”: o listă albă mai largă decât a postărilor (tabele, `div`-uri, aliniere), dar tot
 * fără scripturi, stiluri libere, formulare, iframe-uri sau evenimente. Clasele doar `gcs-*`.
 */
const HTML_BLOCK: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "h2", "h3", "h4", "strong", "em", "u", "s", "code", "pre", "a", "ul", "ol", "li", "blockquote",
    "span", "div", "img", "sub", "sup", "mark", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "small",
  ],
  allowedAttributes: {
    a: ["href", "rel", "target", "class", "title"],
    img: ["src", "alt", "width", "height", "loading", "class"],
    td: ["colspan", "rowspan", "class", "style"],
    th: ["colspan", "rowspan", "class", "style", "scope"],
    "*": ["class", "style"],
  },
  allowedClasses: { "*": ["gcs-*"] },
  allowedStyles: {
    "*": {
      color: [/^#[0-9a-fA-F]{6}$/],
      "background-color": [/^#[0-9a-fA-F]{6}$/],
      "text-align": [/^(?:left|center|right|justify)$/],
      "font-weight": [/^(?:400|600|700|bold|normal)$/],
    },
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: "nofollow ugc noopener", ...(attribs.href?.startsWith("/") ? {} : { target: "_blank" }) } }),
  },
  disallowedTagsMode: "discard",
};

/** Curăță HTML-ul unui bloc HTML (lista albă de mai sus). */
export function sanitizeHtmlBlock(html: string): string {
  return sanitizeHtml(html.slice(0, 20_000), HTML_BLOCK);
}
