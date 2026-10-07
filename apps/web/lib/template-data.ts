/**
 * Datele șabloanelor (ACP → Aspect → Șabloane), construite din datele pe care componentele React le au deja. Funcții
 * pure (fără server): aceleași calcule ca în componente, ca un șablon pornit de la cel implicit să arate identic.
 * Numele și formele variabilelor sunt documentate în `@gcs/core` (`DEFAULT_TEMPLATES[].variables`).
 */
import { isSafeBanner } from "@gcs/core";
import type { GcsCardView, GcsForumRow, GcsMemberCard, GcsPostAuthor, GcsPostbitData, GcsTopicRow, GcsUserRef } from "@gcs/modules";
import { forumHref, memberHref, tagHref, topicHref, unreadHref } from "./forum-urls";

/** Numele vechi ale iconițelor de forum (din etapele 1–4), pentru date nemigrate. */
const LEGACY_FORUM_ICONS: Record<string, string> = {
  chat: "fa-solid fa-comments",
  megaphone: "fa-solid fa-bullhorn",
  book: "fa-solid fa-book",
  shield: "fa-solid fa-shield-halved",
  gamepad: "fa-solid fa-gamepad",
  users: "fa-solid fa-users",
  help: "fa-solid fa-circle-question",
  link: "fa-solid fa-link",
};

/** Iconița unui forum (aleasă din ACP), cu numele vechi traduse; implicit balonul de chat. */
export function forumIconName(icon: string | null | undefined): string {
  return (icon && (LEGACY_FORUM_ICONS[icon] ?? icon)) || "fa-solid fa-comments";
}

export type GcsTemplateUser = { id: string; name: string; url: string; image: string | null; nameKey: string; frameKey: string | null; groupKey: string | null };

export function userVar(u: (Pick<GcsUserRef, "id" | "name" | "image" | "nameKey" | "frameKey"> & { groupKey?: string }) | null | undefined): GcsTemplateUser | null {
  if (!u) return null;
  return { id: u.id, name: u.name, url: memberHref(u), image: u.image, nameKey: u.nameKey, frameKey: u.frameKey, groupKey: u.groupKey ?? null };
}

/** `forum.row` */
export function forumRowVars(forum: GcsForumRow, accent: string | null) {
  const external = forum.type === "LINK";
  return {
    forum: {
      id: forum.id,
      name: forum.name,
      description: forum.description,
      url: external ? (forum.linkUrl ?? "#") : forumHref(forum),
      external,
      icon: external ? "fa-solid fa-link" : forumIconName(forum.icon),
      color: forum.color ?? accent ?? "#FF6B74",
      unread: forum.unread,
      topicsCount: forum.topicsCount,
      postsCount: forum.postsCount,
      subforumColumns: forum.subforumColumns,
      subforums: forum.subforums.map((s) => ({ id: s.id, name: s.name, url: forumHref(s), icon: forumIconName(s.icon ?? "fa-regular fa-comment"), topicsCount: s.topicsCount })),
      last: forum.last
        ? { topicTitle: forum.last.topicTitle, topicUrl: topicHref({ id: forum.last.topicId, slug: forum.last.topicSlug }), at: forum.last.at, user: userVar(forum.last.user) }
        : null,
    },
  };
}

/** `forum.topic_row` */
export function topicRowVars(topic: GcsTopicRow) {
  return {
    topic: {
      id: topic.id,
      title: topic.title,
      url: topicHref(topic),
      unreadUrl: unreadHref(topic.id),
      unread: topic.unread,
      pinned: topic.pinned,
      featured: topic.featured,
      solved: topic.solved,
      locked: topic.locked,
      visibility: topic.visibility,
      prefix: topic.prefix ? { name: topic.prefix.name, color: topic.prefix.color } : null,
      tags: topic.tags.map((t) => ({ name: t.name, url: tagHref(t.slug) })),
      createdAt: topic.createdAt,
      repliesCount: topic.repliesCount,
      viewsCount: topic.viewsCount,
      author: userVar(topic.author),
      last: { at: topic.last.at, user: userVar(topic.last.user) },
    },
  };
}

/** Câte coroane arată postbit-ul pentru nivelul rangului (ca în componenta React). */
const MAX_PIPS = 8;

/** Iconița rangului: un nume Font Awesome (`fa-crown` → `fa-solid fa-crown`) sau, altfel, un emoji/text. */
function rankIcon(icon: string | null | undefined): { icon: string; symbol: string | null } {
  if (!icon) return { icon: "fa-solid fa-shield-halved", symbol: null };
  if (!icon.startsWith("fa-")) return { icon: "fa-solid fa-shield-halved", symbol: icon };
  return { icon: /^fa-(solid|regular|brands) /.test(icon) ? icon : `fa-solid ${icon}`, symbol: null };
}

/** `postbit.author` (și `postbit.fields`) */
export function postbitVars(author: GcsPostAuthor, data: GcsPostbitData | null, post: { id: number; number: number }) {
  const groupColor = data?.group.color ?? author.groupColor;
  const groupLabel = data?.group.name ?? author.groupTitle ?? author.groupName;
  const banner = data?.group.banner && isSafeBanner(data.group.banner) ? data.group.banner : (groupColor ?? null);
  const secondary = data?.vipName && data.vipName !== groupLabel ? data.vipName : (data?.secondaryGroup ?? data?.vipName ?? groupLabel);
  const rank = rankIcon(author.rank?.icon ?? null);
  return {
    post,
    author: {
      ...userVar(author)!,
      handle: author.name.toLowerCase(),
      hasData: data !== null,
      online: data?.online ?? false,
      secondary,
      customTitle: data?.customTitle ?? null,
      vip: data?.vip ?? false,
      rankLevel: data?.rankLevel ?? null,
      pips: data?.rankLevel ? Math.min(data.rankLevel, MAX_PIPS) : 0,
      rank: author.rank ? { name: author.rank.name, symbol: rank.symbol } : null,
      rankIcon: rank.icon,
      group: { label: groupLabel, icon: data?.group.icon ?? null, banner },
      xp: data ? { points: data.xp.points, next: data.xp.next, nextRank: data.xp.nextRank ?? "", percent: data.xp.percent } : { points: 0, next: null, nextRank: "", percent: 0 },
      badges: {
        count: data?.badges.count ?? 0,
        /** Câte badge-uri nu încap în rândul din postbit („+N”). */
        more: Math.max(0, (data?.badges.count ?? 0) - (data?.badges.recent.length ?? 0)),
        recent: (data?.badges.recent ?? []).map((b) => ({
          key: b.key,
          name: b.name,
          description: b.description,
          color: b.color,
          image: b.image,
          art: b.art,
          icon: b.symbol?.startsWith("fa-") ? b.symbol : null,
          symbol: b.symbol && !b.symbol.startsWith("fa-") ? b.symbol : null,
          initial: b.name.charAt(0),
        })),
      },
      postsCount: author.postsCount,
      topicsCount: data?.topicsCount ?? 0,
      reputation: author.reputation,
      joinedAt: author.joinedAt,
      motto: data?.motto ?? null,
      fields: (data?.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        icon: f.icon ?? (f.type === "URL" ? "fa-solid fa-link" : "fa-solid fa-circle-info"),
        type: f.type,
        value: f.value,
        display: f.value.replace(/^https?:\/\//, ""),
        image: f.image,
      })),
    },
  };
}

/** `members.card` */
export function memberCardVars(member: GcsMemberCard) {
  return {
    member: {
      ...userVar(member)!,
      online: member.online,
      customTitle: member.customTitle,
      group: { name: member.group.name, color: member.group.color },
      rank: member.rank ? { name: member.rank.name } : null,
      postsCount: member.postsCount,
      reputation: member.reputation,
      joinedAt: member.joinedAt,
    },
  };
}

/** `members.hover_card` */
export function hoverCardVars(card: GcsCardView) {
  return {
    user: {
      id: card.user.id,
      name: card.user.name,
      url: `/members/${card.user.id}-${card.user.slug}`,
      image: card.user.image,
      nameKey: card.user.nameKey,
      frameKey: card.user.frameKey,
      groupKey: card.user.groupKey,
      bio: card.user.bio,
      accentColor: card.user.accentColor ?? "#D62839",
      cover: card.user.cover,
      group: { name: card.user.group.name, color: card.user.group.color },
      rank: card.user.rank ? { name: card.user.rank.name, icon: card.user.rank.icon } : null,
    },
    stats: card.stats,
    online: card.online.online,
    badges: card.badges.map((b) => ({ key: b.key, name: b.name, description: b.description, symbol: b.symbol, image: b.image, color: b.color, art: b.art })),
    fields: card.fields,
    viewer: card.viewer,
  };
}

/** `widgets.card` */
export function widgetCardVars(w: { id: string; type: string; title: string; icon: string | null; hasExtra: boolean; testId?: string | undefined }) {
  return { widget: { id: w.id, type: w.type, title: w.title, icon: w.icon, headingId: `gcs-widget-${w.id}`, hasExtra: w.hasExtra, testId: w.testId ?? null } };
}
