import { mapArtUrl } from "@gcs/modules";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ game: string; map: string }> };

/**
 * Imaginea unei hărți (specul 2026-10-08-servere-pagini §2): redirect la imaginea aleasă după ordinea din specul punții
 * §13 — încărcată în ACP, după șablon (în modul `direct`, chiar adresa externă; în modul `copy`, copia de pe site) sau
 * arta generică originală a jocului. Paginile rezolvă imaginea pe server; ruta rămâne pentru hărțile schimbate live și
 * pentru alți consumatori. Numele invalide primesc arta generică; aplicația oprită → 404. Cache public 5 minute;
 * `Referrer-Policy: no-referrer` se aplică și cererii spre adresa externă (redirectul).
 */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) return new Response(null, { status: 404 });
  const { game, map } = await ctx.params;
  const key = /^[a-z0-9_]{1,32}$/.test(game) ? game : "default";
  // Parametrul vine deja decodat; un nume de hartă valid nu are `%`, deci nu se mai decodează nimic.
  const name = map.trim().toLowerCase();
  const image = /^[a-z0-9_.-]{1,64}$/.test(name) && !/^\.+$/.test(name) ? await bridge.maps.image(key, name) : { url: mapArtUrl(key), generic: true };
  // Adresa relativă: în spatele unui proxy, `req.url` poate avea host-ul intern.
  return new Response(null, { status: 302, headers: { Location: image.url, "Cache-Control": "public, max-age=300", "Referrer-Policy": "no-referrer" } });
}
