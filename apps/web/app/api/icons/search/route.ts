import { searchIcons } from "@gcs/ui/icon-registry";

/**
 * Căutarea în iconițele Font Awesome Free (selectorul de iconițe din ACP și din editoarele de pe site): `?q=`.
 * Datele sunt statice (fără nimic despre useri), deci răspunsul se poate păstra în cache.
 */
export function GET(req: Request): Response {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 60);
  return Response.json({ icons: searchIcons(q, 60) }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
