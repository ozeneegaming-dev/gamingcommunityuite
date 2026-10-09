import { isSafeBanner } from "@gcs/core";
import type { GcsGroupCardData } from "@gcs/ui";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { iconData } from "@/lib/group-mentions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Cardul unui grup menționat (Mențiuni v2): `GET /api/groups/{id}/card`, deschis de hover pe pastila `@Grup`. Doar
 * grupurile care pot fi menționate sau apar în legendă (altfel 404). Partea comună e cache-uită 30 s pe server;
 * clientul o păstrează scurt. Lista de membri o primește doar cine poate vedea lista de membri.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) return new Response(null, { status: 404 });
  const card = await services().mentionQueries.card(await currentActor(), Number(id));
  if (!card) return new Response(null, { status: 404 });
  const data: GcsGroupCardData = {
    group: {
      id: card.id,
      key: card.key,
      name: card.name,
      title: card.title,
      color: card.color,
      banner: isSafeBanner(card.banner) ? card.banner : null,
      icon: iconData(card.icon) ?? iconData("fa-solid fa-users"),
    },
    memberCount: card.memberCount,
    onlineCount: card.onlineCount,
    members: card.members.map((m) => ({ id: m.id, name: m.name, image: m.image, nameKey: m.nameKey, href: memberHref(m), online: m.online })),
    canListMembers: card.canListMembers,
    href: `/members?group=${card.id}`,
  };
  return Response.json(data, { headers: { "Cache-Control": "private, max-age=30" } });
}
