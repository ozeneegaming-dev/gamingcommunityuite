import { escapeHtml, isPlainData, toText } from "./values";

/**
 * Componentele platformei din șabloane (`{% avatar %}`, `{% username %}`, `{% time %}`, `{% icon %}`): produc exact
 * markup-ul componentelor React (`GcsAvatar`, `GcsUserLink`, `GcsRelTime`), ca un șablon pornit de la cel implicit să
 * arate la fel. Toate valorile sunt escapate; ieșirea trece oricum prin sanitizer.
 */
export type GcsTemplateComponents = {
  icon(name: string, opts: Record<string, unknown>): string;
  avatar(user: Record<string, unknown>, opts: Record<string, unknown>): string;
  username(user: Record<string, unknown>, opts: Record<string, unknown>): string;
  time(date: Date, opts: Record<string, unknown>): string;
};

/** Mărimile avatarelor (aceleași ca `GCS_AVATAR_SIZES` din `@gcs/ui`). */
export const TEMPLATE_AVATAR_SIZES: Record<string, number> = { xs: 24, s: 34, m: 40, l: 104, xl: 168 };
const AVATAR_BACKGROUNDS = ["#4B2A82", "#3F4652", "#7A5410", "#8A1E2B", "#1E4F7A", "#1F6B4F", "#5A2D6E", "#6B3A1E"];

/** Fundalul stabil al unui avatar fără imagine (același algoritm ca `GcsAvatar`). */
export function avatarBackground(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_BACKGROUNDS[hash % AVATAR_BACKGROUNDS.length]!;
}

const attr = (v: string) => escapeHtml(v);
const CLASS_RE = /^[A-Za-z0-9_ -]{0,120}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** O cale relativă de pe site sau un URL http(s); altfel `#`. */
const safeHref = (v: unknown) => {
  const s = toText(v);
  return (s.startsWith("/") && !s.startsWith("//")) || /^https?:\/\//i.test(s) ? s : "#";
};

export function avatarHtml(user: Record<string, unknown>, opts: Record<string, unknown>): string {
  const name = toText(user.name) || "?";
  const size = typeof opts.size === "string" && opts.size in TEMPLATE_AVATAR_SIZES ? opts.size : "m";
  const px = TEMPLATE_AVATAR_SIZES[size]!;
  const image = toText(user.image);
  const src = image && (image.startsWith("/") || /^https?:\/\//i.test(image)) ? image : "";
  const frame = typeof user.frameKey === "string" && KEY_RE.test(user.frameKey) ? user.frameKey : "";
  const extra = typeof opts.class === "string" && CLASS_RE.test(opts.class) ? opts.class.trim() : "";
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  const style = [frame ? "" : `width:${px}px;height:${px}px`, src ? "" : `background:${avatarBackground(name)}`, `font-size:${Math.max(10, Math.round(px * 0.4))}px`]
    .filter(Boolean)
    .join(";");
  const cls = ["gcs-avatar", `gcs-avatar--${size}`, !frame && extra].filter(Boolean).join(" ");
  const body = src
    ? `<img src="${attr(src)}" alt="${attr(name)}" class="gcs-avatar__img"/>`
    : `<span aria-hidden="true">${escapeHtml(initial)}</span><span class="gcs-srOnly">${escapeHtml(name)}</span>`;
  const inner = `<span class="${cls}" style="${style}">${body}</span>`;
  if (!frame) return inner;
  const frameCls = ["gcs-avatarFrame", `gcs-avatarFrame--${frame}`, extra].filter(Boolean).join(" ");
  return `<span class="${frameCls}" style="width:${px}px;height:${px}px">${inner}</span>`;
}

export function usernameHtml(user: Record<string, unknown>, opts: Record<string, unknown>): string {
  const name = toText(user.name);
  if (!name) return "";
  const nameKey = typeof user.nameKey === "string" && KEY_RE.test(user.nameKey) ? user.nameKey : "member";
  const extra = typeof opts.class === "string" && CLASS_RE.test(opts.class) ? ` ${opts.class.trim()}` : "";
  const id = toText(user.id);
  return `<a href="${attr(safeHref(user.url))}" class="gcs-userLink gcs-name--${nameKey}${extra}"${id ? ` data-user-id="${attr(id)}"` : ""}>${escapeHtml(name)}</a>`;
}

export function timeHtml(date: Date, relative: string, title: string): string {
  return `<time datetime="${date.toISOString()}" title="${attr(title)}">${escapeHtml(relative)}</time>`;
}

const SECOND = 1;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const WEEK = DAY * 7;
const MONTH = DAY * (365 / 12);
const YEAR = DAY * 365;
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", SECOND],
  ["minute", MINUTE],
  ["hour", HOUR],
  ["day", DAY],
  ["week", WEEK],
  ["month", MONTH],
  ["year", YEAR],
];

/** Data relativă („acum 5 minute”), cu aceeași alegere a unității ca formatorul site-ului. */
export function relativeTime(date: Date, now: Date, locale: string): string {
  const seconds = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(seconds);
  const limits = [MINUTE, HOUR, DAY, WEEK, MONTH, YEAR];
  const index = limits.findIndex((l) => abs < l);
  const [unit, size] = UNITS[index === -1 ? UNITS.length - 1 : index]!;
  return new Intl.RelativeTimeFormat(locale, { numeric: unit === "second" ? "auto" : "always" }).format(Math.round(seconds / size), unit);
}

/** Utilizatorul unei componente: un obiect cu cel puțin `name`. */
export const isTemplateUser = (v: unknown): v is Record<string, unknown> => isPlainData(v) && typeof v.name === "string";
