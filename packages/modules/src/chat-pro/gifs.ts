import { GcsValidationError } from "@gcs/core";
import type { GcsChatProGif, GcsChatProGifProvider } from "./types";

/**
 * GIF-urile Chat Pro, independente de furnizor: GIPHY sau Tenor, ales din ACP cu cheia lui (pe server: cheia nu ajunge
 * în browser). Căutare și „trending”, filtrate pentru un public general; URL-urile se reconstruiesc / se verifică după
 * domeniul furnizorului, ca în chat să ajungă doar imagini de la el.
 */

export const GIF_ATTRIBUTION: Record<GcsChatProGifProvider, string> = { giphy: "Powered by GIPHY", tenor: "Powered by Tenor" };

const GIPHY_ID = /^[A-Za-z0-9]{4,40}$/;
const TENOR_URL = /^https:\/\/media\d*\.tenor\.com\/[A-Za-z0-9_-]{6,80}\/[A-Za-z0-9_.-]{1,120}\.gif$/;
const GIPHY_URL = /^https:\/\/media\.giphy\.com\/media\/[A-Za-z0-9]{4,40}\/(?:200|200w)\.gif$/;
const LIMIT = 24;

type Opts = { limit?: number; lang?: string; fetch?: typeof fetch };
type GiphyImage = { url?: string; width?: string; height?: string };
type GiphyItem = { id?: string; title?: string; images?: { fixed_height?: GiphyImage } };
type TenorItem = { id?: string; content_description?: string; media_formats?: Record<string, { url?: string; dims?: number[] }> };

async function getJson(url: string, f: typeof fetch): Promise<unknown> {
  const res = await f(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`gif ${res.status}`);
  return res.json();
}

function fromGiphy(body: unknown): GcsChatProGif[] {
  const data = (body as { data?: GiphyItem[] }).data ?? [];
  return data
    .filter((g): g is GiphyItem & { id: string } => typeof g.id === "string" && GIPHY_ID.test(g.id))
    .map((g) => ({
      id: g.id,
      title: (g.title ?? "").slice(0, 100),
      url: `https://media.giphy.com/media/${g.id}/200.gif`,
      preview: `https://media.giphy.com/media/${g.id}/200w.gif`,
      width: Number(g.images?.fixed_height?.width) || 200,
      height: Number(g.images?.fixed_height?.height) || 200,
    }));
}

function fromTenor(body: unknown): GcsChatProGif[] {
  const data = (body as { results?: TenorItem[] }).results ?? [];
  const out: GcsChatProGif[] = [];
  for (const t of data) {
    const gif = t.media_formats?.gif;
    const tiny = t.media_formats?.tinygif ?? gif;
    if (typeof t.id !== "string" || !/^[0-9]{1,30}$/.test(t.id) || !gif?.url || !TENOR_URL.test(gif.url) || !tiny?.url || !TENOR_URL.test(tiny.url)) continue;
    out.push({
      id: t.id,
      title: (t.content_description ?? "").slice(0, 100),
      url: gif.url,
      preview: tiny.url,
      width: Number(gif.dims?.[0]) || 200,
      height: Number(gif.dims?.[1]) || 200,
    });
  }
  return out;
}

/** Căutarea în furnizorul ales (cel mult 24 de rezultate, conținut potrivit pentru orice vârstă). */
export async function searchGifs(provider: GcsChatProGifProvider, key: string, rawQuery: string, opts: Opts = {}): Promise<GcsChatProGif[]> {
  const q = rawQuery.trim().slice(0, 50);
  if (!q) throw new GcsValidationError({ q: "required" });
  const f = opts.fetch ?? fetch;
  const limit = String(opts.limit ?? LIMIT);
  const lang = opts.lang ?? "en";
  if (provider === "tenor") {
    const params = new URLSearchParams({ q, key, client_key: "gcs", limit, media_filter: "gif,tinygif", contentfilter: "medium", locale: lang });
    return fromTenor(await getJson(`https://tenor.googleapis.com/v2/search?${params}`, f));
  }
  const params = new URLSearchParams({ api_key: key, q, limit, rating: "pg-13", lang });
  return fromGiphy(await getJson(`https://api.giphy.com/v1/gifs/search?${params}`, f));
}

/** GIF-urile populare acum („trending” / „featured”). */
export async function trendingGifs(provider: GcsChatProGifProvider, key: string, opts: Opts = {}): Promise<GcsChatProGif[]> {
  const f = opts.fetch ?? fetch;
  const limit = String(opts.limit ?? LIMIT);
  if (provider === "tenor") {
    const params = new URLSearchParams({ key, client_key: "gcs", limit, media_filter: "gif,tinygif", contentfilter: "medium", locale: opts.lang ?? "en" });
    return fromTenor(await getJson(`https://tenor.googleapis.com/v2/featured?${params}`, f));
  }
  const params = new URLSearchParams({ api_key: key, limit, rating: "pg-13" });
  return fromGiphy(await getJson(`https://api.giphy.com/v1/gifs/trending?${params}`, f));
}

/** Un GIF favorit trimis de browser: doar adrese ale furnizorilor cunoscuți, câmpuri curățate. */
export function cleanGif(raw: unknown): GcsChatProGif | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const url = typeof g.url === "string" ? g.url : "";
  const preview = typeof g.preview === "string" ? g.preview : "";
  const ok = (u: string) => GIPHY_URL.test(u) || TENOR_URL.test(u);
  if (typeof g.id !== "string" || !/^[A-Za-z0-9]{1,40}$/.test(g.id) || !ok(url) || !ok(preview)) return null;
  const size = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= 2000 ? (v as number) : 200);
  return { id: g.id, title: typeof g.title === "string" ? g.title.slice(0, 100) : "", url, preview, width: size(g.width), height: size(g.height) };
}
