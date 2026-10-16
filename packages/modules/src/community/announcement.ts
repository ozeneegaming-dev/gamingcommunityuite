import { isFooterHref } from "./footer";

/**
 * Bara de anunț subțire (macheta HomeComplete: „ANUNȚ · Cupa de toamnă… · Înscrie echipa”), a SISTEMULUI (orice temă):
 * deasupra conținutului, pe tot site-ul. Fiecare bară are eticheta (pastila), textul, un buton și un link opționale,
 * programarea (început / sfârșit), publicul (vizitatorii, grupurile), paginile (toate / prima pagină / forum), stilul
 * (accent / info / avertisment) și poate fi închisă (ținut minte per membru / vizitator, până la o versiune nouă).
 * Mai multe bare active se rotesc. Configurația stă în setarea `announcement.bars` (ACP → Aspect → Conținut → Bară de
 * anunț). Modul e pur: validarea, normalizarea și alegerea barelor vizibile.
 */
export const ANNOUNCEMENT_SETTING = "announcement.bars";
export const ANNOUNCEMENT_ACP_SECTION = "appearance.announcement_bar";
export const ANNOUNCEMENT_MAX_BARS = 6;
export const ANNOUNCEMENT_STYLES = ["accent", "info", "warning"] as const;
export const ANNOUNCEMENT_PAGES = ["all", "home", "forum"] as const;
export const ANNOUNCEMENT_ROTATE = { min: 3, max: 60 } as const;

export type GcsAnnouncementStyle = (typeof ANNOUNCEMENT_STYLES)[number];
export type GcsAnnouncementPages = (typeof ANNOUNCEMENT_PAGES)[number];
export type GcsAnnouncementLink = { label: string; href: string };
export type GcsAnnouncementBar = {
  /** Identificatorul barei (stabil la editare): cheia închiderii ținute minte. */
  id: string;
  enabled: boolean;
  /** Eticheta din pastilă (ex. „ANUNȚ”); goală = fără pastilă. */
  label: string;
  text: string;
  cta: GcsAnnouncementLink | null;
  link: GcsAnnouncementLink | null;
  style: GcsAnnouncementStyle;
  pages: GcsAnnouncementPages;
  /** Vizitatorii o văd; `groups` gol = toți membrii, altfel doar membrii din grupurile alese. */
  guests: boolean;
  members: boolean;
  groups: number[];
  /** Programarea (ISO 8601) sau `null` = fără limită. */
  startsAt: string | null;
  endsAt: string | null;
  dismissible: boolean;
  /** Crește la fiecare salvare a barei: o bară schimbată apare din nou și celor care o închiseseră. */
  version: number;
};
export type GcsAnnouncementConfig = { rotateSeconds: number; bars: GcsAnnouncementBar[] };

export const DEFAULT_ANNOUNCEMENT_CONFIG: GcsAnnouncementConfig = { rotateSeconds: 8, bars: [] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ID_RE = /^[a-z0-9]{1,16}$/;
const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

const textError = (v: unknown, max: number, required = false): string | null => {
  if (typeof v !== "string") return "invalid";
  if (required && v.trim() === "") return "required";
  if (v.length > max) return "too_long";
  return hasControl(v) ? "invalid" : null;
};

const linkError = (v: unknown): string | null => {
  if (v === null) return null;
  if (!isObj(v)) return "invalid";
  return textError(v.label, 40, true) ?? (isFooterHref(v.href) ? null : "invalid_url");
};

const dateError = (v: unknown): string | null => (v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v))) ? null : "invalid_date");

function barError(b: unknown): string | null {
  if (!isObj(b)) return "invalid";
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return "invalid";
  for (const k of ["enabled", "guests", "members", "dismissible"] as const) if (typeof b[k] !== "boolean") return "invalid";
  const e = textError(b.label, 20) ?? textError(b.text, 200, true) ?? linkError(b.cta) ?? linkError(b.link) ?? dateError(b.startsAt) ?? dateError(b.endsAt);
  if (e) return e;
  if (!(ANNOUNCEMENT_STYLES as readonly unknown[]).includes(b.style)) return "invalid_choice";
  if (!(ANNOUNCEMENT_PAGES as readonly unknown[]).includes(b.pages)) return "invalid_choice";
  if (!Array.isArray(b.groups) || b.groups.length > 50 || !b.groups.every((g) => Number.isInteger(g) && (g as number) > 0)) return "invalid";
  if (!Number.isInteger(b.version) || (b.version as number) < 1) return "invalid";
  if (typeof b.startsAt === "string" && typeof b.endsAt === "string" && Date.parse(b.endsAt) <= Date.parse(b.startsAt)) return "invalid_range";
  return null;
}

/** Codul erorii unei configurații (`null` = validă; `null` ca valoare = nicio bară). */
export function announcementConfigError(v: unknown): string | null {
  if (v === null) return null;
  if (!isObj(v) || !Array.isArray(v.bars)) return "invalid";
  if (!Number.isInteger(v.rotateSeconds) || (v.rotateSeconds as number) < ANNOUNCEMENT_ROTATE.min || (v.rotateSeconds as number) > ANNOUNCEMENT_ROTATE.max) return "invalid_range";
  if (v.bars.length > ANNOUNCEMENT_MAX_BARS) return "too_many";
  const ids = new Set<string>();
  for (const b of v.bars) {
    const e = barError(b);
    if (e) return e;
    const id = (b as GcsAnnouncementBar).id;
    if (ids.has(id)) return "duplicate";
    ids.add(id);
  }
  return null;
}

const trimLink = (l: GcsAnnouncementLink | null): GcsAnnouncementLink | null => (l ? { label: l.label.trim(), href: l.href } : null);

/**
 * O configurație validă, doar cu câmpurile cunoscute. `previous` = configurația salvată: o bară cu altceva decât înainte
 * primește versiunea următoare (închiderile vechi nu o mai ascund); o bară neschimbată își păstrează versiunea.
 */
export function normalizeAnnouncementConfig(c: GcsAnnouncementConfig, previous: GcsAnnouncementConfig | null = null): GcsAnnouncementConfig {
  const old = new Map((previous?.bars ?? []).map((b) => [b.id, b]));
  const content = (b: GcsAnnouncementBar) => JSON.stringify({ ...b, version: 0 });
  return {
    rotateSeconds: c.rotateSeconds,
    bars: c.bars.map((b) => {
      const bar: GcsAnnouncementBar = {
        id: b.id,
        enabled: b.enabled,
        label: b.label.trim(),
        text: b.text.trim(),
        cta: trimLink(b.cta),
        link: trimLink(b.link),
        style: b.style,
        pages: b.pages,
        guests: b.guests,
        members: b.members,
        groups: [...new Set(b.groups)].sort((x, y) => x - y),
        startsAt: b.startsAt ? new Date(b.startsAt).toISOString() : null,
        endsAt: b.endsAt ? new Date(b.endsAt).toISOString() : null,
        dismissible: b.dismissible,
        version: 1,
      };
      const prev = old.get(b.id);
      bar.version = !prev ? Math.max(1, b.version) : content(prev) === content(bar) ? prev.version : prev.version + 1;
      return bar;
    }),
  };
}

/** Pagina curentă, pentru filtrul „pagini”: prima pagină (`/`), forumul (`/forum`, forumurile, topicurile) sau alta. */
export function announcementPageKind(pathname: string): "home" | "forum" | "other" {
  if (pathname === "/") return "home";
  if (/^\/(forum|topic|tags)(\/|$)/.test(pathname)) return "forum";
  return "other";
}

/** Cine vede pagina: vizitatorul (fără cont) sau membrul cu grupurile lui. */
export type GcsAnnouncementViewer = { userId: string | null; groupIds: number[] };

/** Bara apare pe pagina asta (filtrul „pagini”; forumul include prima pagină, unde stă de obicei indexul lui). */
export function announcementOnPage(bar: Pick<GcsAnnouncementBar, "pages">, pathname: string): boolean {
  const kind = announcementPageKind(pathname);
  if (bar.pages === "home") return kind === "home";
  if (bar.pages === "forum") return kind === "forum" || kind === "home";
  return true;
}

/**
 * Barele de afișat acum pentru un vizitator / membru (în ordinea din ACP), pe o pagină. Fără pagină (`null`), toate
 * paginile: bara din layout filtrează în browser, la fiecare navigare (layout-ul nu se re-randează).
 */
export function visibleAnnouncementBars(config: GcsAnnouncementConfig | null, viewer: GcsAnnouncementViewer, pathname: string | null, now: Date = new Date()): GcsAnnouncementBar[] {
  if (!config) return [];
  const t = now.getTime();
  return config.bars.filter((b) => {
    if (!b.enabled) return false;
    if (b.startsAt && Date.parse(b.startsAt) > t) return false;
    if (b.endsAt && Date.parse(b.endsAt) <= t) return false;
    if (pathname !== null && !announcementOnPage(b, pathname)) return false;
    if (viewer.userId === null) return b.guests;
    if (!b.members) return false;
    return b.groups.length === 0 || b.groups.some((g) => viewer.groupIds.includes(g));
  });
}

