import { canViewPost, parseRef } from "@gcs/modules";
import { currentActor } from "@/lib/actor";
import { topicHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { jumpRedirect } from "@/lib/topic-open";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string; postId: string }> };

/** Permalink-ul unei postări (`/topic/{id}/post/{postId}`): redirect la pagina care o conține, cu `#post-{id}`. */
export async function GET(req: Request, { params }: Props): Promise<Response> {
  const { ref: raw, postId: rawPost } = await params;
  const ref = parseRef(raw);
  const postId = Number(rawPost);
  if (!ref || !Number.isSafeInteger(postId)) return new Response(null, { status: 404 });

  const { db, posting } = services();
  const actor = await currentActor();
  const post = await db.post.findUnique({ where: { id: postId }, select: { topicId: true, topic: { select: { slug: true } } } });
  if (!post || post.topicId !== ref.id || !(await canViewPost(posting, actor, postId))) return new Response(null, { status: 404 });

  const page = await posting.pageOf(ref.id, postId);
  // Ținta e aleasă explicit: preferința „deschide la …” nu se mai aplică (cookie-ul scurt `gcs-jump`).
  return jumpRedirect(`${topicHref({ id: ref.id, slug: post.topic.slug }, page)}#post-${postId}`, ref.id);
}
