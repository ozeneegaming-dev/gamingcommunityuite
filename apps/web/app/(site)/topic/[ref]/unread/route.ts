import { canViewPost, parseRef } from "@gcs/modules";
import { currentActor } from "@/lib/actor";
import { topicHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string }> };

/** „Prima necitită” (`/topic/{id}/unread`): redirect la prima postare necitită, pe pagina ei. */
export async function GET(req: Request, { params }: Props): Promise<Response> {
  const ref = parseRef((await params).ref);
  if (!ref) return new Response(null, { status: 404 });
  const { db, posting, readMarkers } = services();
  const actor = await currentActor();
  const topic = await db.topic.findUnique({ where: { id: ref.id }, select: { slug: true, firstPostId: true } });
  if (!topic?.firstPostId || !(await canViewPost(posting, actor, topic.firstPostId))) return new Response(null, { status: 404 });

  const target = await readMarkers.firstUnread(actor, ref.id);
  const href = target ? `${topicHref({ id: ref.id, slug: topic.slug }, target.page)}#post-${target.postId}` : topicHref({ id: ref.id, slug: topic.slug });
  return Response.redirect(new URL(href, req.url), 303);
}
