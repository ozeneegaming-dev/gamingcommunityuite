/**
 * Layout-ul constructorului de pagini (specul 2026-11-03-pagini §1): secțiuni cu coloane, fiecare coloană cu blocuri.
 * Aici e doar structura (validată fără bază de date); serviciul randează conținutul, curăță HTML-ul și verifică
 * widget-urile, bazele de date și fișierele din bibliotecă.
 */

export const PAGES_COLUMN_LAYOUTS = ["1", "1-1", "2-1", "1-2", "1-1-1"] as const;
export type GcsPagesColumns = (typeof PAGES_COLUMN_LAYOUTS)[number];
export const PAGES_SECTION_STYLES = ["plain", "card", "accent"] as const;
export type GcsPagesSectionStyle = (typeof PAGES_SECTION_STYLES)[number];
export const PAGES_WIDTHS = ["normal", "wide", "full"] as const;
export type GcsPagesWidth = (typeof PAGES_WIDTHS)[number];
export const PAGES_BLOCK_TYPES = ["content", "html", "widget", "records", "image", "block", "pages"] as const;
export type GcsPagesBlockType = (typeof PAGES_BLOCK_TYPES)[number];
export const PAGES_RECORD_VIEWS = ["list", "grid", "compact", "featured", "carousel"] as const;
export const PAGES_RECORD_SORTS = ["newest", "updated", "rating", "views", "comments", "featured"] as const;
export const PAGES_IMAGE_SIZES = ["normal", "wide", "full"] as const;

export const MAX_SECTIONS = 30;
export const MAX_BLOCKS = 80;
const MAX_PER_COLUMN = 12;
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;

/** Numărul de coloane al unui aspect (`2-1` → 2). */
export const columnCount = (c: GcsPagesColumns) => c.split("-").length;

/** Ce au toate blocurile: titlul (cu iconița), cardul în jur și grupurile care văd blocul (gol = toți). */
type BlockBase = { id: string; title: string; icon: string | null; card: boolean; groups: number[] };
export type GcsPagesBlock =
  | (BlockBase & { type: "content"; doc: unknown; html: string })
  | (BlockBase & { type: "html"; html: string })
  | (BlockBase & { type: "widget"; widget: string; config: Record<string, unknown> })
  | (BlockBase & {
      type: "records";
      databaseId: number;
      limit: number;
      view: (typeof PAGES_RECORD_VIEWS)[number];
      sort: (typeof PAGES_RECORD_SORTS)[number];
      categoryId: number | null;
      hideImages: boolean;
    })
  | (BlockBase & { type: "image"; mediaId: number | null; caption: string; link: string; size: (typeof PAGES_IMAGE_SIZES)[number] })
  /** Un bloc reutilizabil (ACP › Pagini › Blocuri). */
  | (BlockBase & { type: "block"; blockId: number })
  /** Meniul de secțiune: paginile unui folder (`null` = folderul paginii), cu pagina curentă evidențiată. */
  | (BlockBase & { type: "pages"; folderId: number | null });

export type GcsPagesSection = { id: string; title: string; columns: GcsPagesColumns; style: GcsPagesSectionStyle; blocks: GcsPagesBlock[][] };
export type GcsPagesLayout = { v: 1; width: GcsPagesWidth; sections: GcsPagesSection[] };

export const EMPTY_LAYOUT: GcsPagesLayout = { v: 1, width: "normal", sections: [] };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const posInt = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,9}$/.test(v) && Number(v) > 0 ? Number(v) : null);
/** Un link sigur: o cale a site-ului sau o adresă http(s). */
export const isSafeLink = (v: string) => (v.startsWith("/") && !v.startsWith("//")) || /^https?:\/\/[^\s<>"']+$/i.test(v);

/**
 * Un bloc trimis din constructor → blocul curat, sau o eroare (cheia de traducere). Conținutul (`doc`) și HTML-ul rămân
 * brute aici: le validează și le randează serviciul.
 */
export function parseBlock(raw: unknown): { block: GcsPagesBlock | null; error: string | null } {
  const o = obj(raw);
  const id = typeof o.id === "string" && ID_RE.test(o.id) ? o.id : null;
  if (!id) return { block: null, error: "invalid_block" };
  const groups = Array.isArray(o.groups) ? [...new Set(o.groups.map(posInt).filter((g): g is number => g !== null))].slice(0, 50) : [];
  const base: BlockBase = { id, title: text(o.title, 120), icon: typeof o.icon === "string" && o.icon.length <= 60 ? o.icon : null, card: o.card !== false, groups };
  switch (o.type) {
    case "content":
      return { block: { ...base, type: "content", doc: o.doc ?? null, html: "" }, error: null };
    case "html":
      return { block: { ...base, type: "html", html: typeof o.html === "string" ? o.html.slice(0, 100_000) : "" }, error: null };
    case "widget": {
      const widget = typeof o.widget === "string" && /^[a-z0-9_.-]{1,80}$/i.test(o.widget) ? o.widget : null;
      if (!widget) return { block: null, error: "invalid_widget" };
      return { block: { ...base, type: "widget", widget, config: obj(o.config) }, error: null };
    }
    case "records": {
      const databaseId = posInt(o.databaseId);
      if (!databaseId) return { block: null, error: "invalid_database" };
      const limit = posInt(o.limit) ?? 6;
      return {
        block: {
          ...base,
          type: "records",
          databaseId,
          limit: Math.min(limit, 50),
          view: oneOf(PAGES_RECORD_VIEWS, o.view, "list"),
          sort: oneOf(PAGES_RECORD_SORTS, o.sort, "newest"),
          categoryId: posInt(o.categoryId),
          hideImages: o.hideImages === true,
        },
        error: null,
      };
    }
    case "block": {
      const blockId = posInt(o.blockId);
      if (!blockId) return { block: null, error: "invalid_block" };
      return { block: { ...base, type: "block", blockId }, error: null };
    }
    case "pages":
      return { block: { ...base, type: "pages", folderId: posInt(o.folderId) }, error: null };
    case "image": {
      const link = typeof o.link === "string" ? o.link.trim().slice(0, 500) : "";
      if (link && !isSafeLink(link)) return { block: null, error: "invalid_url" };
      return { block: { ...base, type: "image", mediaId: posInt(o.mediaId), caption: text(o.caption, 300), link, size: oneOf(PAGES_IMAGE_SIZES, o.size, "normal") }, error: null };
    }
    default:
      return { block: null, error: "invalid_block" };
  }
}

/**
 * Layout-ul trimis din constructor → structura curată sau erorile (`layout` / `block.<id>`). Fiecare secțiune are exact
 * câte o listă de blocuri pentru fiecare coloană; id-urile blocurilor sunt unice în pagină.
 */
export function parseLayout(raw: unknown): { layout: GcsPagesLayout; errors: Record<string, string> } {
  const o = obj(raw);
  const errors: Record<string, string> = {};
  const rawSections = Array.isArray(o.sections) ? o.sections : [];
  if (rawSections.length > MAX_SECTIONS) errors.layout = "too_many_sections";
  const ids = new Set<string>();
  let total = 0;
  const sections: GcsPagesSection[] = [];
  for (const rs of rawSections.slice(0, MAX_SECTIONS)) {
    const s = obj(rs);
    const id = typeof s.id === "string" && ID_RE.test(s.id) && !ids.has(s.id) ? s.id : null;
    if (!id) {
      errors.layout = "invalid_section";
      continue;
    }
    ids.add(id);
    const columns = oneOf(PAGES_COLUMN_LAYOUTS, s.columns, "1");
    const rawCols = Array.isArray(s.blocks) ? s.blocks : [];
    const blocks: GcsPagesBlock[][] = [];
    for (let c = 0; c < columnCount(columns); c++) {
      const col: GcsPagesBlock[] = [];
      const list = Array.isArray(rawCols[c]) ? (rawCols[c] as unknown[]) : [];
      if (list.length > MAX_PER_COLUMN) errors.layout = "too_many_blocks";
      for (const rb of list.slice(0, MAX_PER_COLUMN)) {
        const { block, error } = parseBlock(rb);
        const key = `block.${typeof obj(rb).id === "string" ? String(obj(rb).id).slice(0, 24) : total}`;
        if (error || !block) errors[key] = error ?? "invalid_block";
        else if (ids.has(block.id)) errors[key] = "duplicate";
        else {
          ids.add(block.id);
          col.push(block);
        }
        total++;
      }
      blocks.push(col);
    }
    // Blocurile din coloanele în plus (aspect schimbat la mai puține coloane) trec în ultima coloană.
    for (const extra of rawCols.slice(columnCount(columns))) {
      if (!Array.isArray(extra)) continue;
      for (const rb of extra) {
        const { block } = parseBlock(rb);
        if (block && !ids.has(block.id) && blocks[blocks.length - 1]!.length < MAX_PER_COLUMN) {
          ids.add(block.id);
          blocks[blocks.length - 1]!.push(block);
          total++;
        }
      }
    }
    sections.push({ id, title: text(s.title, 120), columns, style: oneOf(PAGES_SECTION_STYLES, s.style, "plain"), blocks });
  }
  if (total > MAX_BLOCKS) errors.layout = "too_many_blocks";
  return { layout: { v: 1, width: oneOf(PAGES_WIDTHS, o.width, "normal"), sections }, errors };
}

/** Layout-ul salvat (citit din bază), fără erori: orice parte invalidă lipsește. Conținutul rămâne cel randat la salvare. */
export function layoutOf(raw: unknown): GcsPagesLayout {
  const { layout } = parseLayout(raw);
  // `parseBlock` golește HTML-ul randat al blocurilor de conținut; cel salvat e deja curat (randat la salvare).
  const saved = new Map<string, string>();
  for (const s of Array.isArray(obj(raw).sections) ? (obj(raw).sections as unknown[]) : []) {
    for (const col of Array.isArray(obj(s).blocks) ? (obj(s).blocks as unknown[]) : []) {
      for (const b of Array.isArray(col) ? col : []) {
        const ob = obj(b);
        if (ob.type === "content" && typeof ob.id === "string" && typeof ob.html === "string") saved.set(ob.id, ob.html);
      }
    }
  }
  for (const s of layout.sections) for (const col of s.blocks) for (const b of col) if (b.type === "content") b.html = saved.get(b.id) ?? "";
  return layout;
}

/** Toate blocurile unui layout, în ordinea paginii. */
export function layoutBlocks(layout: GcsPagesLayout): GcsPagesBlock[] {
  return layout.sections.flatMap((s) => s.blocks.flat());
}
