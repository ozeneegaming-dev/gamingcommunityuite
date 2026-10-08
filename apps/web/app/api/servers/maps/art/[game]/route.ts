import { mapArtSvg } from "@gcs/modules";

export const dynamic = "force-static";

type Ctx = { params: Promise<{ game: string }> };

/**
 * Arta generică a hărților unui joc (specul 2026-10-08-servere-bridge §13): un SVG original, desenat de GCS (fără text,
 * imagini externe sau scripturi); numele hărții se scrie peste el la afișare. Cache public o zi.
 */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { game } = await ctx.params;
  const key = /^[a-z0-9_]{1,32}$/.test(game) ? game : "default";
  return new Response(mapArtSvg(key), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      // Deschis direct, SVG-ul nu poate încărca nimic și nu poate rula nimic.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
