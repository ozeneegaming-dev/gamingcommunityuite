import { jsonInts, type Prisma, type PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { APPS_ACP_SECTION, type GcsAppService, type GcsAppViewer } from "../apps/service";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsModuleRegistry, GcsNavDefault, GcsNavDefaultChild } from "../modules/registry";
import type { GcsActor } from "../permissions/types";

export const MENUS_ACP_SECTION = "system.menu_manager";
const CACHE_KEY = "nav:items";
const CACHE_TAG = "nav";
const CACHE_TTL = 3600;
const MAX_ITEMS = 60;
const MAX_DEPTH = 2;
const LABEL_LOCALES = ["ro", "en", "de", "es", "fr", "ru"];

/**
 * Versiunile meniului implicit, în ordine (marcajele din `system_state.seedMarks`): `nav:v2` (Activitate, Clasament,
 * VIP, Reguli, submeniul Membri), `nav:v3` (Servere), `nav:v4` (Clanuri), `nav:v5` (itemii adăugați dezactivați
 * pornesc), `nav:v6` (submeniul Servere). O instalare nouă le primește pe toate; una existentă își actualizează meniul o
 * dată pentru fiecare marcaj lipsă (`GcsNavService.upgradeDefaults`, `enableDefaults`, `appendDefaultChildren`).
 */
export const NAV_MARKS: readonly string[] = ["nav:v2", "nav:v3", "nav:v4", "nav:v5", "nav:v6"];

/** Eticheta unui item: cheie de traducere (itemii impliciți) sau text pe limbi (itemii adăugați de admin). */
export type GcsNavLabel = { key: string } | Partial<Record<string, string>>;
/** Descrierea de un rând din mega meniu (text pe limbi); `null` = cea implicită (după cheia etichetei). */
export type GcsNavDescription = Partial<Record<string, string>>;
/** Manager meniu v2: tipurile de itemi. */
export const NAV_KINDS = ["link", "app", "dropdown", "separator"] as const;
export type GcsNavKind = (typeof NAV_KINDS)[number];
/** Cine vede un item, pe lângă grupuri. */
export const NAV_AUDIENCES = ["all", "guests", "members"] as const;
export type GcsNavAudience = (typeof NAV_AUDIENCES)[number];
/** Stilurile de evidențiere. */
export const NAV_HIGHLIGHTS = ["accent", "glow"] as const;
/** Contoarele live pentru insignă (calculate de site, vezi `setCounterResolver`). */
export const NAV_COUNTERS = ["online", "topics_today", "members_today"] as const;
/** Linkul unui separator: header-ul îl desenează ca linie (stilul comun `members.css`). */
export const NAV_SEPARATOR_HREF = "#gcs-separator";

export type GcsNavItemInput = {
  label: GcsNavLabel;
  description?: GcsNavDescription | null;
  /** Insigna fixă din mega meniu (ex. „NOU”), cel mult 12 caractere. */
  badge?: string | null;
  icon?: string | null;
  href?: string | null;
  appKey?: string | null;
  groups?: number[];
  newTab?: boolean;
  enabled?: boolean;
  kind?: GcsNavKind;
  audience?: GcsNavAudience;
  counter?: string | null;
  highlight?: string | null;
  /** „Link scurt” (doar subitemii): în mega meniu, plăcuță în coloana din dreapta, fără descriere. */
  shortLink?: boolean;
  children?: GcsNavItemInput[];
};
export type GcsNavItemView = {
  id: number;
  label: { key: string } | { text: string };
  /** Descrierea (textul adminului) sau cheia ei implicită (`site.navDesc.<x>` pentru `site.nav.<x>`; poate lipsi din traduceri). */
  description: { key: string } | { text: string } | null;
  badge: string | null;
  icon: string | null;
  href: string;
  newTab: boolean;
  /** Manager meniu v2: stilul de evidențiere (`accent`, `glow`) și separatorul dintre subitemi. */
  highlight?: string | null;
  separator?: boolean;
  /** „Link scurt” (doar subitemii): coloana din dreapta a mega meniului. */
  shortLink?: boolean;
  children: GcsNavItemView[];
};
export type GcsNavItemEdit = Omit<GcsNavItemInput, "children" | "label"> & { id: number; label: GcsNavLabel; children: GcsNavItemEdit[] };

type Row = {
  id: number;
  parentId: number | null;
  position: number;
  label: Prisma.JsonValue;
  description?: Prisma.JsonValue | null;
  badge?: string | null;
  icon: string | null;
  href: string | null;
  appKey: string | null;
  groups: number[];
  newTab: boolean;
  enabled: boolean;
  kind?: string;
  audience?: string;
  counter?: string | null;
  highlight?: string | null;
  shortLink?: boolean;
};

/** Valoarea unui contor pentru un viewer (`null` = fără insignă). */
export type GcsNavCounterResolver = (key: string, viewer: GcsAppViewer) => Promise<number | null>;

/** Descrierea de un rând (mega meniul, sertarul de pe telefon): cel mult atâtea caractere, fără rânduri noi. */
export const NAV_DESCRIPTION_MAX = 100;
const BADGE_RE = /^[\p{L}\p{N}][\p{L}\p{N} .!+#%-]{0,11}$/u;

/** Cheia descrierii implicite a unei etichete cu cheie (`site.nav.servers` → `site.navDesc.servers`). */
export function navDescriptionKey(labelKey: string): string | null {
  return labelKey.includes(".nav.") ? labelKey.replace(".nav.", ".navDesc.") : null;
}

/**
 * Ordinea aplicațiilor în meniul principal (specul 2026-10-09-acp-navigatie-aplicatii §2.7): itemii legați de aplicații
 * își schimbă între ei locurile după `order` (cei care nu sunt în ea rămân după, în ordinea lor); ceilalți itemi rămân pe
 * loc. Întoarce itemii în noua ordine.
 */
export function reorderAppItems<T extends { appKey: string | null }>(rows: readonly T[], order: readonly string[]): T[] {
  const slots = rows.flatMap((r, i) => (r.appKey ? [i] : []));
  const rank = (r: T) => {
    const at = order.indexOf(r.appKey!);
    return at === -1 ? order.length : at;
  };
  const apps = slots.map((i) => rows[i]!).sort((a, b) => rank(a) - rank(b));
  const out = [...rows];
  slots.forEach((slot, n) => {
    out[slot] = apps[n]!;
  });
  return out;
}

/** Fără separatori la capetele listei și fără doi la rând. */
function trimSeparators(list: GcsNavItemView[]): GcsNavItemView[] {
  const out: GcsNavItemView[] = [];
  for (const it of list) {
    if (it.separator && (out.length === 0 || out[out.length - 1]!.separator)) continue;
    out.push(it);
  }
  while (out.length > 0 && out[out.length - 1]!.separator) out.pop();
  return out;
}

/** Descrierea de salvat: doar textele nevide (un obiect gol = fără descriere). */
function descriptionValue(d: GcsNavDescription | null | undefined): GcsNavDescription | null {
  if (!d) return null;
  const texts = Object.fromEntries(Object.entries(d).filter(([, t]) => typeof t === "string" && t.trim() !== "").map(([l, t]) => [l, t!.trim()]));
  return Object.keys(texts).length > 0 ? texts : null;
}

/**
 * „Link scurt” de salvat: doar pe un subitem care nu e separator (pe primul nivel n-are coloană în care să stea; un item
 * mutat pe primul nivel își pierde marcajul, fără eroare, ca ciorna să se salveze și după un drag & drop).
 */
export function navShortLink(it: Pick<GcsNavItemInput, "kind" | "shortLink">, child: boolean): boolean {
  return child && it.kind !== "separator" && it.shortLink === true;
}

/** Linkurile permise: căi interne (`/…`, fără `//`) sau adrese http(s). */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length === 0 || href.length > 500) return false;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.includes("\\");
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Meniul principal (specul etapei 5): un arbore pe două niveluri, cu iconițe, vizibilitate pe grup, linkuri externe și
 * itemi legați de o aplicație (ascunși când aplicația e dezactivată). `isIcon` validează iconițele (din `@gcs/ui/icons`).
 */
export class GcsNavService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      bus: GcsEventBus;
      registry: GcsModuleRegistry;
      acp: GcsAcpRoleService;
      apps: GcsAppService;
      isIcon: (name: string) => boolean;
    },
  ) {}

  private async rows(): Promise<Row[]> {
    const cached = await this.deps.cache.get<Row[]>(CACHE_KEY);
    if (cached) return cached;
    const rows = (await this.deps.db.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] })).map((r) => ({ ...r, groups: jsonInts(r.groups) }));
    await this.deps.cache.set(CACHE_KEY, rows, { ttlSec: CACHE_TTL, tags: [CACHE_TAG] });
    return rows;
  }

  private static label(raw: Prisma.JsonValue, locale: string, fallback: string): GcsNavItemView["label"] | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.key === "string") return { key: obj.key };
    const text = [obj[locale], obj[fallback], ...Object.values(obj)].find((v): v is string => typeof v === "string" && v.trim() !== "");
    return text ? { text } : null;
  }

  // ─── Manager meniu v2: ciorna, previzualizarea și contoarele ─────────────────────────────────────────────

  private previewResolver: (() => Promise<boolean>) | null = null;
  private counterResolver: GcsNavCounterResolver | null = null;

  /**
   * Cine vede ciorna în locul meniului publicat (previzualizarea din managerul de meniu, în `iframe`): site-ul dă o
   * funcție care verifică cererea curentă (parametrul de previzualizare, dreptul de editare, poarta ACP).
   */
  setPreviewResolver(fn: (() => Promise<boolean>) | null): void {
    this.previewResolver = fn;
  }

  /** Valorile contoarelor live (insigna „counter”), date de site. */
  setCounterResolver(fn: GcsNavCounterResolver | null): void {
    this.counterResolver = fn;
  }

  /** Rândurile ciornei (id-uri negative, sintetice), sau `null` fără ciornă. */
  private async draftRows(): Promise<Row[] | null> {
    const draft = await this.deps.db.navDraft.findUnique({ where: { id: 1 } });
    if (!draft || !Array.isArray(draft.items)) return null;
    const out: Row[] = [];
    let next = -1;
    const walk = (list: GcsNavItemInput[], parentId: number | null) => {
      for (const [position, it] of list.entries()) {
        const id = next--;
        out.push({
          id,
          parentId,
          position,
          label: (it.label ?? {}) as Prisma.JsonValue,
          description: (descriptionValue(it.description) ?? null) as Prisma.JsonValue,
          badge: it.badge?.trim() || null,
          icon: it.icon ?? null,
          href: it.href ?? null,
          appKey: it.appKey ?? null,
          groups: it.groups ?? [],
          newTab: it.newTab ?? false,
          enabled: it.enabled ?? true,
          kind: it.kind ?? "link",
          audience: it.audience ?? "all",
          counter: it.counter ?? null,
          highlight: it.highlight ?? null,
          shortLink: navShortLink(it, parentId !== null),
        });
        walk(it.children ?? [], id);
      }
    };
    walk(draft.items as unknown as GcsNavItemInput[], null);
    return out;
  }

  /** Meniul văzut de viewer, în limba lui (textele fără traducere cad pe limba site-ului, apoi pe oricare). */
  async tree(viewer: GcsAppViewer, locale: string, siteLocale = "ro"): Promise<GcsNavItemView[]> {
    // Itemii legați de o aplicație: doar dacă e pornită și (cu acces pe grup) accesibilă viewer-ului.
    const usable = await this.deps.apps.accessFilter(viewer);
    const preview = this.previewResolver ? await this.previewResolver().catch(() => false) : false;
    const source = (preview ? await this.draftRows() : null) ?? (await this.rows());
    const member = !!viewer.userId;
    const rows = source.filter(
      (r) =>
        r.enabled &&
        (!r.appKey || usable(r.appKey)) &&
        (r.groups.length === 0 || r.groups.some((g) => viewer.groupIds.includes(g))) &&
        (r.audience !== "guests" || !member) &&
        (r.audience !== "members" || member),
    );
    const counters = new Map<string, number | null>();
    for (const key of new Set(rows.map((r) => r.counter).filter((c): c is string => !!c))) {
      counters.set(key, this.counterResolver ? await this.counterResolver(key, viewer).catch(() => null) : null);
    }
    const build = (parentId: number | null): GcsNavItemView[] =>
      rows
        .filter((r) => r.parentId === parentId)
        .flatMap((r): GcsNavItemView[] => {
          // Separatorul: doar între subitemi; header-ul îl desenează ca linie (linkul `#gcs-separator`).
          if (r.kind === "separator") {
            return parentId === null ? [] : [{ id: r.id, label: { text: "" }, description: null, badge: null, icon: null, href: NAV_SEPARATOR_HREF, newTab: false, separator: true, children: [] }];
          }
          const label = GcsNavService.label(r.label, locale, siteLocale);
          if (!label) return [];
          const own = r.description ? GcsNavService.label(r.description, locale, siteLocale) : null;
          const fallbackKey = "key" in label ? navDescriptionKey(label.key) : null;
          const description = own && "text" in own ? own : fallbackKey ? { key: fallbackKey } : null;
          const count = r.counter ? counters.get(r.counter) : null;
          const badge = count !== null && count !== undefined ? (count > 0 ? (count > 999 ? "999+" : String(count)) : null) : (r.badge ?? null);
          const children = parentId === null ? build(r.id) : [];
          // Un grup (dropdown) fără subitemi vizibili nu apare.
          if (r.kind === "dropdown" && children.filter((c) => !c.separator).length === 0) return [];
          return [{ id: r.id, label, description, badge, icon: r.icon, href: r.href ?? "#", newTab: r.newTab, highlight: r.highlight ?? null, shortLink: parentId !== null && !!r.shortLink, children: trimSeparators(children) }];
        });
    return build(null);
  }

  private static editTree(rows: Row[]): GcsNavItemEdit[] {
    const build = (parentId: number | null): GcsNavItemEdit[] =>
      rows
        .filter((r) => r.parentId === parentId)
        .map((r) => ({
          id: r.id,
          label: (r.label ?? {}) as GcsNavLabel,
          description: (r.description ?? null) as GcsNavDescription | null,
          badge: r.badge ?? null,
          icon: r.icon,
          href: r.href,
          appKey: r.appKey,
          groups: r.groups,
          newTab: r.newTab,
          enabled: r.enabled,
          kind: (NAV_KINDS as readonly string[]).includes(r.kind ?? "") && !(r.kind === "link" && r.appKey) ? (r.kind as GcsNavKind) : r.appKey ? "app" : "link",
          audience: (NAV_AUDIENCES as readonly string[]).includes(r.audience ?? "") ? (r.audience as GcsNavAudience) : "all",
          counter: r.counter ?? null,
          highlight: r.highlight ?? null,
          shortLink: !!r.shortLink,
          children: build(r.id),
        }));
    return build(null);
  }

  /** Arborele complet, pentru editor (cu itemii ascunși și dezactivați). */
  async editable(): Promise<GcsNavItemEdit[]> {
    return GcsNavService.editTree(await this.rows());
  }

  /** Ciorna managerului de meniu (arborele nepublicat) și data ei, sau `null`. */
  async draft(): Promise<{ items: GcsNavItemEdit[]; updatedAt: Date } | null> {
    const [rows, row] = await Promise.all([this.draftRows(), this.deps.db.navDraft.findUnique({ where: { id: 1 }, select: { updatedAt: true } })]);
    return rows && row ? { items: GcsNavService.editTree(rows), updatedAt: row.updatedAt } : null;
  }

  private validate(items: GcsNavItemInput[], groupIds: Set<number>, depth = 1, path = "items"): number {
    if (!Array.isArray(items)) throw new GcsValidationError({ [path]: "invalid" });
    let count = 0;
    items.forEach((it, i) => {
      const at = `${path}.${i}`;
      const kind = it?.kind ?? "link";
      if (!(NAV_KINDS as readonly string[]).includes(kind)) throw new GcsValidationError({ [`${at}.kind`]: "invalid_choice" });
      if (it.audience != null && !(NAV_AUDIENCES as readonly string[]).includes(it.audience)) throw new GcsValidationError({ [`${at}.audience`]: "invalid_choice" });
      if (it.counter != null && !(NAV_COUNTERS as readonly string[]).includes(it.counter)) throw new GcsValidationError({ [`${at}.counter`]: "invalid_choice" });
      if (it.highlight != null && !(NAV_HIGHLIGHTS as readonly string[]).includes(it.highlight)) throw new GcsValidationError({ [`${at}.highlight`]: "invalid_choice" });
      if (!(it.groups ?? []).every((g) => groupIds.has(g))) throw new GcsValidationError({ [`${at}.groups`]: "invalid" });
      const children = it.children ?? [];
      if (kind === "separator") {
        // Separatorul: doar ca subitem, fără etichetă, link sau subitemi.
        if (depth === 1) throw new GcsValidationError({ [`${at}.kind`]: "separator_top" });
        if (children.length > 0) throw new GcsValidationError({ [`${at}.children`]: "invalid" });
        count += 1;
        return;
      }
      const label = it?.label as Record<string, unknown> | undefined;
      if (!label || typeof label !== "object") throw new GcsValidationError({ [`${at}.label`]: "required" });
      if ("key" in label) {
        if (typeof label.key !== "string" || !/^[a-zA-Z0-9_.]{1,80}$/.test(label.key)) throw new GcsValidationError({ [`${at}.label`]: "invalid" });
      } else {
        const texts = Object.entries(label);
        if (texts.length === 0 || !texts.every(([l, t]) => LABEL_LOCALES.includes(l) && typeof t === "string" && t.trim().length > 0 && t.length <= 40)) {
          throw new GcsValidationError({ [`${at}.label`]: "invalid" });
        }
      }
      if (it.icon != null && !this.deps.isIcon(it.icon)) throw new GcsValidationError({ [`${at}.icon`]: "invalid" });
      if (it.description != null) {
        const texts = typeof it.description === "object" && !Array.isArray(it.description) ? Object.entries(it.description) : null;
        if (!texts || !texts.every(([l, t]) => LABEL_LOCALES.includes(l) && typeof t === "string" && t.length <= NAV_DESCRIPTION_MAX && ![...t].some((c) => c.charCodeAt(0) < 32))) {
          throw new GcsValidationError({ [`${at}.description`]: "invalid" });
        }
      }
      if (it.badge != null && (typeof it.badge !== "string" || !BADGE_RE.test(it.badge))) throw new GcsValidationError({ [`${at}.badge`]: "invalid" });
      if (it.shortLink != null && typeof it.shortLink !== "boolean") throw new GcsValidationError({ [`${at}.shortLink`]: "invalid" });
      if (kind !== "dropdown" && children.length === 0 && !isSafeHref(it.href)) throw new GcsValidationError({ [`${at}.href`]: "invalid" });
      if (it.href != null && !isSafeHref(it.href)) throw new GcsValidationError({ [`${at}.href`]: "invalid" });
      if (kind === "app" && it.appKey == null) throw new GcsValidationError({ [`${at}.appKey`]: "required" });
      if (it.appKey != null && !this.deps.registry.module(it.appKey)) throw new GcsValidationError({ [`${at}.appKey`]: "invalid" });
      if (children.length > 0 && depth >= MAX_DEPTH) throw new GcsValidationError({ [`${at}.children`]: "too_deep" });
      count += 1 + this.validate(children, groupIds, depth + 1, `${at}.children`);
    });
    return count;
  }

  private async validateAll(items: GcsNavItemInput[]): Promise<void> {
    const groupIds = new Set((await this.deps.db.group.findMany({ select: { id: true } })).map((g) => g.id));
    if (this.validate(items, groupIds) > MAX_ITEMS) throw new GcsValidationError({ items: "too_many" });
  }

  /** Înlocuiește meniul (ordinea din liste = ordinea afișată). */
  async save(actor: GcsActor, items: GcsNavItemInput[]): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, MENUS_ACP_SECTION, "edit");
    await this.validateAll(items);
    const before = await this.editable();
    await db.$transaction(async (tx) => {
      await tx.navItem.deleteMany({});
      const create = async (list: GcsNavItemInput[], parentId: number | null) => {
        for (const [position, it] of list.entries()) {
          const separator = it.kind === "separator";
          const row = await tx.navItem.create({
            data: {
              parentId,
              position,
              label: (separator ? {} : it.label) as Prisma.InputJsonValue,
              ...(!separator && descriptionValue(it.description) ? { description: descriptionValue(it.description) as Prisma.InputJsonValue } : {}),
              badge: separator ? null : it.badge?.trim() || null,
              icon: separator ? null : (it.icon ?? null),
              href: separator ? null : (it.href ?? null),
              appKey: separator ? null : (it.appKey ?? null),
              groups: [...new Set(it.groups ?? [])],
              newTab: !separator && (it.newTab ?? false),
              enabled: it.enabled ?? true,
              kind: it.kind ?? (it.appKey ? "app" : "link"),
              audience: it.audience ?? "all",
              counter: separator ? null : (it.counter ?? null),
              highlight: separator ? null : (it.highlight ?? null),
              shortLink: navShortLink(it, parentId !== null),
            },
          });
          await create(it.children ?? [], row.id);
        }
      };
      await create(items, null);
      await writeAudit(tx, { actorId: actor.userId, action: "nav.save", targetType: "settings", targetId: "nav", before, after: items, ip: actor.ip });
    });
    await bus.emit({ name: "nav.updated", payload: {}, tags: [CACHE_TAG] });
  }

  /** Salvează ciorna (validată ca meniul publicat); site-ul o vede doar în previzualizare. */
  async saveDraft(actor: GcsActor, items: GcsNavItemInput[]): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, MENUS_ACP_SECTION, "edit");
    await this.validateAll(items);
    const json = items as unknown as Prisma.InputJsonValue;
    await db.navDraft.upsert({ where: { id: 1 }, create: { id: 1, items: json, updatedById: actor.userId }, update: { items: json, updatedById: actor.userId } });
  }

  /** „Publică”: ciorna devine meniul site-ului (cu jurnal), apoi se șterge. */
  async publishDraft(actor: GcsActor): Promise<boolean> {
    const draft = await this.deps.db.navDraft.findUnique({ where: { id: 1 } });
    if (!draft) return false;
    await this.save(actor, draft.items as unknown as GcsNavItemInput[]);
    await this.deps.db.navDraft.deleteMany({ where: { id: 1 } });
    return true;
  }

  /** „Renunță”: ciorna se șterge, meniul publicat rămâne. */
  async discardDraft(actor: GcsActor): Promise<void> {
    await this.deps.acp.assert(actor, MENUS_ACP_SECTION, "edit");
    await this.deps.db.navDraft.deleteMany({ where: { id: 1 } });
  }

  /** „Restaurează meniul implicit”: meniul implicit al modulelor devine ciorna (se publică după previzualizare). */
  async restoreDefaultsToDraft(actor: GcsActor): Promise<void> {
    const items: GcsNavItemInput[] = navDefaults(this.deps.registry, "current").map((n) => ({
      label: { key: n.labelKey },
      icon: n.icon,
      href: n.href,
      appKey: n.appKey,
      kind: n.appKey ? "app" : "link",
      children: (n.children ?? []).map((c) => ({ label: { key: c.labelKey }, icon: c.icon, href: c.href })),
    }));
    await this.saveDraft(actor, items);
  }

  /** Aplică ordinea aplicațiilor (ACP → Aplicații) itemilor lor de pe primul nivel (`reorderAppItems`). */
  async applyAppOrder(actor: GcsActor, order: readonly string[]): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, APPS_ACP_SECTION, "edit");
    const top = await db.navItem.findMany({ where: { parentId: null }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, appKey: true, position: true } });
    const next = reorderAppItems(top, order);
    if (next.every((r, i) => r.id === top[i]!.id)) return;
    await db.$transaction(async (tx) => {
      for (const [position, r] of next.entries()) await tx.navItem.update({ where: { id: r.id }, data: { position } });
    });
    await bus.emit({ name: "nav.updated", payload: {}, tags: [CACHE_TAG] });
  }

  /** Meniul implicit din itemii declarați de module, dacă meniul e gol (seed; idempotent). */
  static async seedDefaults(tx: Prisma.TransactionClient, registry: GcsModuleRegistry): Promise<void> {
    if ((await tx.navItem.count()) > 0) return;
    await createDefaults(tx, navDefaults(registry, "current"), 0, true);
  }

  /**
   * Actualizarea meniului unei instalări existente la meniul implicit curent (o singură dată pe marcaj: `nav:v2`,
   * `nav:v3`…):
   * - meniul nemodificat (identic cu meniul implicit dinaintea marcajului) e înlocuit cu cel nou;
   * - un meniu modificat de admin rămâne cum e; itemii noi de pe primul nivel, cu un link care nu există încă în meniu,
   *   se adaugă la coadă **activi** (decizia proprietarului, 2026-10-08: o aplicație nouă apare singură în meniu; adminul
   *   o poate ascunde din Manager meniu).
   *
   * Meniul dinaintea lui `nav:v2` e cel din `navPrevious`; dinaintea unui marcaj mai nou, e meniul curent fără itemii
   * aduși de el sau de marcajele de după (`since`).
   */
  static async upgradeDefaults(tx: Prisma.TransactionClient, registry: GcsModuleRegistry, mark: string = NAV_MARKS[0]!): Promise<"replaced" | "appended" | "unchanged"> {
    const rows = (await tx.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] })).map((r) => ({ ...r, groups: jsonInts(r.groups) }));
    const current = navDefaults(registry, "current");
    const index = Math.max(0, NAV_MARKS.indexOf(mark));
    // Meniul dinaintea marcajului: fără itemii și fără copiii aduși de el sau de marcajele de după.
    const before = (since: string | undefined) => NAV_MARKS.indexOf(since ?? NAV_MARKS[0]!) < index;
    const previous =
      index === 0
        ? navDefaults(registry, "previous")
        : current.filter((n) => before(n.since)).map((n) => (n.children ? { ...n, children: n.children.filter((c) => before(c.since)) } : n));
    if (matchesDefaults(rows, previous)) {
      await tx.navItem.deleteMany({});
      await createDefaults(tx, current, 0, true);
      return "replaced";
    }
    const hrefs = new Set(rows.map((r) => r.href).filter((h): h is string => h !== null));
    const missing = current.filter((n) => !hrefs.has(n.href));
    if (missing.length === 0) return "unchanged";
    const start = rows.filter((r) => r.parentId === null).reduce((max, r) => Math.max(max, r.position + 1), 0);
    await createDefaults(tx, missing, start, true);
    return "appended";
  }

  /**
   * Marcajul `nav:v5` (o singură dată): pornește itemii impliciți adăugați **dezactivați** de actualizările dinainte
   * (`nav:v2`–`nav:v4`) și completează submeniul implicit al unui item de pe primul nivel care nu are copii (ex. Membri).
   * Se ating doar itemii identici cu cei impliciți (aceeași etichetă-cheie, link și aplicație); itemii proprii ai adminului
   * rămân neschimbați. Un copil implicit al cărui link adminul l-a pus singur pe primul nivel (ex. Staff) nu se mai adaugă.
   */
  static async enableDefaults(tx: Prisma.TransactionClient, registry: GcsModuleRegistry): Promise<{ enabled: number; children: number }> {
    const rows = await tx.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    const top = rows.filter((r) => r.parentId === null);
    const topHrefs = new Set(top.map((r) => r.href).filter((h): h is string => h !== null));
    const defaults = navDefaults(registry, "current");
    const defaultHrefs = new Set(defaults.map((d) => d.href));
    let enabled = 0;
    let children = 0;
    for (const d of defaults) {
      const row = top.find((r) => r.href === d.href && labelKeyOf(r.label) === d.labelKey && r.appKey === d.appKey);
      if (!row) continue;
      if (!row.enabled) {
        await tx.navItem.update({ where: { id: row.id }, data: { enabled: true } });
        enabled++;
      }
      const kids = d.children ?? [];
      if (kids.length === 0 || rows.some((r) => r.parentId === row.id)) continue;
      let position = 0;
      for (const c of kids) {
        if (topHrefs.has(c.href) && !defaultHrefs.has(c.href)) continue;
        await tx.navItem.create({ data: { parentId: row.id, position: position++, label: { key: c.labelKey }, icon: c.icon, href: c.href, groups: [] } });
        children++;
      }
    }
    return { enabled, children };
  }

  /**
   * Marcajul `nav:v6` (și următoarele care aduc copii noi, o singură dată): sub fiecare item implicit de pe primul nivel
   * găsit neschimbat (aceeași etichetă-cheie, același link, aceeași aplicație) se adaugă la coadă, **activi**, copiii
   * impliciți aduși de marcaj (`since`) al căror link lipsește din submeniul lui. Itemii creați sau redenumiți de admin
   * nu se ating; copiii mai vechi scoși de admin nu revin; un copil al cărui link adminul l-a pus singur pe primul nivel
   * (un link care nu e implicit acolo) nu se dublează.
   */
  static async appendDefaultChildren(tx: Prisma.TransactionClient, registry: GcsModuleRegistry, mark: string): Promise<number> {
    const rows = await tx.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    const top = rows.filter((r) => r.parentId === null);
    const topHrefs = new Set(top.map((r) => r.href).filter((h): h is string => h !== null));
    const defaults = navDefaults(registry, "current");
    const defaultTopHrefs = new Set(defaults.map((d) => d.href));
    let added = 0;
    for (const d of defaults) {
      const kids = (d.children ?? []).filter((c) => c.since === mark);
      if (kids.length === 0) continue;
      const row = top.find((r) => r.href === d.href && labelKeyOf(r.label) === d.labelKey && r.appKey === d.appKey);
      if (!row) continue;
      const existing = rows.filter((r) => r.parentId === row.id);
      const have = new Set(existing.map((r) => r.href));
      let position = existing.reduce((max, r) => Math.max(max, r.position + 1), 0);
      for (const c of kids) {
        if (have.has(c.href) || (topHrefs.has(c.href) && !defaultTopHrefs.has(c.href))) continue;
        await tx.navItem.create({ data: { parentId: row.id, position: position++, label: { key: c.labelKey }, icon: c.icon, href: c.href, groups: [], enabled: true } });
        have.add(c.href);
        added++;
      }
    }
    return added;
  }
}

type NavDefaultItem = GcsNavDefault & { appKey: string | null };

/** Itemii impliciți (curenți sau anteriori) ai tuturor modulelor, în ordinea pozițiilor. */
function navDefaults(registry: GcsModuleRegistry, which: "current" | "previous"): NavDefaultItem[] {
  return registry
    .all()
    .flatMap((m) => ((which === "previous" ? (m.navPrevious ?? m.nav) : m.nav) ?? []).map((n) => ({ ...n, appKey: m.app?.optional ? m.key : null })))
    .sort((a, b) => a.position - b.position);
}

async function createDefaults(tx: Prisma.TransactionClient, items: NavDefaultItem[], start: number, enabled: boolean): Promise<void> {
  for (const [i, n] of items.entries()) {
    const row = await tx.navItem.create({ data: { position: start + i, label: { key: n.labelKey }, icon: n.icon, href: n.href, appKey: n.appKey, kind: n.appKey ? "app" : "link", groups: [], enabled } });
    for (const [position, c] of (n.children ?? []).entries()) {
      await tx.navItem.create({ data: { parentId: row.id, position, label: { key: c.labelKey }, icon: c.icon, href: c.href, groups: [] } });
    }
  }
}

/** Cheia etichetei unui item (`{ key }`), sau `null` pentru o etichetă scrisă de admin. */
function labelKeyOf(label: Prisma.JsonValue): string | null {
  return label && typeof label === "object" && !Array.isArray(label) && Object.keys(label).length === 1 && typeof (label as Record<string, unknown>).key === "string"
    ? ((label as Record<string, unknown>).key as string)
    : null;
}

/** `true` dacă rândurile sunt exact meniul implicit dat: aceiași itemi, în aceeași ordine, cu valorile implicite. */
function matchesDefaults(rows: Row[], defaults: NavDefaultItem[]): boolean {
  const same = (r: Row, d: GcsNavDefaultChild, appKey: string | null) => {
    const label = r.label as Record<string, unknown> | null;
    return (
      !!label &&
      Object.keys(label).length === 1 &&
      label.key === d.labelKey &&
      r.icon === d.icon &&
      r.href === d.href &&
      r.appKey === appKey &&
      r.groups.length === 0 &&
      !r.newTab &&
      r.enabled &&
      !r.shortLink
    );
  };
  const top = rows.filter((r) => r.parentId === null);
  if (top.length !== defaults.length || rows.length !== defaults.reduce((n, d) => n + 1 + (d.children?.length ?? 0), 0)) return false;
  return top.every((r, i) => {
    const d = defaults[i]!;
    const children = rows.filter((c) => c.parentId === r.id);
    const expected = d.children ?? [];
    return same(r, d, d.appKey) && children.length === expected.length && children.every((c, j) => same(c, expected[j]!, null));
  });
}
