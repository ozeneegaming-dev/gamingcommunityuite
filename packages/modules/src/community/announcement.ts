import { isFooterHref } from "./footer";

/**
 * Bara de anunț v2 (a SISTEMULUI, în orice temă). Fiecare bară are conținutul (pastila, iconița, textul cu formatare
 * ușoară și variabile, textul scurt de pe telefon, butonul, linkul secundar, numărătoarea inversă), aspectul (presetul
 * sau fundalul ales: culoare, gradient, imagine cu strat închis; mărimea, alinierea, textul fix sau care derulează),
 * poziția (sus deasupra antetului, sub antet, în pagină, jos fixă; lipită la derulare; pe toată lățimea), publicul
 * (vizitatorii, membrii, grupurile incluse / excluse, membrii noi, dispozitivele, paginile, limba), programul (început /
 * sfârșit în fusul site-ului, zilele și intervalul orar) și comportamentul (închiderea, reapariția, rotația).
 * Configurația stă în setarea `announcement.bars` (ACP → Aspect → Conținut → Bară de anunț); cele salvate de prima
 * versiune se citesc cu `upgradeAnnouncementConfig` (bara rămâne în pagină, ca înainte). Modul e pur: validarea,
 * normalizarea, alegerea barelor vizibile, textul formatat și orele în fusul site-ului (rulează și în browser).
 */
export const ANNOUNCEMENT_SETTING = "announcement.bars";
export const ANNOUNCEMENT_ACP_SECTION = "appearance.announcement_bar";
export const ANNOUNCEMENT_MAX_BARS = 10;
export const ANNOUNCEMENT_ROTATE = { min: 3, max: 60 } as const;
export const ANNOUNCEMENT_PRESETS = ["forja", "accent", "info", "success", "warning", "danger", "subtle", "custom"] as const;
export const ANNOUNCEMENT_BG_KINDS = ["color", "gradient", "image"] as const;
export const ANNOUNCEMENT_SIZES = ["thin", "normal", "large"] as const;
export const ANNOUNCEMENT_ALIGNS = ["left", "center"] as const;
export const ANNOUNCEMENT_TEXT_MODES = ["static", "marquee"] as const;
export const ANNOUNCEMENT_PILL_STYLES = ["glass", "solid", "outline"] as const;
export const ANNOUNCEMENT_CTA_STYLES = ["white", "filled", "outline"] as const;
export const ANNOUNCEMENT_POSITIONS = ["top", "under", "page", "bottom"] as const;
export const ANNOUNCEMENT_DEVICES = ["all", "desktop", "mobile"] as const;
export const ANNOUNCEMENT_PAGES = ["all", "home", "forum", "paths"] as const;
export const ANNOUNCEMENT_COUNTDOWN_END = ["text", "hide"] as const;
export const ANNOUNCEMENT_MULTIPLE = ["rotate", "stack"] as const;
export const ANNOUNCEMENT_TRANSITIONS = ["fade", "slide", "none"] as const;
export const ANNOUNCEMENT_ORDERS = ["list", "random"] as const;
/** Variabilele din text: membrii online, jucătorii de pe servere, numele celui care citește. */
export const ANNOUNCEMENT_VARIABLES = ["membri_online", "jucatori_online", "numele_tau"] as const;
export const ANNOUNCEMENT_LIMITS = { label: 24, text: 300, mobileText: 140, link: 40, endText: 60, paths: 20, path: 120, groups: 50, locales: 10, days: 365 } as const;
/** Lățimea sub care bara e „pe telefon” (dispozitivele, textul scurt). */
export const ANNOUNCEMENT_MOBILE_MAX = 767;
/** Statisticile barelor (un hash în stocarea cheilor): `<bară>:view|click|dismiss|since`. */
export const ANNOUNCEMENT_STATS_KEY = "gcs:ann:stats";
export const ANNOUNCEMENT_EVENTS = ["view", "click", "dismiss"] as const;

export type GcsAnnouncementPreset = (typeof ANNOUNCEMENT_PRESETS)[number];
export type GcsAnnouncementPosition = (typeof ANNOUNCEMENT_POSITIONS)[number];
export type GcsAnnouncementPages = (typeof ANNOUNCEMENT_PAGES)[number];
export type GcsAnnouncementVariable = (typeof ANNOUNCEMENT_VARIABLES)[number];
export type GcsAnnouncementEvent = (typeof ANNOUNCEMENT_EVENTS)[number];
export type GcsAnnouncementLink = { label: string; href: string };
export type GcsAnnouncementCta = GcsAnnouncementLink & { style: (typeof ANNOUNCEMENT_CTA_STYLES)[number]; newTab: boolean };
/** Numărătoarea inversă: momentul (ISO) și ce face bara la final (arată `endText` sau se ascunde). */
export type GcsAnnouncementCountdown = { at: string; onEnd: (typeof ANNOUNCEMENT_COUNTDOWN_END)[number]; endText: string };

export type GcsAnnouncementBar = {
  /** Identificatorul barei (stabil la editare): cheia închiderii ținute minte și a statisticilor. */
  id: string;
  enabled: boolean;
  // ─── Conținutul
  /** Eticheta din pastilă (ex. „ANUNȚ”); goală = fără pastilă. */
  label: string;
  /** Iconița Font Awesome (`fa-solid fa-trophy`) sau `null`. */
  icon: string | null;
  /** Textul, cu `**gros**`, `*cursiv*`, `[link](/adresa)` și variabilele `{membri_online}`… */
  text: string;
  /** Textul mai scurt de pe telefon (gol = același text). */
  mobileText: string;
  cta: GcsAnnouncementCta | null;
  link: GcsAnnouncementLink | null;
  countdown: GcsAnnouncementCountdown | null;
  // ─── Aspectul
  preset: GcsAnnouncementPreset;
  /** Fundalul ales (doar la presetul `custom`): culoare, gradient (2 culori + unghi) sau imagine (cu strat închis). */
  bgKind: (typeof ANNOUNCEMENT_BG_KINDS)[number];
  bgColor: string;
  bgColor2: string;
  bgAngle: number;
  bgImage: string | null;
  fgColor: string;
  size: (typeof ANNOUNCEMENT_SIZES)[number];
  align: (typeof ANNOUNCEMENT_ALIGNS)[number];
  textMode: (typeof ANNOUNCEMENT_TEXT_MODES)[number];
  pillStyle: (typeof ANNOUNCEMENT_PILL_STYLES)[number];
  // ─── Poziția
  position: GcsAnnouncementPosition;
  /** Rămâne lipită sus la derulare (pozițiile „sus” și „sub antet”). */
  sticky: boolean;
  /** Pe toată lățimea ecranului; altfel cât pagina. */
  fullWidth: boolean;
  // ─── Cine o vede
  guests: boolean;
  members: boolean;
  /** Doar membrii din aceste grupuri (gol = toți); niciodată cei din `excludeGroups`. */
  groups: number[];
  excludeGroups: number[];
  /** Doar membrii înregistrați în ultimele N zile (0 = toți). */
  newMembersDays: number;
  devices: (typeof ANNOUNCEMENT_DEVICES)[number];
  pages: GcsAnnouncementPages;
  /** Adresele alese (`pages: "paths"`) și cele excluse (oricare ar fi `pages`); `*` = orice. */
  paths: string[];
  excludePaths: string[];
  /** Limbile site-ului (gol = toate). */
  locales: string[];
  // ─── Programul (momentele ISO; zilele și orele în fusul site-ului)
  startsAt: string | null;
  endsAt: string | null;
  /** Zilele săptămânii (1 = luni … 7 = duminică; gol = toate). */
  days: number[];
  /** Intervalul zilnic `HH:MM` (ambele sau niciunul; peste miezul nopții e permis). */
  timeFrom: string | null;
  timeTo: string | null;
  // ─── Comportamentul
  dismissible: boolean;
  /** Click-ul pe buton o închide și el (ținut minte la fel ca închiderea). */
  closeOnCta: boolean;
  /** După închidere reapare peste N zile (0 = doar când bara se schimbă). */
  reappearDays: number;
  /** Cât stă pe ecran în rotație (`null` = valoarea generală). */
  rotateSeconds: number | null;
  /** Crește la fiecare schimbare a barei: o bară schimbată apare din nou și celor care o închiseseră. */
  version: number;
};

export type GcsAnnouncementConfig = {
  /** Cât stă o bară pe ecran în rotație (implicit). */
  rotateSeconds: number;
  /** Mai multe bare active în același loc: se rotesc sau stau una sub alta. */
  multiple: (typeof ANNOUNCEMENT_MULTIPLE)[number];
  transition: (typeof ANNOUNCEMENT_TRANSITIONS)[number];
  order: (typeof ANNOUNCEMENT_ORDERS)[number];
  pauseOnHover: boolean;
  dots: boolean;
  /** Numără afișările, click-urile și închiderile. */
  stats: boolean;
  bars: GcsAnnouncementBar[];
};

export const DEFAULT_ANNOUNCEMENT_CONFIG: GcsAnnouncementConfig = { rotateSeconds: 8, multiple: "rotate", transition: "fade", order: "list", pauseOnHover: true, dots: true, stats: true, bars: [] };

/** O bară nouă din ACP: sus, deasupra antetului, pe toată lățimea, cu presetul Forja. */
export function announcementBarDefaults(id: string): GcsAnnouncementBar {
  return {
    id,
    enabled: true,
    label: "",
    icon: null,
    text: "",
    mobileText: "",
    cta: null,
    link: null,
    countdown: null,
    preset: "forja",
    bgKind: "gradient",
    bgColor: "#6d28d9",
    bgColor2: "#db2777",
    bgAngle: 110,
    bgImage: null,
    fgColor: "#ffffff",
    size: "normal",
    align: "left",
    textMode: "static",
    pillStyle: "glass",
    position: "top",
    sticky: false,
    fullWidth: true,
    guests: true,
    members: true,
    groups: [],
    excludeGroups: [],
    newMembersDays: 0,
    devices: "all",
    pages: "all",
    paths: [],
    excludePaths: [],
    locales: [],
    startsAt: null,
    endsAt: null,
    days: [],
    timeFrom: null,
    timeTo: null,
    dismissible: true,
    closeOnCta: false,
    reappearDays: 0,
    rotateSeconds: null,
    version: 1,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = <T extends readonly unknown[]>(list: T, v: unknown): v is T[number] => list.includes(v);
const fill = <T>(v: unknown, d: T): unknown => (v === undefined ? d : v);
const isInternal = (href: string) => href.startsWith("/") && !href.startsWith("//");

/** Stilurile primei versiuni → presetul de acum. */
const LEGACY_STYLES: Record<string, GcsAnnouncementPreset> = { accent: "accent", info: "info", warning: "warning" };

/**
 * O bară salvată (de orice versiune) în forma de acum: câmpurile lipsă primesc valorile care păstrează comportamentul de
 * dinainte (în pagină, cât pagina, fără reapariție); valorile existente rămân neatinse (validarea le verifică).
 */
function upgradeBar(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const d = announcementBarDefaults(typeof raw.id === "string" ? raw.id : "");
  const legacyPreset = typeof raw.style === "string" ? (LEGACY_STYLES[raw.style] ?? "accent") : d.preset;
  const cta = isObj(raw.cta)
    ? { label: raw.cta.label, href: raw.cta.href, style: fill(raw.cta.style, "filled"), newTab: fill(raw.cta.newTab, typeof raw.cta.href === "string" && !isInternal(raw.cta.href)) }
    : raw.cta;
  const legacy = raw.position === undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(d) as (keyof GcsAnnouncementBar)[]) out[key] = fill(raw[key], d[key]);
  out.cta = fill(cta, null);
  if (legacy) {
    out.position = "page";
    out.fullWidth = false;
    out.preset = fill(raw.preset, legacyPreset);
    out.pillStyle = fill(raw.pillStyle, "solid");
  }
  return out;
}

/** Configurația salvată (prima versiune sau cea de acum) în forma de acum; altceva decât un obiect cu bare → `null`. */
export function upgradeAnnouncementConfig(raw: unknown): unknown {
  if (raw === null || !isObj(raw) || !Array.isArray(raw.bars)) return raw;
  const d = DEFAULT_ANNOUNCEMENT_CONFIG;
  return {
    rotateSeconds: fill(raw.rotateSeconds, d.rotateSeconds),
    multiple: fill(raw.multiple, d.multiple),
    transition: fill(raw.transition, d.transition),
    order: fill(raw.order, d.order),
    pauseOnHover: fill(raw.pauseOnHover, d.pauseOnHover),
    dots: fill(raw.dots, d.dots),
    stats: fill(raw.stats, d.stats),
    bars: raw.bars.map(upgradeBar),
  };
}

// ─── Validarea ─────────────────────────────────────────────────────────────────────────────────────────

const ID_RE = /^[a-z0-9]{1,16}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ICON_RE = /^fa-(solid|regular|brands) fa-[a-z0-9-]{1,60}$/;
/** Imaginea de fundal: un fișier încărcat pe site (`/files/<id>`). */
const IMAGE_RE = /^\/files\/[A-Za-z0-9_-]{1,64}$/;
const PATH_RE = /^\/[A-Za-z0-9/_.~%*-]{0,119}$/;
const LOCALE_RE = /^[a-z]{2}$/;
const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** O problemă a configurației: câmpul (`bars.2.text`, `rotateSeconds`) și codul erorii. */
export type GcsAnnouncementIssue = { path: string; code: string };
export type GcsAnnouncementCheckOptions = { isIcon?: (name: string) => boolean };

const textError = (v: unknown, max: number, required = false): string | null => {
  if (typeof v !== "string") return "invalid";
  if (required && v.trim() === "") return "required";
  if (v.length > max) return "too_long";
  return hasControl(v) ? "invalid" : null;
};
const dateError = (v: unknown): string | null => (v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v))) ? null : "invalid_date");
const intIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const idList = (v: unknown) => Array.isArray(v) && v.length <= ANNOUNCEMENT_LIMITS.groups && v.every((g) => Number.isInteger(g) && (g as number) > 0);
const pathList = (v: unknown) => Array.isArray(v) && v.length <= ANNOUNCEMENT_LIMITS.paths && v.every((p) => typeof p === "string" && PATH_RE.test(p));

function linkError(v: unknown, withStyle: boolean): { field: string; code: string } | null {
  if (v === null) return null;
  if (!isObj(v)) return { field: "", code: "invalid" };
  const label = textError(v.label, ANNOUNCEMENT_LIMITS.link, true);
  if (label) return { field: "label", code: label };
  if (!isFooterHref(v.href)) return { field: "href", code: "invalid_url" };
  if (withStyle && (!oneOf(ANNOUNCEMENT_CTA_STYLES, v.style) || typeof v.newTab !== "boolean")) return { field: "style", code: "invalid_choice" };
  return null;
}

function barIssue(b: unknown, opts: GcsAnnouncementCheckOptions): GcsAnnouncementIssue | null {
  const at = (path: string, code: string | null): GcsAnnouncementIssue | null => (code ? { path, code } : null);
  if (!isObj(b)) return at("", "invalid");
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return at("id", "invalid");
  for (const k of ["enabled", "guests", "members", "dismissible", "closeOnCta", "sticky", "fullWidth"] as const) if (typeof b[k] !== "boolean") return at(k, "invalid");
  const icon = b.icon === null || (typeof b.icon === "string" && ICON_RE.test(b.icon) && (opts.isIcon?.(b.icon) ?? true)) ? null : "invalid_icon";
  const simple =
    at("label", textError(b.label, ANNOUNCEMENT_LIMITS.label)) ??
    at("icon", icon) ??
    at("text", textError(b.text, ANNOUNCEMENT_LIMITS.text, true)) ??
    at("mobileText", textError(b.mobileText, ANNOUNCEMENT_LIMITS.mobileText));
  if (simple) return simple;
  const cta = linkError(b.cta, true);
  if (cta) return at(cta.field ? `cta.${cta.field}` : "cta", cta.code);
  const link = linkError(b.link, false);
  if (link) return at(link.field ? `link.${link.field}` : "link", link.code);
  if (b.countdown !== null) {
    const c = b.countdown;
    if (!isObj(c)) return at("countdown", "invalid");
    if (typeof c.at !== "string" || Number.isNaN(Date.parse(c.at))) return at("countdown.at", "invalid_date");
    if (!oneOf(ANNOUNCEMENT_COUNTDOWN_END, c.onEnd)) return at("countdown.onEnd", "invalid_choice");
    const end = textError(c.endText, ANNOUNCEMENT_LIMITS.endText, c.onEnd === "text");
    if (end) return at("countdown.endText", end);
  }
  const choices = [
    ["preset", ANNOUNCEMENT_PRESETS],
    ["bgKind", ANNOUNCEMENT_BG_KINDS],
    ["size", ANNOUNCEMENT_SIZES],
    ["align", ANNOUNCEMENT_ALIGNS],
    ["textMode", ANNOUNCEMENT_TEXT_MODES],
    ["pillStyle", ANNOUNCEMENT_PILL_STYLES],
    ["position", ANNOUNCEMENT_POSITIONS],
    ["devices", ANNOUNCEMENT_DEVICES],
    ["pages", ANNOUNCEMENT_PAGES],
  ] as const;
  for (const [k, list] of choices) if (!oneOf(list, b[k])) return at(k, "invalid_choice");
  for (const k of ["bgColor", "bgColor2", "fgColor"] as const) {
    const color = b[k];
    if (typeof color !== "string" || !HEX_RE.test(color)) return at(k, "invalid_color");
  }
  if (!intIn(b.bgAngle, 0, 360)) return at("bgAngle", "invalid_range");
  if (b.bgImage !== null && (typeof b.bgImage !== "string" || !IMAGE_RE.test(b.bgImage))) return at("bgImage", "invalid_image");
  if (b.preset === "custom" && b.bgKind === "image" && b.bgImage === null) return at("bgImage", "required");
  if (!idList(b.groups)) return at("groups", "invalid");
  if (!idList(b.excludeGroups)) return at("excludeGroups", "invalid");
  if (!intIn(b.newMembersDays, 0, ANNOUNCEMENT_LIMITS.days)) return at("newMembersDays", "invalid_range");
  if (!pathList(b.paths)) return at("paths", "invalid_path");
  if (!pathList(b.excludePaths)) return at("excludePaths", "invalid_path");
  if (b.pages === "paths" && (b.paths as string[]).length === 0) return at("paths", "required");
  if (!Array.isArray(b.locales) || b.locales.length > ANNOUNCEMENT_LIMITS.locales || !b.locales.every((l) => typeof l === "string" && LOCALE_RE.test(l))) return at("locales", "invalid_choice");
  const dates = at("startsAt", dateError(b.startsAt)) ?? at("endsAt", dateError(b.endsAt));
  if (dates) return dates;
  if (typeof b.startsAt === "string" && typeof b.endsAt === "string" && Date.parse(b.endsAt) <= Date.parse(b.startsAt)) return at("endsAt", "invalid_range");
  if (!Array.isArray(b.days) || b.days.length > 7 || !b.days.every((d) => intIn(d, 1, 7))) return at("days", "invalid");
  for (const k of ["timeFrom", "timeTo"] as const) {
    const time = b[k];
    if (time !== null && (typeof time !== "string" || !HHMM_RE.test(time))) return at(k, "invalid_value");
  }
  if ((b.timeFrom === null) !== (b.timeTo === null)) return at(b.timeFrom === null ? "timeFrom" : "timeTo", "required");
  if (typeof b.timeFrom === "string" && b.timeFrom === b.timeTo) return at("timeTo", "invalid_range");
  if (!intIn(b.reappearDays, 0, ANNOUNCEMENT_LIMITS.days)) return at("reappearDays", "invalid_range");
  if (b.rotateSeconds !== null && !intIn(b.rotateSeconds, ANNOUNCEMENT_ROTATE.min, ANNOUNCEMENT_ROTATE.max)) return at("rotateSeconds", "invalid_range");
  if (!Number.isInteger(b.version) || (b.version as number) < 1) return at("version", "invalid");
  return null;
}

/** Prima problemă a unei configurații (`null` = validă; `null` ca valoare = nicio bară). */
export function announcementConfigIssue(v: unknown, opts: GcsAnnouncementCheckOptions = {}): GcsAnnouncementIssue | null {
  if (v === null) return null;
  if (!isObj(v) || !Array.isArray(v.bars)) return { path: "", code: "invalid" };
  if (!intIn(v.rotateSeconds, ANNOUNCEMENT_ROTATE.min, ANNOUNCEMENT_ROTATE.max)) return { path: "rotateSeconds", code: "invalid_range" };
  if (!oneOf(ANNOUNCEMENT_MULTIPLE, v.multiple)) return { path: "multiple", code: "invalid_choice" };
  if (!oneOf(ANNOUNCEMENT_TRANSITIONS, v.transition)) return { path: "transition", code: "invalid_choice" };
  if (!oneOf(ANNOUNCEMENT_ORDERS, v.order)) return { path: "order", code: "invalid_choice" };
  for (const k of ["pauseOnHover", "dots", "stats"] as const) if (typeof v[k] !== "boolean") return { path: k, code: "invalid" };
  if (v.bars.length > ANNOUNCEMENT_MAX_BARS) return { path: "bars", code: "too_many" };
  const ids = new Set<string>();
  for (const [i, b] of v.bars.entries()) {
    const issue = barIssue(b, opts);
    if (issue) return { path: issue.path ? `bars.${i}.${issue.path}` : `bars.${i}`, code: issue.code };
    const id = (b as GcsAnnouncementBar).id;
    if (ids.has(id)) return { path: `bars.${i}.id`, code: "duplicate" };
    ids.add(id);
  }
  return null;
}

/** Codul erorii unei configurații (`null` = validă). */
export function announcementConfigError(v: unknown, opts: GcsAnnouncementCheckOptions = {}): string | null {
  return announcementConfigIssue(v, opts)?.code ?? null;
}

/** Configurația salvată, citită robust: orice versiune, iar o valoare stricată → configurația goală. */
export function readAnnouncementConfig(raw: unknown): GcsAnnouncementConfig {
  const upgraded = upgradeAnnouncementConfig(raw);
  return upgraded && announcementConfigError(upgraded) === null ? (upgraded as GcsAnnouncementConfig) : DEFAULT_ANNOUNCEMENT_CONFIG;
}

// ─── Normalizarea ──────────────────────────────────────────────────────────────────────────────────────

const uniqSorted = (list: number[]) => [...new Set(list)].sort((x, y) => x - y);
const cleanPaths = (list: string[]) => [...new Set(list.map((p) => (p.length > 1 ? p.replace(/\/+$/, "") || "/" : p)))];
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

/** Ce contează pentru versiune: tot, în afară de pornit / oprit și versiunea însăși. */
const content = (b: GcsAnnouncementBar) => JSON.stringify({ ...b, enabled: false, version: 0 });

/**
 * O configurație validă, doar cu câmpurile cunoscute. `previous` = configurația salvată: o bară cu altceva decât înainte
 * primește versiunea următoare (închiderile vechi nu o mai ascund); o bară neschimbată (sau doar pornită / oprită) își
 * păstrează versiunea.
 */
export function normalizeAnnouncementConfig(c: GcsAnnouncementConfig, previous: GcsAnnouncementConfig | null = null): GcsAnnouncementConfig {
  const old = new Map((previous?.bars ?? []).map((b) => [b.id, b]));
  return {
    rotateSeconds: c.rotateSeconds,
    multiple: c.multiple,
    transition: c.transition,
    order: c.order,
    pauseOnHover: c.pauseOnHover,
    dots: c.dots,
    stats: c.stats,
    bars: c.bars.map((b) => {
      const custom = b.preset === "custom";
      const bar: GcsAnnouncementBar = {
        id: b.id,
        enabled: b.enabled,
        label: b.label.trim(),
        icon: b.icon,
        text: b.text.trim(),
        mobileText: b.mobileText.trim(),
        cta: b.cta ? { label: b.cta.label.trim(), href: b.cta.href, style: b.cta.style, newTab: b.cta.newTab } : null,
        link: b.link ? { label: b.link.label.trim(), href: b.link.href } : null,
        countdown: b.countdown ? { at: new Date(b.countdown.at).toISOString(), onEnd: b.countdown.onEnd, endText: b.countdown.endText.trim() } : null,
        preset: b.preset,
        bgKind: b.bgKind,
        bgColor: b.bgColor.toLowerCase(),
        bgColor2: b.bgColor2.toLowerCase(),
        bgAngle: b.bgAngle,
        // Imaginea rămâne doar la fundalul „imagine” al presetului personalizat.
        bgImage: custom && b.bgKind === "image" ? b.bgImage : null,
        fgColor: b.fgColor.toLowerCase(),
        size: b.size,
        align: b.align,
        textMode: b.textMode,
        pillStyle: b.pillStyle,
        position: b.position,
        sticky: b.sticky && (b.position === "top" || b.position === "under"),
        fullWidth: b.fullWidth,
        guests: b.guests,
        members: b.members,
        groups: uniqSorted(b.groups),
        excludeGroups: uniqSorted(b.excludeGroups),
        newMembersDays: b.newMembersDays,
        devices: b.devices,
        pages: b.pages,
        paths: b.pages === "paths" ? cleanPaths(b.paths) : [],
        excludePaths: cleanPaths(b.excludePaths),
        locales: [...new Set(b.locales)].sort(),
        startsAt: iso(b.startsAt),
        endsAt: iso(b.endsAt),
        // Toate cele 7 zile = fără filtru de zile.
        days: uniqSorted(b.days).length === 7 ? [] : uniqSorted(b.days),
        timeFrom: b.timeFrom,
        timeTo: b.timeTo,
        dismissible: b.dismissible,
        closeOnCta: b.closeOnCta,
        reappearDays: b.reappearDays,
        rotateSeconds: b.rotateSeconds,
        version: 1,
      };
      const prev = old.get(b.id);
      bar.version = !prev ? Math.max(1, b.version) : content(prev) === content(bar) ? prev.version : prev.version + 1;
      return bar;
    }),
  };
}

// ─── Ora site-ului ─────────────────────────────────────────────────────────────────────────────────────

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Data și ora unui moment în fusul dat (un fus invalid → UTC). */
function zoned(at: number, timeZone: string) {
  const parts = (tz: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
  let list: Intl.DateTimeFormatPart[];
  try {
    list = parts(timeZone);
  } catch {
    list = parts("UTC");
  }
  const get = (type: string) => list.find((p) => p.type === type)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: WEEKDAYS[get("weekday")] ?? 1 };
}

/** Ziua săptămânii (1 = luni) și minutul zilei, în fusul site-ului. */
export function announcementZonedClock(at: Date, timeZone: string): { weekday: number; minutes: number } {
  const z = zoned(at.getTime(), timeZone);
  return { weekday: z.weekday, minutes: z.hour * 60 + z.minute };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Momentul ISO → valoarea unui câmp `datetime-local`, în ora site-ului (nu a calculatorului adminului). */
export function announcementZonedInput(value: string | null, timeZone: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  const z = zoned(Date.parse(value), timeZone);
  return `${z.year}-${pad(z.month)}-${pad(z.day)}T${pad(z.hour)}:${pad(z.minute)}`;
}

/** Valoarea unui câmp `datetime-local` (ora site-ului) → momentul ISO, cu trecerile la ora de vară; gol → `null`. */
export function announcementFromZonedInput(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const offset = (ms: number) => {
    const z = zoned(ms, timeZone);
    return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute) - Math.floor(ms / 60_000) * 60_000;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first)).toISOString();
}

// ─── Cine o vede, unde și când ────────────────────────────────────────────────────────────────────────

/** Pagina curentă, pentru filtrul „pagini”: prima pagină (`/`), forumul (`/forum`, forumurile, topicurile) sau alta. */
export function announcementPageKind(pathname: string): "home" | "forum" | "other" {
  if (pathname === "/") return "home";
  if (/^\/(forum|topic|tags)(\/|$)/.test(pathname)) return "forum";
  return "other";
}

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** O adresă aleasă în ACP se potrivește cu pagina: `*` = orice; `/clanuri/*` cuprinde și `/clanuri`. */
export function announcementPathMatch(pattern: string, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  const base = pattern.length > 1 ? pattern.replace(/\/+$/, "") || "/" : pattern;
  if (base.endsWith("/*") && path === (base.slice(0, -2) || "/")) return true;
  return new RegExp(`^${base.split("*").map(escapeRe).join(".*")}$`).test(path);
}

/** Bara apare pe pagina asta (filtrul „pagini”; forumul include prima pagină, unde stă de obicei indexul lui). */
export function announcementOnPage(bar: Pick<GcsAnnouncementBar, "pages" | "paths" | "excludePaths">, pathname: string): boolean {
  if (bar.excludePaths.some((p) => announcementPathMatch(p, pathname))) return false;
  const kind = announcementPageKind(pathname);
  if (bar.pages === "home") return kind === "home";
  if (bar.pages === "forum") return kind === "forum" || kind === "home";
  if (bar.pages === "paths") return bar.paths.some((p) => announcementPathMatch(p, pathname));
  return true;
}

/** Cine vede pagina: vizitatorul (fără cont) sau membrul cu grupurile, data înregistrării și limba lui. */
export type GcsAnnouncementViewer = { userId: string | null; groupIds: number[]; joinedAt?: Date | string | null; locale?: string | null };

const DAY_MS = 86_400_000;

/** Publicul: vizitatorii / membrii, grupurile incluse și excluse, membrii noi, limba site-ului. */
export function announcementAudienceOk(bar: GcsAnnouncementBar, viewer: GcsAnnouncementViewer, now: Date = new Date()): boolean {
  if (bar.locales.length > 0 && viewer.locale && !bar.locales.includes(viewer.locale)) return false;
  if (viewer.userId === null) return bar.guests;
  if (!bar.members) return false;
  if (bar.excludeGroups.some((g) => viewer.groupIds.includes(g))) return false;
  if (bar.groups.length > 0 && !bar.groups.some((g) => viewer.groupIds.includes(g))) return false;
  if (bar.newMembersDays > 0) {
    const joined = viewer.joinedAt instanceof Date ? viewer.joinedAt.getTime() : typeof viewer.joinedAt === "string" ? Date.parse(viewer.joinedAt) : Number.NaN;
    if (!Number.isFinite(joined) || now.getTime() - joined > bar.newMembersDays * DAY_MS) return false;
  }
  return true;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Numărătoarea s-a terminat. */
export const announcementCountdownOver = (bar: Pick<GcsAnnouncementBar, "countdown">, now: Date) => !!bar.countdown && Date.parse(bar.countdown.at) <= now.getTime();

/**
 * Programul: începutul și sfârșitul (momente), zilele și intervalul orar în fusul site-ului (un interval ca 22:00–02:00
 * trece de miezul nopții), iar bara cu numărătoarea „se ascunde la final” dispare când aceasta se termină.
 */
export function announcementScheduleOk(bar: GcsAnnouncementBar, now: Date, timeZone: string): boolean {
  const t = now.getTime();
  if (bar.startsAt && Date.parse(bar.startsAt) > t) return false;
  if (bar.endsAt && Date.parse(bar.endsAt) <= t) return false;
  if (bar.countdown?.onEnd === "hide" && announcementCountdownOver(bar, now)) return false;
  if (bar.days.length === 0 && !bar.timeFrom) return true;
  const clock = announcementZonedClock(now, timeZone);
  if (bar.days.length > 0 && !bar.days.includes(clock.weekday)) return false;
  if (bar.timeFrom && bar.timeTo) {
    const from = minutesOf(bar.timeFrom);
    const to = minutesOf(bar.timeTo);
    const m = clock.minutes;
    if (from < to ? m < from || m > to : m < from && m > to) return false;
  }
  return true;
}

/**
 * Barele de afișat acum pentru un vizitator / membru (în ordinea din ACP), pe o pagină. Fără pagină (`null`), toate
 * paginile. Zilele și orele se socotesc în fusul site-ului.
 */
export function visibleAnnouncementBars(config: GcsAnnouncementConfig | null, viewer: GcsAnnouncementViewer, pathname: string | null, now: Date = new Date(), timeZone = "UTC"): GcsAnnouncementBar[] {
  if (!config) return [];
  return config.bars.filter((b) => b.enabled && announcementScheduleOk(b, now, timeZone) && (pathname === null || announcementOnPage(b, pathname)) && announcementAudienceOk(b, viewer, now));
}

/**
 * Barele trimise în pagină (layout-ul nu se re-randează la navigare, deci browserul filtrează paginile, zilele, orele și
 * finalul numărătorii): pornite, pentru acest public, neterminate și care încep în cel mult `horizonMs`.
 */
export function announcementPageBars(config: GcsAnnouncementConfig, viewer: GcsAnnouncementViewer, now: Date = new Date(), horizonMs = 12 * 3_600_000): GcsAnnouncementBar[] {
  const t = now.getTime();
  return config.bars.filter((b) => {
    if (!b.enabled || !announcementAudienceOk(b, viewer, now)) return false;
    if (b.endsAt && Date.parse(b.endsAt) <= t) return false;
    if (b.startsAt && Date.parse(b.startsAt) > t + horizonMs) return false;
    return !(b.countdown?.onEnd === "hide" && announcementCountdownOver(b, now));
  });
}

/** Starea din lista ACP: activă, programată (începe mai târziu), expirată (s-a terminat) sau oprită. */
export function announcementStatus(bar: GcsAnnouncementBar, now: Date = new Date()): "active" | "scheduled" | "expired" | "off" {
  if (!bar.enabled) return "off";
  const t = now.getTime();
  if ((bar.endsAt && Date.parse(bar.endsAt) <= t) || (bar.countdown?.onEnd === "hide" && announcementCountdownOver(bar, now))) return "expired";
  if (bar.startsAt && Date.parse(bar.startsAt) > t) return "scheduled";
  return "active";
}

// ─── Închiderile ținute minte (cookie-ul `gcs-ann`) ───────────────────────────────────────────────────

/** Ziua (de la 1970, UTC) unei închideri: reapariția după N zile. */
export const announcementDay = (now: Date = new Date()) => Math.floor(now.getTime() / DAY_MS);

/** Intrările cookie-ului (`<cine>~<bară>~<versiune>[~<zi>]`, despărțite de `|`) ale acestui membru / vizitator. */
export function parseAnnouncementDismissals(cookie: string | undefined, viewerKey: string): Map<string, { version: number; day: number | null }> {
  const out = new Map<string, { version: number; day: number | null }>();
  let raw = cookie ?? "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Valoare stricată: nimic închis.
  }
  for (const entry of raw.split("|")) {
    const [who, id, version, day] = entry.split("~");
    if (who !== viewerKey || !id || !version || !Number.isInteger(Number(version))) continue;
    out.set(id, { version: Number(version), day: day && Number.isInteger(Number(day)) ? Number(day) : null });
  }
  return out;
}

/** Bara e închisă pentru acest membru / vizitator: aceeași versiune și (cu reapariția) mai puțin de N zile în urmă. */
export function announcementDismissed(dismissals: Map<string, { version: number; day: number | null }>, bar: GcsAnnouncementBar, now: Date = new Date()): boolean {
  if (!bar.dismissible && !bar.closeOnCta) return false;
  const d = dismissals.get(bar.id);
  if (!d || d.version !== bar.version) return false;
  if (bar.reappearDays === 0 || d.day === null) return true;
  return announcementDay(now) - d.day < bar.reappearDays;
}

// ─── Textul ────────────────────────────────────────────────────────────────────────────────────────────

/** Textul formatat al barei: text, variabile, gros, cursiv și linkuri (fără HTML). */
export type GcsAnnouncementNode =
  | { t: "text"; v: string }
  | { t: "var"; name: GcsAnnouncementVariable }
  | { t: "b" | "i"; c: GcsAnnouncementNode[] }
  | { t: "a"; href: string; c: GcsAnnouncementNode[] };

const WORD = /[\p{L}\p{N}]/u;
const VAR_RE = /^\{([a-z_]{2,30})\}/;

function parseNodes(s: string, allow: { b: boolean; i: boolean; a: boolean }): GcsAnnouncementNode[] {
  const out: GcsAnnouncementNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const next = s[i + 1];
    if (ch === "\\" && next !== undefined && "*_[](){}\\".includes(next)) {
      buf += next;
      i += 2;
      continue;
    }
    if (ch === "{") {
      const m = VAR_RE.exec(s.slice(i));
      if (m) {
        flush();
        const name = m[1];
        // O variabilă necunoscută dispare din text.
        if (oneOf(ANNOUNCEMENT_VARIABLES, name)) out.push({ t: "var", name });
        i += m[0].length;
        continue;
      }
    }
    if (allow.b && ch === "*" && next === "*") {
      const end = s.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "b", c: parseNodes(s.slice(i + 2, end), { ...allow, b: false }) });
        i = end + 2;
        continue;
      }
    }
    if (allow.i && (ch === "*" || ch === "_") && next !== undefined && next !== ch && next !== " " && (i === 0 || !WORD.test(s[i - 1]!))) {
      let end = s.indexOf(ch, i + 1);
      while (end > 0 && s[end + 1] !== undefined && WORD.test(s[end + 1]!)) end = s.indexOf(ch, end + 1);
      if (end > i + 1 && s[end - 1] !== " ") {
        flush();
        out.push({ t: "i", c: parseNodes(s.slice(i + 1, end), { ...allow, i: false }) });
        i = end + 1;
        continue;
      }
    }
    if (allow.a && ch === "[") {
      const close = s.indexOf("](", i + 1);
      const end = close > 0 ? s.indexOf(")", close + 2) : -1;
      if (close > i + 1 && end > close + 2) {
        flush();
        const label = parseNodes(s.slice(i + 1, close), { ...allow, a: false });
        const href = s.slice(close + 2, end).trim();
        // O adresă nesigură (`javascript:` …) lasă doar textul linkului.
        if (isFooterHref(href)) out.push({ t: "a", href, c: label });
        else out.push(...label);
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Textul barei → nodurile de randat (`**gros**`, `*cursiv*` / `_cursiv_`, `[text](/adresa)`, `{variabila}`, `\*`). */
export function parseAnnouncementText(src: string): GcsAnnouncementNode[] {
  return parseNodes(src, { b: true, i: true, a: true });
}

/** Valorile variabilelor (cele lipsă = text gol). */
export type GcsAnnouncementVars = Partial<Record<GcsAnnouncementVariable, string>>;

/** Textul simplu al nodurilor (cititoarele de ecran, miniaturile din ACP, durata derulării). */
export function announcementPlainText(nodes: GcsAnnouncementNode[], vars: GcsAnnouncementVars = {}): string {
  return nodes.map((n) => (n.t === "text" ? n.v : n.t === "var" ? (vars[n.name] ?? "") : announcementPlainText(n.c, vars))).join("");
}

/** Variabilele folosite de bare (serverul calculează doar ce trebuie). */
export function announcementUsedVariables(bars: GcsAnnouncementBar[]): Set<GcsAnnouncementVariable> {
  const out = new Set<GcsAnnouncementVariable>();
  const walk = (nodes: GcsAnnouncementNode[]) => {
    for (const n of nodes) {
      if (n.t === "var") out.add(n.name);
      else if (n.t !== "text") walk(n.c);
    }
  };
  for (const b of bars) {
    walk(parseAnnouncementText(b.text));
    walk(parseAnnouncementText(b.mobileText));
  }
  return out;
}

// ─── Statisticile ──────────────────────────────────────────────────────────────────────────────────────

export type GcsAnnouncementStats = { views: number; clicks: number; dismissals: number; since: string | null };
export const EMPTY_ANNOUNCEMENT_STATS: GcsAnnouncementStats = { views: 0, clicks: 0, dismissals: 0, since: null };

/** Câmpul din hash-ul statisticilor pentru o bară și un eveniment. */
export const announcementStatsField = (barId: string, event: GcsAnnouncementEvent | "since") => `${barId}:${event}`;

/** Hash-ul statisticilor → cifrele fiecărei bare. */
export function announcementStatsFrom(hash: Record<string, string>, ids: string[]): Record<string, GcsAnnouncementStats> {
  const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        views: num(hash[announcementStatsField(id, "view")]),
        clicks: num(hash[announcementStatsField(id, "click")]),
        dismissals: num(hash[announcementStatsField(id, "dismiss")]),
        since: hash[announcementStatsField(id, "since")] ?? null,
      },
    ]),
  );
}
