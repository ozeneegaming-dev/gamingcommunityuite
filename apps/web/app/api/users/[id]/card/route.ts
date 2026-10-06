import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { hoverCardVars } from "@/lib/template-data";
import { siteTemplateHtml } from "@/lib/templates";

export const dynamic = "force-dynamic";

/**
 * Datele hover card-ului (spec §8): `GET /api/users/{id}/card`. Partea comună e cache-uită în Redis 60 s;
 * clientul păstrează răspunsul 5 minute. Un profil pe care viewer-ul nu-l vede dă 404. Dacă tema viewer-ului a
 * modificat șablonul `members.hover_card`, răspunsul are și `html` (randat și sanitizat pe server).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!/^[a-z0-9]{8,40}$/i.test(id)) return new Response(null, { status: 404 });
  const card = await services().profileQueries.card(await currentActor(), id);
  if (!card) return new Response(null, { status: 404 });
  const html = await siteTemplateHtml("members.hover_card", hoverCardVars(card));
  return Response.json({ ...card, html }, { headers: { "Cache-Control": "private, no-store" } });
}
