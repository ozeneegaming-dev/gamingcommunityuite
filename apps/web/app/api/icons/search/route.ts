import { iconMatch, isGcsIconCategory, searchIcons } from "@gcs/ui/icon-registry";

/**
 * Căutarea în iconițele Font Awesome Free (selectorul de iconițe din ACP și din editoarele de pe site): `?q=` (textul),
 * `?cat=` (categoria: populare, gaming, comunitate…) sau `?name=` (o singură iconiță, pentru butonul selectorului).
 * Datele sunt statice (fără nimic despre useri), deci răspunsul se poate păstra în cache.
 */
export function GET(req: Request): Response {
  const params = new URL(req.url).searchParams;
  const name = params.get("name");
  const cat = params.get("cat");
  const icons = name !== null ? [iconMatch(name.slice(0, 80))].filter((i) => i !== null) : searchIcons((params.get("q") ?? "").slice(0, 60), 60, isGcsIconCategory(cat) ? cat : undefined);
  return Response.json({ icons }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
