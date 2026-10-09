/**
 * Subsolul site-ului, configurat în ACP → Aspect → Subsol (specul 2026-10-10-tema-nova §5): coloana „Despre” (titlu cu
 * o parte în culoarea de accent, text cu cuvinte evidențiate, un card-link opțional), până la 4 coloane de linkuri
 * (eticheta, adresa, iconița Font Awesome) și bara de jos (linkurile legale, limba, conținutul necitit, comutatorul
 * temei). Setarea `footer.config` e `null` până la prima salvare: site-ul arată atunci valorile implicite, traduse și
 * construite din aplicațiile instalate. Modul e pur (validare, normalizare, textul evidențiat).
 */

export const FOOTER_SETTING = "footer.config";
export const FOOTER_ACP_SECTION = "appearance.footer";
export const FOOTER_MAX_COLUMNS = 4;
export const FOOTER_MAX_LINKS = 12;

export type GcsFooterLink = { label: string; href: string; icon: string };
export type GcsFooterColumn = { title: string; accent: string; links: GcsFooterLink[] };
export type GcsFooterConfig = {
  about: { title: string; accent: string; text: string; cta: GcsFooterLink | null };
  columns: GcsFooterColumn[];
  /** Adresele goale nu se afișează; comutatoarele ascund limba, „Conținut necitit” și tema. */
  bottom: { privacy: string; contact: string; cookies: string; language: boolean; unread: boolean; theme: boolean };
};

/**
 * Profilurile sociale din ACP → Setări → Generale (`social.<cheie>`), în ordinea din subsol: iconița Font Awesome și
 * culoarea cercului. Kick nu are iconiță în setul gratuit: inițiala lui, pe verde.
 */
export const SOCIAL_NETWORKS = [
  { key: "facebook", setting: "social.facebook", icon: "fa-brands fa-facebook-f", color: "#1877F2", label: "Facebook" },
  { key: "instagram", setting: "social.instagram", icon: "fa-brands fa-instagram", color: "#E1306C", label: "Instagram" },
  { key: "tiktok", setting: "social.tiktok", icon: "fa-brands fa-tiktok", color: "#FE2C55", label: "TikTok" },
  { key: "youtube", setting: "social.youtube", icon: "fa-brands fa-youtube", color: "#FF0000", label: "YouTube" },
  { key: "x", setting: "social.x", icon: "fa-brands fa-x-twitter", color: "#16181C", label: "X" },
  { key: "twitch", setting: "social.twitch", icon: "fa-brands fa-twitch", color: "#9146FF", label: "Twitch" },
  { key: "kick", setting: "social.kick", icon: "fa-solid fa-k", color: "#2BB10A", label: "Kick" },
  { key: "steam", setting: "social.steam", icon: "fa-brands fa-steam", color: "#1B2838", label: "Steam" },
  { key: "github", setting: "social.github", icon: "fa-brands fa-github", color: "#24292F", label: "GitHub" },
  { key: "discord", setting: "social.discord", icon: "fa-brands fa-discord", color: "#5865F2", label: "Discord" },
] as const;
export type GcsSocialNetwork = (typeof SOCIAL_NETWORKS)[number];

const ICON_RE = /^fa-(solid|regular|brands) fa-[a-z0-9-]{1,60}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 32 && c !== "\n");

/** O adresă permisă în subsol: o cale internă (`/…`, nu `//`), `http(s)://` sau `mailto:`. */
export function isFooterHref(v: unknown): v is string {
  if (typeof v !== "string" || v !== v.trim() || v === "") return false;
  if (v.startsWith("/")) return !v.startsWith("//") && !v.startsWith("/\\");
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return true;
  if (!/^https?:\/\//i.test(v)) return false;
  return URL.canParse(v);
}

const text = (v: unknown, max: number, multiline = false): string | null => {
  if (typeof v !== "string") return "invalid";
  if (v.length > max) return "too_long";
  if (hasControl(v) || (!multiline && v.includes("\n"))) return "invalid";
  return null;
};

function linkError(l: unknown): string | null {
  if (!isObj(l)) return "invalid";
  const e = text(l.label, 60);
  if (e) return e;
  if (!isFooterHref(l.href)) return "invalid_url";
  if (typeof l.icon !== "string" || (l.icon !== "" && !ICON_RE.test(l.icon))) return "invalid_icon";
  return null;
}

/** Codul erorii unei configurații (`null` = validă, inclusiv `null` = valorile implicite). */
export function footerConfigError(v: unknown): string | null {
  if (v === null) return null;
  if (!isObj(v) || !isObj(v.about) || !Array.isArray(v.columns) || !isObj(v.bottom)) return "invalid";
  const a = v.about;
  const about = text(a.title, 60) ?? text(a.accent, 60) ?? text(a.text, 1000, true);
  if (about) return about;
  if (a.cta !== null && a.cta !== undefined) {
    const e = linkError(a.cta);
    if (e) return e;
  }
  if (v.columns.length > FOOTER_MAX_COLUMNS) return "too_many";
  for (const c of v.columns) {
    if (!isObj(c) || !Array.isArray(c.links)) return "invalid";
    const e = text(c.title, 60) ?? text(c.accent, 60);
    if (e) return e;
    if (c.links.length > FOOTER_MAX_LINKS) return "too_many";
    for (const l of c.links) {
      const le = linkError(l);
      if (le) return le;
    }
  }
  const b = v.bottom;
  for (const key of ["privacy", "contact", "cookies"] as const) {
    if (b[key] !== "" && !isFooterHref(b[key])) return "invalid_url";
  }
  for (const key of ["language", "unread", "theme"] as const) if (typeof b[key] !== "boolean") return "invalid";
  return null;
}

const link = (l: GcsFooterLink): GcsFooterLink => ({ label: l.label.trim(), href: l.href, icon: l.icon });

/** O configurație validă, doar cu câmpurile cunoscute (textele fără spațiile de la capete). */
export function normalizeFooterConfig(c: GcsFooterConfig): GcsFooterConfig {
  return {
    about: { title: c.about.title.trim(), accent: c.about.accent.trim(), text: c.about.text.trim(), cta: c.about.cta ? link(c.about.cta) : null },
    columns: c.columns.map((col) => ({ title: col.title.trim(), accent: col.accent.trim(), links: col.links.map(link) })),
    bottom: {
      privacy: c.bottom.privacy,
      contact: c.bottom.contact,
      cookies: c.bottom.cookies,
      language: c.bottom.language,
      unread: c.bottom.unread,
      theme: c.bottom.theme,
    },
  };
}

export type GcsFooterTextPart = { text: string; hl: boolean } | { br: true };

/**
 * Textul „Despre”: `**cuvinte**` = evidențiate (culoarea de accent), rândul nou = întrerupere. Restul e text simplu
 * (afișat ca text, deci fără HTML). Un `**` fără pereche rămâne text.
 */
export function footerRichText(input: string): GcsFooterTextPart[] {
  const out: GcsFooterTextPart[] = [];
  input.split("\n").forEach((line, i) => {
    if (i > 0) out.push({ br: true });
    const parts = line.split("**");
    // Număr par de bucăți = un `**` fără pereche: ultima bucată se lipește înapoi, ca text.
    if (parts.length % 2 === 0) {
      const last = parts.pop()!;
      parts[parts.length - 1] = `${parts[parts.length - 1]}**${last}`;
    }
    parts.forEach((p, j) => {
      if (p) out.push({ text: p, hl: j % 2 === 1 });
    });
  });
  return out;
}
