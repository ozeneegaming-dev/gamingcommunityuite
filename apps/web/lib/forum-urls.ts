/** URL-urile forumului (spec §4: `/{tip}/{id}-{slug}`). Fără dependențe de server: se folosesc și în componentele client. */
import { slugify } from "@gcs/modules/slug";

const withPage = (base: string, page?: number) => (page && page > 1 ? `${base}?page=${page}` : base);

export const forumHref = (f: { id: number; slug: string }, page?: number) => withPage(`/forum/${f.id}-${f.slug}`, page);
export const topicHref = (t: { id: number; slug: string }, page?: number) => withPage(`/topic/${t.id}-${t.slug}`, page);
export const newTopicHref = (f: { id: number; slug: string }) => `/forum/${f.id}-${f.slug}/new`;
export const postHref = (topicId: number, postId: number) => `/topic/${topicId}/post/${postId}`;
export const unreadHref = (topicId: number) => `/topic/${topicId}/unread`;
/** Profilul unui membru: `/members/{id}-{slug}` (spec §4). */
export const memberHref = (u: { id: string; name: string }) => `/members/${u.id}-${slugify(u.name)}`;
export const tagHref = (slug: string) => `/tags/${slug}`;

/** Culoarea forumului ca fundal transparent (iconul din macheta Main: `rgba(..., .14)`). */
export function tint(hex: string | null | undefined, alpha = 0.14): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return `rgba(214, 40, 57, ${alpha})`;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}
