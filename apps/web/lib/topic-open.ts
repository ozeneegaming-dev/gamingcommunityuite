import "server-only";
import type { GcsActor } from "@gcs/core";
import { cookies, headers } from "next/headers";
import { topicHref } from "./forum-urls";
import { localRedirect } from "./redirect";
import { services } from "./services";

/**
 * „Comportamentul la deschiderea conținutului” (Setări → Vizualizarea conținutului, setările contului v2): un topic deschis
 * din altă pagină (o listă, un widget, căutarea) se deschide la prima postare necitită, la început sau la ultima postare.
 * Nu se aplică atunci când:
 * - adresa cere o pagină anume (`?page=`) sau vine din permalink-ul unei postări / „prima necitită” (cookie-ul scurt
 *   `gcs-jump`, pus de acele rute: fragmentul `#post-…` nu ajunge la server);
 * - navigarea e în interiorul aceluiași topic (paginarea).
 */
export const TOPIC_JUMP_COOKIE = "gcs-jump";

/** Redirecționarea unei rute de salt (permalink, prima necitită), cu marcajul că ținta e aleasă explicit. */
export function jumpRedirect(path: string, topicId: number): Response {
  const res = localRedirect(path);
  res.headers.append("Set-Cookie", `${TOPIC_JUMP_COOKIE}=${topicId}; Path=/; Max-Age=15; SameSite=Lax; HttpOnly`);
  return res;
}

export type GcsTopicOpenPlan = { kind: "none" } | { kind: "focus"; postId: number } | { kind: "redirect"; href: string };

/** Ce face pagina topicului la deschidere, după preferința viewer-ului. */
export async function topicOpenPlan(actor: GcsActor, topicId: number, opts: { hasPage: boolean }): Promise<GcsTopicOpenPlan> {
  if (!actor.userId || opts.hasPage) return { kind: "none" };
  const [jar, h] = await Promise.all([cookies(), headers()]);
  if (jar.get(TOPIC_JUMP_COOKIE)?.value === String(topicId)) return { kind: "none" };
  const referer = h.get("referer");
  if (referer && URL.canParse(referer) && new RegExp(`^/topic/${topicId}(?:[-/]|$)`).test(new URL(referer).pathname)) return { kind: "none" };
  const { memberPrefs, readMarkers, db, posting } = services();
  const pref = (await memberPrefs.get(actor.userId)).topicOpen;
  if (pref === "start") return { kind: "none" };
  const topic = await db.topic.findUnique({ where: { id: topicId }, select: { slug: true, lastPostId: true, firstPostId: true } });
  if (!topic) return { kind: "none" };
  // Ținta pe altă pagină: redirect cu `?page=` (fără buclă); pe prima pagină: derularea la postare, în client.
  const go = (target: { postId: number; page: number }): GcsTopicOpenPlan =>
    target.page > 1 ? { kind: "redirect", href: `${topicHref({ id: topicId, slug: topic.slug }, target.page)}#post-${target.postId}` } : { kind: "focus", postId: target.postId };
  if (pref === "unread") {
    const target = await readMarkers.firstUnread(actor, topicId);
    return target && target.postId !== topic.firstPostId ? go(target) : { kind: "none" };
  }
  if (!topic.lastPostId || topic.lastPostId === topic.firstPostId) return { kind: "none" };
  return go({ postId: topic.lastPostId, page: await posting.pageOf(topicId, topic.lastPostId) });
}
