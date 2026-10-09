/**
 * Previzualizarea linkurilor din chat (Chat Pro, preferința „Previzualizări bogate”): titlul paginii și numele
 * site-ului, din `og:title` / `twitter:title` / `<title>` și `og:site_name`. Doar text (fără imagini de la terți);
 * descărcarea o face serverul, prin garda anti-SSRF.
 */
export type GcsLinkPreview = { url: string; host: string; title: string; site: string | null };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html: string, names: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!key || !names.includes(key)) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = decode(content?.[1] ?? content?.[2] ?? "");
    if (value) return value;
  }
  return null;
}

/** Titlul și site-ul unei pagini HTML (doar `<head>`-ul contează); `null` fără titlu. */
export function parseLinkPreview(url: string, html: string): GcsLinkPreview | null {
  const head = html.slice(0, 200_000);
  const title = meta(head, ["og:title", "twitter:title"]) ?? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "");
  if (!title) return null;
  const host = URL.canParse(url) ? new URL(url).host : "";
  return { url, host, title: title.slice(0, 160), site: meta(head, ["og:site_name"])?.slice(0, 60) ?? null };
}
