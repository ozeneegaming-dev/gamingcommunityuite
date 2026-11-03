import { ROBOTS_CUSTOM_MAX, type GcsRobotsMode } from "./settings";

/**
 * Ce nu indexează motoarele în `robots.txt`-ul implicit: ACP-ul, API-ul, installerul, paginile de autentificare și de
 * resetare a parolei, rezultatele căutării, fișierele încărcate și paginile private ale membrilor.
 */
export const ROBOTS_DEFAULT_DISALLOW = [
  "/admin",
  "/api/",
  "/install",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/search",
  "/files/",
  "/settings",
  "/messages",
  "/notifications",
  "/aspect-preview",
] as const;

export type GcsRobotsInput = {
  mode: GcsRobotsMode | string;
  custom: string;
  /** Adresa site-ului, fără `/` la final (ex. `https://forum.exemplu.ro`). */
  base: string;
  /** Sitemap-ul e pornit: linia `Sitemap:` apare (și se adaugă la textul personalizat, dacă lipsește). */
  sitemap: boolean;
};

const sitemapLine = (base: string) => `Sitemap: ${base}/sitemap.xml`;

/** `robots.txt`: cel implicit, sau textul adminului (limitat, cu rândurile normalizate) cu linia sitemap-ului adăugată. */
export function buildRobotsTxt(input: GcsRobotsInput): string {
  const custom = input.custom.replace(/\r\n?/g, "\n").slice(0, ROBOTS_CUSTOM_MAX);
  if (input.mode === "custom" && custom.trim() !== "") {
    const lines = custom
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const hasSitemap = /^\s*sitemap\s*:/im.test(lines);
    return `${lines}\n${input.sitemap && !hasSitemap ? `\n${sitemapLine(input.base)}\n` : ""}`;
  }
  const rules = ["User-agent: *", "Allow: /", ...ROBOTS_DEFAULT_DISALLOW.map((p) => `Disallow: ${p}`)].join("\n");
  return `${rules}\n${input.sitemap ? `\n${sitemapLine(input.base)}\n` : ""}`;
}
