import { parseBadgeArtFile } from "@gcs/ui/badge-art";
import { badgeArtSvg } from "@gcs/ui/badge-art/server";

/**
 * Insigna unui badge (specul `2026-10-07-insigne-grafice.md`, §9): `GET /badge-art/v1/{formă}-{nivel}-{rrggbb}-{glifă}.svg`.
 * Adresa descrie complet desenul (nimic din baza de date), deci răspunsul e același pentru toți și se păstrează un an.
 * Doar adresa canonică e acceptată; SVG-ul e compus din piese fixe, iar CSP-ul oprește orice în afara lui.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const spec = parseBadgeArtFile((await params).file);
  if (!spec) return new Response(null, { status: 404 });
  return new Response(badgeArtSvg(spec), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
