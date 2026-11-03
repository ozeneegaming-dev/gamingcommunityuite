/**
 * Constructorul de antet (specul 2026-10-10-hero-cockpit §9): o grilă cu 3 rânduri (bara de sus, rândul principal,
 * rândul secundar) × 3 zone (stânga, centru, dreapta), separat pentru desktop, tabletă și mobil. Elementele (logo,
 * meniu, căutare, acțiunile contului…) se mută între zone, rânduri sau în tava „nefolosite”. Presetările (Clasic,
 * Standard, Cockpit, Centrat, Panou lateral, Esports) sunt aspecte gata făcute ale aceleiași grile. Constructorul e
 * antetul SISTEMULUI: îl randează orice temă (designul temei schimbă doar aspectul, nu și funcțiile). Modul e pur
 * (fără Node): îl folosesc serverul (validarea temei), antetul site-ului și editorul vizual.
 */

export const HEADER_PRESETS = ["basic", "classic", "cockpit", "centered", "side", "esports"] as const;
export type GcsHeaderPreset = (typeof HEADER_PRESETS)[number];

export const HEADER_ROWS = ["top", "main", "bottom"] as const;
export type GcsHeaderRow = (typeof HEADER_ROWS)[number];
export const HEADER_ZONES = ["left", "center", "right"] as const;
export type GcsHeaderZone = (typeof HEADER_ZONES)[number];
export const HEADER_DEVICES = ["desktop", "tablet", "mobile"] as const;
export type GcsHeaderDevice = (typeof HEADER_DEVICES)[number];

/**
 * Elementele de bază ale antetului. `navRight` = partea din dreapta a meniului împărțit (Esports); `search` = iconița
 * care deschide panoul de căutare, `searchField` = câmpul întreg. `serversLive` vine din aplicația Servere.
 */
export const HEADER_ELEMENTS = [
  "logo",
  "nav",
  "navRight",
  "search",
  "searchField",
  "create",
  "messages",
  "notifications",
  "account",
  "breadcrumb",
  "serversLive",
  "social",
  "themeToggle",
  "language",
  "custom",
] as const;
export type GcsHeaderCoreElement = (typeof HEADER_ELEMENTS)[number];
/** Un element: unul de bază sau unul înregistrat de o aplicație (`aplicație.element`, ex. `chat.button`). */
export type GcsHeaderElement = GcsHeaderCoreElement | `${string}.${string}`;

const APP_ELEMENT_RE = /^[a-z][a-z0-9]{0,31}\.[a-z][a-zA-Z0-9]{0,31}$/;
/** Cel mult atâtea elemente într-o zonă. */
export const HEADER_ZONE_MAX = 12;
/** Cel mult atâția itemi de meniu aleși pentru partea din dreapta. */
export const HEADER_SPLIT_MAX = 50;

export const isHeaderElementKey = (v: unknown): v is GcsHeaderElement =>
  typeof v === "string" && ((HEADER_ELEMENTS as readonly string[]).includes(v) || APP_ELEMENT_RE.test(v));

export type GcsHeaderZones = Record<GcsHeaderZone, GcsHeaderElement[]>;
export type GcsHeaderDeviceLayout = Record<GcsHeaderRow, GcsHeaderZones>;

export type GcsHeaderBuilder = {
  /** Presetarea de la care a pornit aspectul (dă și stilul: crestătura Esports, panoul lateral…). */
  preset: GcsHeaderPreset;
  desktop: GcsHeaderDeviceLayout;
  tablet: GcsHeaderDeviceLayout;
  mobile: GcsHeaderDeviceLayout;
  /** Itemii de meniu (id-urile de pe primul nivel) din partea dreaptă a meniului împărțit; `null` = jumătate-jumătate. */
  split: number[] | null;
};

/**
 * Elementele barei de jos de pe mobil (navigarea cu degetul mare). `create` stă în centru, rotund (când e în listă).
 */
export const MOBILE_BAR_ITEMS = ["home", "forum", "servers", "create", "messages", "notifications", "search", "menu", "account", "chat", "activity", "clans"] as const;
export type GcsMobileBarItem = (typeof MOBILE_BAR_ITEMS)[number];
export const MOBILE_BAR_MAX = 5;
/** Bara implicită (cea din macheta Cockpit). */
export const DEFAULT_MOBILE_BAR: GcsMobileBarItem[] = ["forum", "servers", "create", "messages", "notifications"];

// ─── Presetările ────────────────────────────────────────────────────────────

type Z = Partial<Record<GcsHeaderZone, GcsHeaderElement[]>>;
const zones = (z: Z = {}): GcsHeaderZones => ({ left: z.left ?? [], center: z.center ?? [], right: z.right ?? [] });
const layout = (top: Z, main: Z, bottom: Z): GcsHeaderDeviceLayout => ({ top: zones(top), main: zones(main), bottom: zones(bottom) });

/** Pe tabletă și mobil, meniul devine butonul sertarului (☰), deci stă la începutul rândului. */
const PRESETS: Record<GcsHeaderPreset, () => Omit<GcsHeaderBuilder, "preset">> = {
  // „Clasic”: antetul temelor clasice de până acum, pe un singur rând: logo + meniu în stânga; în dreapta căutarea
  // (iconița), notificările, mesajele și contul (vizitatorii: Înregistrare / Autentificare). Implicit pe designul clasic.
  basic: () => ({
    desktop: layout({}, { left: ["logo", "nav"], right: ["search", "notifications", "messages", "account"] }, {}),
    tablet: layout({}, { left: ["nav", "logo"], right: ["search", "notifications", "messages", "account"] }, {}),
    mobile: layout({}, { left: ["nav", "logo"], right: ["search", "notifications", "messages", "account"] }, {}),
    split: null,
  }),
  // „Standard”: logo + meniu + luna / soarele (perechea de teme) + iconițele pe un rând, apoi breadcrumb-ul și câmpul de
  // căutare (implicit pe designul GCS: GCS Dark ↔ GCS White).
  classic: () => ({
    desktop: layout({}, { left: ["logo", "nav"], right: ["themeToggle", "notifications", "messages", "account"] }, { left: ["breadcrumb"], right: ["searchField"] }),
    tablet: layout({}, { left: ["nav", "logo"], right: ["search", "themeToggle", "notifications", "messages", "account"] }, { left: ["breadcrumb"] }),
    mobile: layout({}, { left: ["nav", "logo"], right: ["search", "notifications", "messages", "account"] }, {}),
    split: null,
  }),
  // Hero Cockpit: logo + acțiunile pe rândul 1, meniul cu mega meniuri pe rândul 2, statusul serverelor în dreapta.
  cockpit: () => ({
    desktop: layout({}, { left: ["logo"], right: ["search", "create", "messages", "notifications", "account"] }, { left: ["nav"], right: ["serversLive"] }),
    tablet: layout({}, { left: ["nav", "logo"], right: ["search", "create", "messages", "notifications", "account"] }, { right: ["serversLive"] }),
    mobile: layout({}, { left: ["nav", "logo"], right: ["search", "chat.button", "account"] }, {}),
    split: null,
  }),
  // Logo-ul centrat deasupra meniului.
  centered: () => ({
    desktop: layout({}, { left: ["social"], center: ["logo"], right: ["search", "create", "messages", "notifications", "account"] }, { center: ["nav"] }),
    tablet: layout({}, { left: ["nav"], center: ["logo"], right: ["search", "notifications", "account"] }, {}),
    mobile: layout({}, { left: ["nav"], center: ["logo"], right: ["account"] }, {}),
    split: null,
  }),
  // Panoul lateral (desktop): rândul principal devine o coloană fixă (logo sus, meniul, jos limba și tema);
  // bara de sus rămâne orizontală, deasupra conținutului.
  side: () => ({
    desktop: layout(
      { left: ["breadcrumb"], right: ["search", "create", "messages", "notifications", "account"] },
      { left: ["logo"], center: ["nav"], right: ["themeToggle", "language"] },
      {},
    ),
    tablet: layout({}, { left: ["nav", "logo"], right: ["search", "notifications", "messages", "account"] }, {}),
    mobile: layout({}, { left: ["nav", "logo"], right: ["search", "account"] }, {}),
    split: null,
  }),
  // Esports: rețelele sociale și contul sus, meniul împărțit în jurul crestăturii cu logo-ul, căutarea în dreapta.
  esports: () => ({
    desktop: layout(
      { left: ["social"], right: ["create", "messages", "notifications", "account"] },
      { left: ["nav"], center: ["logo"], right: ["navRight", "search"] },
      {},
    ),
    tablet: layout({ left: ["social"], right: ["messages", "notifications", "account"] }, { left: ["nav"], center: ["logo"], right: ["search"] }, {}),
    mobile: layout({}, { left: ["nav"], center: ["logo"], right: ["account"] }, {}),
    split: null,
  }),
};

/** O presetare (copie nouă, se poate modifica liber). */
export function headerPreset(name: GcsHeaderPreset): GcsHeaderBuilder {
  return { preset: name, ...PRESETS[name]() };
}

// ─── Validarea ──────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const sameKeys = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);

function deviceError(raw: unknown): string | null {
  if (!isObj(raw) || !sameKeys(raw, HEADER_ROWS)) return "invalid";
  const seen = new Set<string>();
  for (const row of HEADER_ROWS) {
    const r = raw[row];
    if (!isObj(r) || !sameKeys(r, HEADER_ZONES)) return "invalid";
    for (const zone of HEADER_ZONES) {
      const list = r[zone];
      if (!Array.isArray(list) || list.length > HEADER_ZONE_MAX) return "invalid";
      for (const key of list) {
        if (!isHeaderElementKey(key) || seen.has(key)) return "invalid";
        seen.add(key);
      }
    }
  }
  return null;
}

/** Codul erorii pentru un aspect de antet (`null` = valid): forma completă, chei cunoscute, fiecare element o dată pe dispozitiv. */
export function headerBuilderError(raw: unknown): string | null {
  if (!isObj(raw)) return "invalid_type";
  if (!sameKeys(raw, ["preset", ...HEADER_DEVICES, "split"])) return "invalid";
  if (typeof raw.preset !== "string" || !(HEADER_PRESETS as readonly string[]).includes(raw.preset)) return "invalid_choice";
  for (const device of HEADER_DEVICES) if (deviceError(raw[device])) return "invalid";
  const split = raw.split;
  if (split !== null) {
    if (!Array.isArray(split) || split.length > HEADER_SPLIT_MAX) return "invalid";
    if (!split.every((id) => Number.isInteger(id) && (id as number) > 0) || new Set(split).size !== split.length) return "invalid";
  }
  return null;
}

/** Codul erorii pentru lista barei de jos (1–5 elemente cunoscute, fără dubluri). */
export function mobileBarError(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MOBILE_BAR_MAX) return "invalid";
  if (!raw.every((k) => typeof k === "string" && (MOBILE_BAR_ITEMS as readonly string[]).includes(k)) || new Set(raw).size !== raw.length) return "invalid";
  return null;
}

// ─── Mutările (editorul) ────────────────────────────────────────────────────

/** Elementele puse undeva pe un dispozitiv, în ordinea rândurilor și a zonelor. */
export function placedHeaderElements(device: GcsHeaderDeviceLayout): GcsHeaderElement[] {
  return HEADER_ROWS.flatMap((row) => HEADER_ZONES.flatMap((zone) => device[row][zone]));
}

/** Tava „nefolosite”: elementele de bază și cele ale aplicațiilor (`extra`) care nu sunt puse pe dispozitiv. */
export function unusedHeaderElements(device: GcsHeaderDeviceLayout, extra: readonly GcsHeaderElement[] = []): GcsHeaderElement[] {
  const placed = new Set<string>(placedHeaderElements(device));
  return [...HEADER_ELEMENTS, ...extra].filter((k, i, all) => !placed.has(k) && all.indexOf(k) === i);
}

export type GcsHeaderSlot = { row: GcsHeaderRow; zone: GcsHeaderZone; index: number };

/** Mută un element într-o zonă (la poziția dată) sau în tava „nefolosite” (`null`). Întoarce o copie. */
export function moveHeaderElement(device: GcsHeaderDeviceLayout, key: GcsHeaderElement, to: GcsHeaderSlot | null): GcsHeaderDeviceLayout {
  if (!isHeaderElementKey(key)) return device;
  const out = structuredClone(device);
  for (const row of HEADER_ROWS) for (const zone of HEADER_ZONES) out[row][zone] = out[row][zone].filter((k) => k !== key);
  if (to) {
    const list = out[to.row][to.zone];
    if (list.length >= HEADER_ZONE_MAX) return device;
    list.splice(Math.max(0, Math.min(to.index, list.length)), 0, key);
  }
  return out;
}

/** JSON cu cheile obiectelor în ordine (aspectele citite din `jsonb` au altă ordine a cheilor). */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);

/** Două aspecte de antet sunt la fel (aceleași elemente în aceleași locuri), oricare ar fi ordinea cheilor. */
export const sameHeaderLayout = (a: GcsHeaderBuilder, b: GcsHeaderBuilder): boolean => canonical(a) === canonical(b);

/** Aspectul e exact cel al presetării lui (nimic mutat, meniul împărțit implicit). */
export function headerLayoutIsPreset(b: GcsHeaderBuilder): boolean {
  return sameHeaderLayout(b, headerPreset(b.preset));
}

// ─── Starea compactă (la derulare) ──────────────────────────────────────────

const COMPACT_KEEP = new Set<string>(["logo", "nav", "navRight", "search"]);
const emptyLayout = (): GcsHeaderDeviceLayout => layout({}, {}, {});

/**
 * Bara compactă de la derulare (specul §9, „Compact sticky”): rămâne doar rândul cu meniul (sau cel principal), cu
 * logo-ul, meniul și iconița de căutare; restul rândurilor se strâng. `moved` = elemente aduse din alt rând sau
 * scoase din rând (antetul se rearanjează); altfel tranziția e doar din CSS (Esports: rândul de sus se strânge,
 * crestătura se micșorează).
 */
export function compactHeaderLayout(device: GcsHeaderDeviceLayout): { layout: GcsHeaderDeviceLayout; row: GcsHeaderRow; moved: boolean } {
  const row = HEADER_ROWS.find((r) => HEADER_ZONES.some((z) => device[r][z].includes("nav"))) ?? "main";
  const src = device[row];
  const kept: GcsHeaderZones = zones({
    left: src.left.map((k) => (k === "searchField" ? "search" : k)).filter((k) => COMPACT_KEEP.has(k)),
    center: src.center.map((k) => (k === "searchField" ? "search" : k)).filter((k) => COMPACT_KEEP.has(k)),
    right: src.right.map((k) => (k === "searchField" ? "search" : k)).filter((k) => COMPACT_KEEP.has(k)),
  });
  const has = (k: string) => HEADER_ZONES.some((z) => kept[z].includes(k as GcsHeaderElement));
  if (!has("logo")) kept.left.unshift("logo");
  if (!has("search")) kept.right.push("search");
  const out = emptyLayout();
  out[row] = kept;
  const same = HEADER_ZONES.every((z) => JSON.stringify(kept[z]) === JSON.stringify(src[z]));
  return { layout: out, row, moved: !same };
}

// ─── Meniul împărțit ────────────────────────────────────────────────────────

/**
 * Meniul împărțit în jurul logo-ului (Esports): itemii aleși de admin (`split`, id-uri) merg în dreapta, restul în
 * stânga, fiecare parte în ordinea meniului. Fără alegere: prima jumătate (rotunjită în sus) în stânga. O alegere din
 * care nu mai există niciun item (id-uri vechi, de dinainte de o salvare a meniului) contează ca lipsă de alegere, ca
 * partea dreaptă să nu rămână goală; `[]` (ales explicit: nimic în dreapta) rămâne.
 */
export function splitNavItems<T extends { id: number }>(items: readonly T[], split: readonly number[] | null): { left: T[]; right: T[] } {
  if (split === null || (split.length > 0 && !items.some((i) => split.includes(i.id)))) {
    const half = Math.ceil(items.length / 2);
    return { left: items.slice(0, half), right: items.slice(half) };
  }
  const right = new Set(split);
  return { left: items.filter((i) => !right.has(i.id)), right: items.filter((i) => right.has(i.id)) };
}

/**
 * Jumătățile meniului pentru un aspect: împărțit doar când „Navigație (dreapta)” e pusă în antetul de desktop.
 * Se calculează din aspectul curent (și din draftul previzualizării live), nu doar din cel publicat.
 */
export function headerNavHalves<T extends { id: number }>(layout: GcsHeaderBuilder, items: readonly T[]): { left: T[]; right: T[] } {
  return placedHeaderElements(layout.desktop).includes("navRight") ? splitNavItems(items, layout.split) : { left: [...items], right: [] };
}

// ─── Consola de sub antet (Hero Cockpit) ────────────────────────────────────

/** Ce poate sta în fiecare din cele 3 panouri ale consolei. */
export const COCKPIT_PANELS = ["feed", "live", "top", "featured", "none"] as const;
export type GcsCockpitPanel = (typeof COCKPIT_PANELS)[number];
