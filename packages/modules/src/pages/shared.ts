import type { GcsActor } from "@gcs/core";
import { jsonInts } from "@gcs/db";

/** Secțiunile ACP ale aplicației Pagini (rolurile ACP). */
export const PAGES_ACP = {
  pages: "pages.pages",
  databases: "pages.databases",
  records: "pages.records",
  media: "pages.media",
  templates: "pages.templates",
  settings: "pages.settings",
} as const;

/** Tag-ul de cache al aplicației (arborele, bazele de date, înregistrările). */
export const PAGES_CACHE_TAG = "pages";
/** Tipul atașamentelor bibliotecii media (publice, ca imaginile site-ului). */
export const PAGES_MEDIA_TYPE = "pages.media";
/** Tipul înregistrărilor: atașamentele lor, notele cu stele și ținta notificărilor. */
export const PAGES_RECORD_TYPE = "pages.record";
/** Ținta notificărilor despre un comentariu (deschide înregistrarea la comentariu). */
export const PAGES_COMMENT_TYPE = "pages.comment";
/** Ținta notificărilor despre o înregistrare ștearsă sau respinsă: textul și linkul vin din notificare. */
export const PAGES_NOTICE_TYPE = "pages.notice";
/** Sursa de conținut din căutare și din fluxul de activitate. */
export const PAGES_SOURCE = "pages.records";

/** Segmentele rezervate sub o pagină de bază de date (`/c/<categorie>`, `/submit`). */
export const RESERVED_SEGMENTS = new Set(["c", "submit", "edit", "rss"]);
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** Grupurile unei liste (`viewGroupIds`…) permit actorul: lista goală permite pe oricine. */
export function groupsAllow(actor: Pick<GcsActor, "groupIds">, raw: unknown): boolean {
  const ids = jsonInts(raw);
  return ids.length === 0 || ids.some((id) => actor.groupIds.includes(id));
}

/** Adresa unei pagini după calea ei (`ghiduri/cs2` → `/pages/ghiduri/cs2`). */
export const pageHref = (path: string) => `/pages/${path}`;
/** Adresa unei înregistrări sub pagina bazei ei de date. */
export const recordHref = (path: string, r: { id: number; slug: string }) => `/pages/${path}/${r.id}-${r.slug}`;
export const categoryHref = (path: string, slug: string) => `/pages/${path}/c/${slug}`;

/** Textul căutabil: fără diacritice, litere mici, spațiile comasate. */
export function searchNormalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Textul simplu dintr-un HTML randat (fragmentele din căutare, flux, SEO). */
export function plainText(html: string, max: number): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
