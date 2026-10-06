import { GcsValidationError } from "@gcs/core";
import { giphyUrl } from "./text";

/** Un GIF din căutarea GIPHY: `url` se trimite în mesaj, `preview` e miniatura din listă. */
export type GcsGif = { id: string; title: string; url: string; preview: string; width: number; height: number };

const ID_RE = /^[A-Za-z0-9]{4,40}$/;
const API = "https://api.giphy.com/v1/gifs/search";

type GiphyImage = { url?: string; width?: string; height?: string };
type GiphyItem = { id?: string; title?: string; images?: { fixed_height?: GiphyImage; fixed_height_small?: GiphyImage } };

/**
 * Căutarea GIPHY (comanda `/giphy` din chat), pe server: cheia API nu ajunge în browser. Rezultatele sunt filtrate
 * (`rating=pg-13`) și reduse la ce afișează chat-ul; URL-urile se reconstruiesc din id (doar `media.giphy.com`).
 */
export async function searchGiphy(key: string, rawQuery: string, opts: { limit?: number; lang?: string; fetch?: typeof fetch } = {}): Promise<GcsGif[]> {
  const q = rawQuery.trim().slice(0, 50);
  if (!q) throw new GcsValidationError({ q: "required" });
  const params = new URLSearchParams({ api_key: key, q, limit: String(opts.limit ?? 24), rating: "pg-13", lang: opts.lang ?? "en" });
  const res = await (opts.fetch ?? fetch)(`${API}?${params}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`giphy ${res.status}`);
  const body = (await res.json()) as { data?: GiphyItem[] };
  return (body.data ?? [])
    .filter((g): g is GiphyItem & { id: string } => typeof g.id === "string" && ID_RE.test(g.id))
    .map((g) => {
      const fixed = g.images?.fixed_height ?? {};
      return {
        id: g.id,
        title: (g.title ?? "").slice(0, 100),
        url: giphyUrl(g.id),
        preview: `https://media.giphy.com/media/${g.id}/200w.gif`,
        width: Number(fixed.width) || 200,
        height: Number(fixed.height) || 200,
      };
    });
}
