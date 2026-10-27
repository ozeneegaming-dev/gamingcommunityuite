import type { ForumType, PrismaClient } from "@gcs/db";
import type { GcsActor } from "../permissions/types";
import type { GcsCache } from "../cache";

/**
 * Sloturile de extensie ale forumului (Forum v2, specul `2026-10-17-forum-v2-sloturi`): punctele în care aplicațiile
 * (modulele din `@gcs/modules`, ex. Servere, „Aspect forumuri”, Recrutare) și pluginurile adaugă conținut și stil în
 * lista forumurilor, pe pagina unui forum, pe pagina unui topic și în formularul ACP al forumului. Funcționează în orice
 * temă: nucleul desenează conținutul cu componentele sistemului, pe tokenurile temei.
 *
 * Tot ce vine de la o extensie trece pe aici înainte să ajungă în pagină: `sanitizeSlotItems` (conținutul),
 * `sanitizeSlotStyle` (clasele și variabilele CSS) și `validateExtensionValues` (valorile salvate din formular).
 */

// ─── Punctele de randare ─────────────────────────────────────────────────────────────────────────────────

/**
 * Sloturile de conținut:
 * - `forum.row.title`: lângă titlul forumului din listă (etichete, insigne);
 * - `forum.row.meta`: un rând sub descrierea forumului din listă;
 * - `category.header`: în banda de titlu a categoriei (în dreapta titlului);
 * - `forum.row.sub`: lângă un subforum din lista rândului părinte (insigne ON / OFF / NOU);
 * - `forum.page.top`: un card sus pe pagina forumului (sub antet);
 * - `topic.bar`: o bară mică pe pagina topicului (sub antet).
 */
export const GCS_FORUM_SLOTS = ["forum.row.title", "forum.row.meta", "forum.row.sub", "category.header", "forum.page.top", "topic.bar"] as const;
export type GcsForumSlot = (typeof GCS_FORUM_SLOTS)[number];

/** Cârligele de stil: rândul unui forum din listă și secțiunea unei categorii (clase + variabile CSS pe rădăcină). */
export const GCS_FORUM_STYLE_HOOKS = ["forum.row", "category"] as const;
export type GcsForumStyleHook = (typeof GCS_FORUM_STYLE_HOOKS)[number];

/** Tipurile de noduri (`ForumType`) în ordinea din ACP. */
export const GCS_FORUM_NODE_TYPES = ["CATEGORY", "FORUM", "QA", "LINK", "PAGE"] as const satisfies readonly ForumType[];

// ─── Conținutul ──────────────────────────────────────────────────────────────────────────────────────────

/** Un text: deja tradus (ex. date introduse de admin) sau o cheie de mesaj a site-ului, cu parametri. */
export type GcsSlotText = string | { key: string; params?: Record<string, string | number> };
export type GcsSlotTone = "accent" | "neutral" | "ok" | "warn" | "danger" | "info";
export const GCS_SLOT_TONES = ["accent", "neutral", "ok", "warn", "danger", "info"] as const satisfies readonly GcsSlotTone[];

/** O valoare JSON (props-urile unei componente web). */
export type GcsSlotJson = null | boolean | number | string | GcsSlotJson[] | { [key: string]: GcsSlotJson };

/**
 * O pastilă: eticheta, iconița (Font Awesome după nume), tonul (culoarea temei) sau o culoare proprie `#RRGGBB`, un link
 * intern (`/…`) sau `https://`, și tooltip-ul. `id`: o cheie stabilă (folosită în `data-slot-item`, pentru teste și CSS).
 */
export type GcsSlotChip = { kind: "chip"; label: GcsSlotText; icon?: string; tone?: GcsSlotTone; color?: string; href?: string; tooltip?: GcsSlotText; id?: string };
/** Un rând de text (cu iconiță și link opțional). */
export type GcsSlotLine = { kind: "text"; text: GcsSlotText; icon?: string; tone?: GcsSlotTone; href?: string; id?: string };
/** O valoare cu etichetă (ex. „Jucători 12/32”). */
export type GcsSlotStat = { kind: "stat"; label: GcsSlotText; value: string | number; icon?: string; tone?: GcsSlotTone; id?: string };
export type GcsSlotAction = { label: GcsSlotText; href: string; icon?: string; variant?: "primary" | "ghost" };
/** Un card (pentru `forum.page.top` și `topic.bar`): titlu, iconiță, text, elemente, butoane și o imagine opțională. */
export type GcsSlotCard = {
  kind: "card";
  title?: GcsSlotText;
  icon?: string;
  body?: GcsSlotText;
  tone?: GcsSlotTone;
  items?: (GcsSlotChip | GcsSlotLine | GcsSlotStat)[];
  actions?: GcsSlotAction[];
  /** `/files/<id>`, o imagine a unui plugin (`/plugins/<cheie>/…`) sau `https://`. */
  image?: string;
  id?: string;
};
/** HTML deja sanitizat (doar pluginurile: trecut prin sanitizerul pluginurilor și închis în containerul lor). */
export type GcsSlotHtml = { kind: "html"; html: string; plugin?: string; id?: string };
/**
 * O componentă React a site-ului, după cheie (registrul din `apps/web/lib/forum-slots/components.tsx`), cu props JSON.
 * Pentru aplicațiile care au nevoie de mai mult decât elementele de bază (ex. starea live a unui server).
 */
export type GcsSlotComponent = { kind: "component"; component: string; props?: Record<string, GcsSlotJson>; id?: string };
export type GcsSlotItem = GcsSlotChip | GcsSlotLine | GcsSlotStat | GcsSlotCard | GcsSlotHtml | GcsSlotComponent;

/** Ce elemente acceptă fiecare slot (restul se ignoră). */
export const GCS_SLOT_KINDS: Record<GcsForumSlot, readonly GcsSlotItem["kind"][]> = {
  "forum.row.title": ["chip", "html", "component"],
  "forum.row.meta": ["chip", "text", "stat", "html", "component"],
  "forum.row.sub": ["chip", "html", "component"],
  "category.header": ["chip", "text", "stat", "html", "component"],
  "forum.page.top": ["card", "chip", "text", "stat", "html", "component"],
  "topic.bar": ["chip", "text", "stat", "card", "html", "component"],
};

/** Câte elemente poate pune o extensie într-un slot (o extensie greșită nu poate umple pagina). */
export const GCS_SLOT_MAX_ITEMS = 12;

// ─── Stilul ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stilul pus de o extensie pe rădăcina unui rând de forum sau a unei categorii: clase și variabile CSS. Nucleul
 * documentează variabilele pe care CSS-ul lui le folosește în orice temă (`GCS_FORUM_STYLE_VARS`); aplicațiile își pot
 * aduce și variabilele / clasele lor (`--gcsx-*`, `gcsx-*`), iar pluginurile pe ale lor (`--gcsp-*`, `gcsp-*`, închise în
 * CSS-ul pluginului).
 */
export type GcsSlotStyle = { classes?: string[]; vars?: Record<string, string> };
export type GcsSlotStyleResult = { classes: string[]; vars: Record<string, string> };

/** Variabilele CSS ale rândului / categoriei pe care le folosește CSS-ul nucleului (lists.css, forum.css). */
export const GCS_FORUM_STYLE_VARS = {
  /** Bara mică din stânga (carduri separate) și culoarea iconiței. */
  "--gcs-forum-color": "color",
  /** Culoarea titlului forumului (sau a categoriei). */
  "--gcs-forum-title-color": "color",
  /** Fundalul rândului (sau al benzii categoriei). */
  "--gcs-forum-row-bg": "color",
  /** Imaginea de fundal a rândului (sau a benzii categoriei): `url("/files/<id>")`. */
  "--gcs-forum-row-image": "url",
  /** Poziția imaginii (punctul de interes): ex. `50% 30%`. */
  "--gcs-forum-row-image-pos": "position",
  /** Cât de închis e voalul peste imagine (0–1), normal și la hover. */
  "--gcs-forum-row-veil": "number",
  "--gcs-forum-row-veil-hover": "number",
  /** Chenarul rândului. */
  "--gcs-forum-row-border": "color",
  /** Imaginea pentru temele deschise (lipsă: aceeași imagine). */
  "--gcs-forum-row-image-light": "url",
  /** Iconița ca imagine (cu `gcs-forumRow--iconImage`) și varianta „cu mesaje noi” (lipsă: cea normală, cu contur). */
  "--gcs-forum-icon-image": "url",
  "--gcs-forum-icon-image-unread": "url",
  /** Gradientul titlului (cu `gcs-forumRow--titleGradient` / `gcs-category--titleGradient`). */
  "--gcs-forum-title-fill": "gradient",
  /** Bara de accent din stânga (cu `gcs-forumRow--accentBar`; lipsă: `--gcs-forum-color`). */
  "--gcs-forum-accent": "color",
} as const;

/** Clasele de stil ale nucleului (modificatori documentați, cu CSS în orice temă). */
export const GCS_FORUM_STYLE_CLASSES = [
  "gcs-forumRow--image",
  /** Imaginea doar în dreapta rândului (estompată spre stânga), în locul celei pe tot rândul. */
  "gcs-forumRow--imageRight",
  /** Fără imaginea de fundal pe ecranele înguste. */
  "gcs-forumRow--imageDesktop",
  "gcs-forumRow--iconImage",
  "gcs-forumRow--titleCaps",
  "gcs-forumRow--titleGlow",
  "gcs-forumRow--titleGradient",
  "gcs-forumRow--accentBar",
  "gcs-forumRow--muted",
  "gcs-category--image",
  "gcs-category--imageRight",
  "gcs-category--iconImage",
  "gcs-category--titleCaps",
  "gcs-category--titleGlow",
  "gcs-category--titleGradient",
] as const;

const CLASS_RE = /^(?:gcsx|gcsp)-[a-z0-9][a-z0-9-]{0,47}$/;
/** Clasa containerului unui plugin (`gcsp--<vendor>--<nume>`): pusă de nucleu, nu de extensie. */
const PLUGIN_SCOPE_RE = /^gcsp--[a-z][a-z0-9_]*--[a-z][a-z0-9_]*$/;
const VAR_RE = /^--(?:gcs-forum|gcsx|gcsp)-[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_CLASSES = 16;
const MAX_VARS = 24;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NUMBER = /^-?(?:\d{1,6}(?:\.\d{1,4})?|\.\d{1,4})(?:px|rem|em|%|deg|s|ms|vw|vh|fr)?$/;
const IDENT = /^[a-z][a-z-]{0,30}$/;
/** Un fișier al site-ului (`/files/<id>`) sau al unui plugin (`/plugins/<cheie>/assets|media/…`). */
const LOCAL_URL = /^\/(?:files\/[A-Za-z0-9_-]{1,40}|plugins\/[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\/(?:assets|media)\/[A-Za-z0-9._/-]{1,160})$/;

function safeUrl(path: string): boolean {
  return LOCAL_URL.test(path) && !path.split("/").some((s) => s === ".." || s === ".");
}

/**
 * O valoare de variabilă CSS sigură: o culoare hex, un număr (cu unitate), un cuvânt simplu (`none`, `uppercase`),
 * 1–3 numere / procente (poziții, ex. `50% 30%`), `url("/files/<id>")` (fișierele site-ului sau ale unui plugin) sau
 * `linear-gradient(<unghi>deg, #hex, #hex[, #hex])`. Orice altceva (`expression`, `;`, acolade, adrese externe) e refuzat.
 */
export function isSafeCssValue(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > 200) return false;
  if (HEX.test(v) || NUMBER.test(v) || IDENT.test(v)) return true;
  const parts = v.split(/\s+/);
  if (parts.length <= 3 && parts.every((p) => NUMBER.test(p) || /^(?:top|bottom|left|right|center)$/.test(p))) return true;
  const url = /^url\("([^"]+)"\)$/.exec(v);
  if (url) return safeUrl(url[1]!);
  const gradient = /^linear-gradient\((-?\d{1,3})deg((?:\s*,\s*#[0-9a-fA-F]{6}(?:\s+\d{1,3}%)?){2,4})\)$/.exec(v);
  return gradient !== null;
}

/**
 * Stilul unei extensii, curățat: doar clasele permise (ale nucleului, `gcsx-*`, `gcsp-*` și containerul unui plugin) și
 * variabilele cu nume și valoare sigure. Ce nu trece se aruncă în tăcere (o extensie greșită nu strică rândul).
 */
export function sanitizeSlotStyle(raw: unknown, opts: { pluginScope?: string } = {}): GcsSlotStyleResult {
  const out: GcsSlotStyleResult = { classes: [], vars: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { classes?: unknown; vars?: unknown };
  if (Array.isArray(r.classes)) {
    for (const c of r.classes) {
      if (typeof c !== "string" || out.classes.length >= MAX_CLASSES) continue;
      const ok = (GCS_FORUM_STYLE_CLASSES as readonly string[]).includes(c) || CLASS_RE.test(c) || (opts.pluginScope !== undefined && c === opts.pluginScope && PLUGIN_SCOPE_RE.test(c));
      if (ok && !out.classes.includes(c)) out.classes.push(c);
    }
  }
  if (r.vars && typeof r.vars === "object" && !Array.isArray(r.vars)) {
    for (const [name, value] of Object.entries(r.vars as Record<string, unknown>)) {
      if (Object.keys(out.vars).length >= MAX_VARS) break;
      if (VAR_RE.test(name) && typeof value === "string" && isSafeCssValue(value)) out.vars[name] = value.trim();
    }
  }
  return out;
}

/** Stilurile mai multor extensii, în ordine: clasele se adună, iar la aceeași variabilă câștigă ultima. */
export function mergeSlotStyles(styles: (GcsSlotStyleResult | null | undefined)[]): GcsSlotStyleResult {
  const out: GcsSlotStyleResult = { classes: [], vars: {} };
  for (const s of styles) {
    if (!s) continue;
    for (const c of s.classes) if (!out.classes.includes(c)) out.classes.push(c);
    Object.assign(out.vars, s.vars);
  }
  return out;
}

// ─── Validarea conținutului ────────────────────────────────────────────────────────────────────────────

const ICON_RE = /^fa-(?:solid|regular|brands) fa-[a-z0-9-]{1,60}$/;
const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,60}$/i;
const COMPONENT_RE = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9.]{0,60}$/;
const TEXT_KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,120}$/;

/** Un link sigur: intern (`/…`, fără `//`) sau `https://`. */
export function isSafeSlotHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length > 500 || /[\s\u0000-\u001f"'<>\\]/.test(href)) return false;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  return URL.canParse(href) && new URL(href).protocol === "https:";
}

function cleanText(raw: unknown, max = 200): GcsSlotText | null {
  if (typeof raw === "string") {
    const t = raw.trim().slice(0, max);
    return t ? t : null;
  }
  if (raw && typeof raw === "object" && typeof (raw as { key?: unknown }).key === "string" && TEXT_KEY_RE.test((raw as { key: string }).key)) {
    const params: Record<string, string | number> = {};
    const p = (raw as { params?: unknown }).params;
    if (p && typeof p === "object" && !Array.isArray(p)) {
      for (const [k, v] of Object.entries(p as Record<string, unknown>).slice(0, 10)) {
        if (/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(k) && (typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))) params[k] = typeof v === "string" ? v.slice(0, 200) : v;
      }
    }
    return Object.keys(params).length > 0 ? { key: (raw as { key: string }).key, params } : { key: (raw as { key: string }).key };
  }
  return null;
}

const optIcon = (v: unknown) => (typeof v === "string" && ICON_RE.test(v) ? { icon: v } : {});
const optTone = (v: unknown) => (typeof v === "string" && (GCS_SLOT_TONES as readonly string[]).includes(v) ? { tone: v as GcsSlotTone } : {});
const optHref = (v: unknown) => (isSafeSlotHref(v) ? { href: v } : {});
const optId = (v: unknown) => (typeof v === "string" && ID_RE.test(v) ? { id: v } : {});

function cleanJson(v: unknown, depth = 0): GcsSlotJson | undefined {
  if (depth > 6) return undefined;
  if (v === null || typeof v === "boolean" || typeof v === "string") return typeof v === "string" ? v.slice(0, 2000) : v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => cleanJson(x, depth + 1)).filter((x): x is GcsSlotJson => x !== undefined);
  if (typeof v === "object") {
    const out: Record<string, GcsSlotJson> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 50)) {
      const c = cleanJson(x, depth + 1);
      if (c !== undefined) out[k.slice(0, 60)] = c;
    }
    return out;
  }
  return undefined;
}

function cleanSmall(raw: Record<string, unknown>): GcsSlotChip | GcsSlotLine | GcsSlotStat | null {
  if (raw.kind === "chip") {
    const label = cleanText(raw.label, 60);
    if (!label) return null;
    const tooltip = cleanText(raw.tooltip, 200);
    const color = typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? { color: raw.color.toUpperCase() } : {};
    return { kind: "chip", label, ...optIcon(raw.icon), ...optTone(raw.tone), ...color, ...optHref(raw.href), ...(tooltip ? { tooltip } : {}), ...optId(raw.id) };
  }
  if (raw.kind === "text") {
    const text = cleanText(raw.text, 300);
    return text ? { kind: "text", text, ...optIcon(raw.icon), ...optTone(raw.tone), ...optHref(raw.href), ...optId(raw.id) } : null;
  }
  if (raw.kind === "stat") {
    const label = cleanText(raw.label, 60);
    const value = typeof raw.value === "number" && Number.isFinite(raw.value) ? raw.value : typeof raw.value === "string" ? raw.value.trim().slice(0, 40) : null;
    return label && value !== null && value !== "" ? { kind: "stat", label, value, ...optIcon(raw.icon), ...optTone(raw.tone), ...optId(raw.id) } : null;
  }
  return null;
}

function cleanItem(raw: unknown, allowed: readonly GcsSlotItem["kind"][]): GcsSlotItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== "string" || !(allowed as readonly string[]).includes(r.kind)) return null;
  switch (r.kind) {
    case "chip":
    case "text":
    case "stat":
      return cleanSmall(r);
    case "card": {
      const title = cleanText(r.title, 120);
      const body = cleanText(r.body, 1000);
      const items = Array.isArray(r.items)
        ? r.items.slice(0, GCS_SLOT_MAX_ITEMS).map((i) => (i && typeof i === "object" ? cleanSmall(i as Record<string, unknown>) : null)).filter((i): i is GcsSlotChip | GcsSlotLine | GcsSlotStat => i !== null)
        : [];
      const actions = Array.isArray(r.actions)
        ? r.actions
            .slice(0, 4)
            .map((a) => {
              if (!a || typeof a !== "object") return null;
              const x = a as Record<string, unknown>;
              const label = cleanText(x.label, 60);
              if (!label || !isSafeSlotHref(x.href)) return null;
              return { label, href: x.href, ...optIcon(x.icon), ...(x.variant === "primary" || x.variant === "ghost" ? { variant: x.variant } : {}) } as GcsSlotAction;
            })
            .filter((a): a is GcsSlotAction => a !== null)
        : [];
      const image = typeof r.image === "string" && (safeUrl(r.image) || (isSafeSlotHref(r.image) && r.image.startsWith("https://"))) ? { image: r.image } : {};
      if (!title && !body && items.length === 0 && actions.length === 0) return null;
      return {
        kind: "card",
        ...(title ? { title } : {}),
        ...(body ? { body } : {}),
        ...optIcon(r.icon),
        ...optTone(r.tone),
        ...(items.length > 0 ? { items } : {}),
        ...(actions.length > 0 ? { actions } : {}),
        ...image,
        ...optId(r.id),
      };
    }
    case "html":
      // HTML-ul vine doar de la gazda pluginurilor (deja sanitizat); `plugin` alege foaia de stil a pluginului.
      return typeof r.html === "string" && r.html.trim() !== "" && r.html.length <= 100_000
        ? { kind: "html", html: r.html, ...(typeof r.plugin === "string" ? { plugin: r.plugin } : {}), ...optId(r.id) }
        : null;
    case "component": {
      if (typeof r.component !== "string" || !COMPONENT_RE.test(r.component)) return null;
      const props = cleanJson(r.props ?? {});
      return { kind: "component", component: r.component, props: props && typeof props === "object" && !Array.isArray(props) ? props : {}, ...optId(r.id) };
    }
    default:
      return null;
  }
}

/**
 * Elementele unei extensii pentru un slot, curățate: doar tipurile acceptate de slot (`GCS_SLOT_KINDS`), cu textele,
 * linkurile, iconițele și culorile verificate; cel mult `GCS_SLOT_MAX_ITEMS`. `html` e permis doar când apelantul îl
 * marchează (`allowHtml`, gazda pluginurilor), ca un modul să nu poată trimite HTML brut.
 */
export function sanitizeSlotItems(slot: GcsForumSlot, raw: unknown, opts: { allowHtml?: boolean } = {}): GcsSlotItem[] {
  if (!Array.isArray(raw)) return [];
  const allowed = GCS_SLOT_KINDS[slot].filter((k) => k !== "html" || opts.allowHtml === true);
  const out: GcsSlotItem[] = [];
  for (const item of raw.slice(0, GCS_SLOT_MAX_ITEMS)) {
    const clean = cleanItem(item, allowed);
    if (clean) out.push(clean);
  }
  return out;
}

// ─── Formularul ACP (taburi contribuite) ───────────────────────────────────────────────────────────────

/**
 * Legătura unui câmp cu stilul rândului: o variabilă CSS (valoarea câmpului, cu `unit` la numere) sau o clasă (la
 * `toggle`: pusă când e bifat; la `select`: `class` + valoarea aleasă, ex. `gcsx-aspect--` + `glow`).
 */
export type GcsExtFieldStyle = { var?: string; unit?: "px" | "%" | "deg" | "s" | ""; class?: string };
/** Un câmp text pus direct într-un slot de listă, ca pastilă (`chip`) sau rând (`text`). */
export type GcsExtFieldSlot = { slot: "forum.row.title" | "forum.row.meta" | "category.header"; as?: "chip" | "text"; icon?: string; tone?: GcsSlotTone };

type FieldBase = { key: string; labelKey: string; hintKey?: string };
/**
 * Un câmp al unui tab contribuit în formularul forumului. Valorile se salvează de nucleu (validate aici), per forum și
 * per extensie (`forum_extension_data`), și ajung la extensie în `node.data`.
 */
export type GcsForumExtField =
  | (FieldBase & { type: "text" | "textarea"; maxLength: number; default?: string; slot?: GcsExtFieldSlot })
  | (FieldBase & { type: "number"; min: number; max: number; step?: number; default?: number; style?: GcsExtFieldStyle })
  | (FieldBase & { type: "toggle"; default?: boolean; style?: GcsExtFieldStyle })
  | (FieldBase & { type: "select"; options?: readonly { value: string; labelKey: string }[]; optionsFrom?: string; default?: string; style?: GcsExtFieldStyle })
  | (FieldBase & { type: "color"; default?: string; style?: GcsExtFieldStyle })
  | (FieldBase & { type: "icon"; default?: string })
  /**
   * O imagine încărcată în stocarea platformei (`/files/<id>`; PNG, WebP, GIF sau SVG curățat, recodate în WebP):
   * valoarea e id-ul fișierului, iar `style.var` primește `url("/files/<id>")`. `maxKb`: mărimea maximă a fișierului
   * încărcat; `maxSide`: latura maximă după recodare; `animated`: un GIF / WebP animat rămâne animat.
   */
  | (FieldBase & { type: "image"; maxKb: number; maxSide: number; animated?: boolean; style?: GcsExtFieldStyle });

/**
 * Un tab contribuit în ACP → Forumuri → Editează: câmpurile (formular generic, salvat de nucleu) și/sau o componentă a
 * site-ului (`component`, din registrul web) desenată sub câmpuri. `types`: tipurile de noduri unde apare (implicit toate).
 */
export type GcsForumEditTab = {
  key: string;
  labelKey: string;
  icon: string;
  /** Ordinea între taburi (cele de bază: Detalii 0, Opțiuni 10, Pagină 20, Evaluare 30); implicit 100. */
  position?: number;
  descriptionKey?: string;
  types?: readonly ForumType[];
  fields?: readonly GcsForumExtField[];
  component?: string;
  /** Doar pluginuri: corpul tabului vine din punctul `forum.edit` (HTML cu formulare spre rutele pluginului). */
  pluginHook?: boolean;
};

/** Un subforum din lista unui rând (sub descriere), cu datele salvate ale extensiei. */
export type GcsForumSlotChild = { id: number; type: ForumType; name: string; slug: string; data: Record<string, unknown> };

/**
 * Un nod al forumului (categorie, forum, link, pagină) cu datele salvate ale extensiei (`data`). `parent`: nodul
 * părinte cu datele lui (moștenirea, ex. fundalul unui forum pentru subforumurile lui); `children`: subforumurile din
 * lista rândului (pentru insignele lor, slotul `forum.row.sub`).
 */
export type GcsForumSlotNode = {
  id: number;
  type: ForumType;
  parentId: number | null;
  name: string;
  slug: string;
  data: Record<string, unknown>;
  parent?: { id: number; type: ForumType; data: Record<string, unknown> } | null;
  children?: GcsForumSlotChild[];
};

/** Contextul unei extensii: baza, cache-ul, vizitatorul, limba și pagina pe care se randează. */
export type GcsForumSlotContext = { db: PrismaClient; cache: GcsCache; actor: GcsActor; locale: string; surface: "index" | "forum" | "topic" };

/**
 * Ce pune o extensie pe un nod dintr-o listă: în sloturile rândului / categoriei, stilul lui și, în `subs`, insignele
 * subforumurilor din lista rândului (după id-ul subforumului).
 */
export type GcsForumListSlots = { title?: GcsSlotItem[]; meta?: GcsSlotItem[]; header?: GcsSlotItem[]; subs?: Record<number, GcsSlotItem[]>; style?: GcsSlotStyle };

/**
 * O extensie a forumului (declarată de un modul în `GcsModule.forumExtensions` sau generată din manifestul unui plugin).
 * `key` e spațiul de nume al datelor salvate (unic). Toate funcțiile sunt opționale; cele de listă primesc toate nodurile
 * paginii o dată (fără interogări pe rând).
 */
export type GcsForumExtension = {
  key: string;
  /** Ordinea între extensii (în sloturi și la stil; mai mic = mai devreme); implicit 100. */
  position?: number;
  tabs?: readonly GcsForumEditTab[];
  /** Validarea între câmpuri, după cea a fiecărui câmp: erorile pe câmp (chei de traducere) sau `null`. */
  validate?: (values: Record<string, unknown>, node: { id: number; type: ForumType }) => Record<string, string> | null;
  /** Stilul rândului / categoriei din datele salvate (pur, fără IO), pe lângă cel declarat pe câmpuri. */
  style?: (node: GcsForumSlotNode) => GcsSlotStyle | null;
  /** Conținutul sloturilor de listă (index, subforumuri), pe nod. */
  list?: (ctx: GcsForumSlotContext, nodes: GcsForumSlotNode[]) => Promise<Record<number, GcsForumListSlots>>;
  /** Cardurile de sus ale paginii unui forum. */
  forumPage?: (ctx: GcsForumSlotContext, node: GcsForumSlotNode) => Promise<GcsSlotItem[] | null>;
  /** Bara de pe pagina unui topic. */
  topicBar?: (ctx: GcsForumSlotContext, input: { node: GcsForumSlotNode; topic: { id: number; title: string; authorId: string | null } }) => Promise<GcsSlotItem[] | null>;
  /** Doar pluginuri: cheia pluginului (HTML-ul lui e permis, foaia lui de stil se adaugă în pagină). */
  plugin?: string;
};

/** Câmpurile tuturor taburilor unei extensii (cheile sunt unice în extensie). */
export function extensionFields(ext: Pick<GcsForumExtension, "tabs">): GcsForumExtField[] {
  return (ext.tabs ?? []).flatMap((t) => t.fields ?? []);
}

/** Taburile unei extensii care apar pentru un tip de nod. */
export function tabsForType(ext: Pick<GcsForumExtension, "tabs">, type: ForumType): GcsForumEditTab[] {
  return (ext.tabs ?? []).filter((t) => !t.types || t.types.includes(type));
}

/** Valoarea implicită a unui câmp. */
export function extFieldDefault(f: GcsForumExtField): unknown {
  switch (f.type) {
    case "text":
    case "textarea":
      return f.default ?? "";
    case "number":
      return f.default ?? f.min;
    case "toggle":
      return f.default ?? false;
    case "select":
      return f.default ?? f.options?.[0]?.value ?? "";
    case "color":
    case "icon":
      return f.default ?? "";
    case "image":
      return "";
  }
}

/**
 * Valorile unui tab trimise din formular (text din `FormData`, sau deja tipizate), validate și normalizate după câmpuri:
 * `{ ok, values }` sau erorile pe câmp (chei de traducere: `too_long`, `invalid_range`, `invalid_choice`,
 * `invalid_color`, `invalid_icon`). `options` dă opțiunile câmpurilor `select` cu `optionsFrom` (calculate de apelant).
 */
export function validateExtensionValues(
  fields: readonly GcsForumExtField[],
  raw: Record<string, unknown>,
  options: Record<string, readonly string[]> = {},
): { ok: true; values: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = raw[f.key];
    switch (f.type) {
      case "text":
      case "textarea": {
        const s = typeof v === "string" ? v.trim() : "";
        if (s.length > f.maxLength) errors[f.key] = "too_long";
        else values[f.key] = s;
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : (f.default ?? f.min);
        const stepOk = f.step === undefined || Number.isInteger(Math.round((n - f.min) / f.step * 1e6) / 1e6);
        if (!Number.isFinite(n) || n < f.min || n > f.max || !stepOk) errors[f.key] = "invalid_range";
        else values[f.key] = n;
        break;
      }
      case "toggle":
        values[f.key] = v === true || v === "on" || v === "true" || v === "1";
        break;
      case "select": {
        const s = typeof v === "string" ? v : String(extFieldDefault(f));
        const allowed = f.options ? f.options.map((o) => o.value) : (options[f.key] ?? []);
        if (s !== "" && !allowed.includes(s)) errors[f.key] = "invalid_choice";
        else values[f.key] = s;
        break;
      }
      case "color": {
        const s = typeof v === "string" ? v.trim() : "";
        if (s !== "" && !/^#[0-9a-fA-F]{6}$/.test(s)) errors[f.key] = "invalid_color";
        else values[f.key] = s.toUpperCase();
        break;
      }
      case "icon": {
        const s = typeof v === "string" ? v.trim() : "";
        if (s !== "" && !ICON_RE.test(s)) errors[f.key] = "invalid_icon";
        else values[f.key] = s;
        break;
      }
      case "image": {
        const s = typeof v === "string" ? v.trim() : "";
        if (s !== "" && !FILE_ID_RE.test(s)) errors[f.key] = "invalid_image";
        else values[f.key] = s;
        break;
      }
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** Valorile salvate, completate cu cele implicite pentru câmpurile lipsă (ex. un câmp adăugat într-o versiune nouă). */
export function withExtensionDefaults(fields: readonly GcsForumExtField[], data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(data ?? {}) };
  for (const f of fields) if (!(f.key in out)) out[f.key] = extFieldDefault(f);
  return out;
}

/** Stilul declarat pe câmpuri (variabile și clase), din valorile salvate ale unui nod. */
export function fieldsStyle(fields: readonly GcsForumExtField[], data: Record<string, unknown>): GcsSlotStyle {
  const classes: string[] = [];
  const vars: Record<string, string> = {};
  for (const f of fields) {
    if (!("style" in f) || !f.style) continue;
    const v = data[f.key];
    const s = f.style;
    if (f.type === "toggle") {
      if (v === true && s.class) classes.push(s.class);
    } else if (f.type === "select") {
      if (typeof v === "string" && v !== "") {
        if (s.class) classes.push(`${s.class}${v}`);
        if (s.var) vars[s.var] = v;
      }
    } else if (f.type === "number") {
      if (typeof v === "number" && s.var) vars[s.var] = `${v}${s.unit ?? ""}`;
    } else if (f.type === "color") {
      if (typeof v === "string" && v !== "" && s.var) vars[s.var] = v;
    } else if (f.type === "image") {
      if (typeof v === "string" && FILE_ID_RE.test(v) && s.var) vars[s.var] = fileUrlValue(v);
    }
  }
  return { classes, vars };
}

/** Câmpurile text legate de un slot de listă, ca elemente (pastile sau rânduri) din valorile salvate. */
export function fieldsListSlots(fields: readonly GcsForumExtField[], data: Record<string, unknown>): GcsForumListSlots {
  const out: GcsForumListSlots = {};
  for (const f of fields) {
    if ((f.type !== "text" && f.type !== "textarea") || !f.slot) continue;
    const v = data[f.key];
    if (typeof v !== "string" || v.trim() === "") continue;
    const item: GcsSlotItem =
      (f.slot.as ?? "chip") === "chip"
        ? { kind: "chip", label: v.trim(), ...(f.slot.icon ? { icon: f.slot.icon } : {}), tone: f.slot.tone ?? "accent", id: f.key }
        : { kind: "text", text: v.trim(), ...(f.slot.icon ? { icon: f.slot.icon } : {}), ...(f.slot.tone ? { tone: f.slot.tone } : {}), id: f.key };
    const target = f.slot.slot === "forum.row.title" ? "title" : f.slot.slot === "forum.row.meta" ? "meta" : "header";
    (out[target] ??= []).push(item);
  }
  return out;
}

/** Id-ul unui fișier din stocarea platformei (`/files/<id>`). */
export const FILE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Valoarea CSS a unui fișier al site-ului: `url("/files/<id>")` (trece de `isSafeCssValue`). */
export function fileUrlValue(id: string): string {
  return `url("/files/${id}")`;
}

const EXT_KEY_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,3}$/;
const LOCAL_KEY_RE = /^[a-z][a-zA-Z0-9_]{0,39}$/;

/**
 * Verifică declarația unei extensii la înregistrare (registry): cheia, taburile și câmpurile (chei unice, intervale,
 * valori implicite, stiluri cu nume permise). Aruncă o eroare cu motivul (o greșeală de programare a modulului).
 */
export function assertForumExtension(ext: GcsForumExtension): void {
  const fail = (why: string) => {
    throw new Error(`Extensia de forum „${ext.key}”: ${why}`);
  };
  if (!EXT_KEY_RE.test(ext.key)) fail("cheie invalidă");
  const tabKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  for (const tab of ext.tabs ?? []) {
    if (!LOCAL_KEY_RE.test(tab.key) || tabKeys.has(tab.key)) fail(`tab invalid sau repetat „${tab.key}”`);
    tabKeys.add(tab.key);
    if (!ICON_RE.test(tab.icon)) fail(`iconiță invalidă la tabul „${tab.key}”`);
    if (tab.component !== undefined && !COMPONENT_RE.test(tab.component)) fail(`componentă invalidă la tabul „${tab.key}”`);
    for (const f of tab.fields ?? []) {
      if (!LOCAL_KEY_RE.test(f.key) || fieldKeys.has(f.key)) fail(`câmp invalid sau repetat „${f.key}”`);
      fieldKeys.add(f.key);
      if (f.type === "number" && (f.min > f.max || (f.default !== undefined && (f.default < f.min || f.default > f.max)))) fail(`interval invalid la „${f.key}”`);
      if (f.type === "image" && (f.maxKb < 1 || f.maxKb > 10_240 || f.maxSide < 16 || f.maxSide > 4096)) fail(`limite invalide la „${f.key}”`);
      if (f.type === "select" && !f.options && !f.optionsFrom) fail(`„${f.key}” nu are opțiuni`);
      if (f.type === "select" && f.options && f.default !== undefined && !f.options.some((o) => o.value === f.default)) fail(`valoare implicită invalidă la „${f.key}”`);
      if ("style" in f && f.style) {
        if (f.style.var !== undefined && !VAR_RE.test(f.style.var)) fail(`variabilă CSS nepermisă la „${f.key}”`);
        if (f.style.class !== undefined) {
          const cls = f.type === "select" ? `${f.style.class}x` : f.style.class;
          if (!(GCS_FORUM_STYLE_CLASSES as readonly string[]).includes(cls) && !CLASS_RE.test(cls)) fail(`clasă CSS nepermisă la „${f.key}”`);
        }
      }
      if ((f.type === "text" || f.type === "textarea") && f.slot && f.slot.icon !== undefined && !ICON_RE.test(f.slot.icon)) fail(`iconiță invalidă la „${f.key}”`);
    }
  }
}
