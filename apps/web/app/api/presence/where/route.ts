import { guestPresenceId } from "@gcs/core";
import { isSameOrigin } from "@/lib/actions";
import { currentActor } from "@/lib/actor";
import { clientIp } from "@/lib/client-ip";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Unde e vizitatorul pe site (pagina /online, Membri v2): calea și titlul paginii curente, trimise de site la fiecare
 * navigare. Doar din aceeași origine; un banat nu se notează.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return new Response(null, { status: 403 });
  const body = (await request.json().catch(() => null)) as { path?: unknown; title?: unknown } | null;
  if (!body || typeof body.path !== "string") return new Response(null, { status: 400 });
  const actor = await currentActor();
  if (actor.isBanned) return new Response(null, { status: 204 });
  const ip = clientIp(request.headers);
  await services()
    .whereabouts.note(actor.userId ? { userId: actor.userId } : { guestId: guestPresenceId(ip) }, { path: body.path, title: typeof body.title === "string" ? body.title : "", ip })
    .catch(() => {});
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
