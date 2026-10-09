import "server-only";
import type { GcsActor } from "@gcs/core";
import { levelProgress, normalizePrivacy, type GcsLevelProgress } from "@gcs/modules";
import { playerHref } from "../app/(site)/_components/servers/types";
import { memberHref } from "./forum-urls";
import { services } from "./services";

/** Un rând din meniul contului: textul (cheia `header.account.items.<key>`), adresa, iconița și un număr / o notă. */
export type GcsAccountItem = { key: string; href: string; icon: string; count?: number; note?: string };
export type GcsAccountSection = { key: "content" | "gaming" | "settings" | "staff"; items: GcsAccountItem[] };

/** Datele meniului contului (cardul de rang, secțiunile după drepturi și aplicații). */
export type GcsAccountMenuData = {
  user: { id: string; name: string; nameKey: string; image: string | null; frameKey: string | null; href: string };
  /** Grupul principal, apoi cele secundare (pastilele grupurilor duc la `/members?group=<id>`). */
  groups: { id: number; name: string; color: string | null }[];
  /** Statusul de prezență: vizibil („online”) sau ascuns (Confidențialitate → „Arată când sunt online”). */
  status: "online" | "invisible";
  level: GcsLevelProgress;
  stats: { posts: number; reputation: number; elo: number | null };
  sections: GcsAccountSection[];
};

const PLUGIN_VIP_STUDIO = "gcs.vip_studio";

/**
 * Meniul contului (specul 2026-10-10-hero-cockpit §3): cardul de rang (grupurile, statusul, nivelul și XP-ul, 3
 * statistici: postări, reputație, ELO-ul mix cu aplicația Servere), apoi secțiunile: Conținutul meu, Gaming (doar cu
 * aplicațiile lui), Setări (Studio VIP când e instalat) și Staff (doar cu drepturile lui).
 */
export async function accountMenuData(actor: GcsActor, staffLinks: { themeEditor: string | null; pageEditor: boolean }): Promise<GcsAccountMenuData | null> {
  if (!actor.userId) return null;
  const { db, permissions, apps, bridge, clanQueries, moderation, profileQueries } = services();
  const userId = actor.userId;
  const [user, display, ladder, usable, secondary, follows, files, accounts, vipStudio] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { rankId: true, points: true, postsCount: true, reputation: true, privacy: true, primaryGroup: { select: { id: true, name: true, title: true, color: true } } } }),
    profileQueries.userDisplays([userId]).then((m) => m.get(userId) ?? null),
    db.rank.findMany({ select: { id: true, name: true, position: true, minPosts: true, minPoints: true, minReputation: true } }),
    apps.accessFilter(actor),
    db.userGroup.findMany({ where: { userId }, select: { group: { select: { id: true, name: true, title: true, color: true, position: true } } } }),
    db.follow.count({ where: { userId } }),
    db.attachment.count({ where: { ownerId: userId } }),
    db.account.findMany({ where: { userId }, select: { providerId: true } }),
    db.plugin.findUnique({ where: { key: PLUGIN_VIP_STUDIO }, select: { enabled: true, settings: true } }),
  ]);
  if (!user || !display) return null;

  const servers = usable("servers");
  const [canAcp, canModerate, card, clans] = await Promise.all([
    permissions.can(actor, "acp.access"),
    permissions.can(actor, "mod.access"),
    servers ? bridge.queries.userCard(actor, userId).catch(() => null) : null,
    usable("clans") ? clanQueries.memberClans(userId).catch(() => ({ clans: [] })) : { clans: [] },
  ]);
  const queue = canModerate ? await moderation.queueCount(actor).catch(() => ({ pending: 0, reports: 0 })) : null;

  const href = memberHref(display);
  const groupName = (g: { name: string; title: string | null }) => g.title ?? g.name;
  const groups = [
    { id: user.primaryGroup.id, name: groupName(user.primaryGroup), color: user.primaryGroup.color },
    ...secondary
      .map((s) => s.group)
      .filter((g) => g.id !== user.primaryGroup.id)
      .sort((a, b) => a.position - b.position)
      .map((g) => ({ id: g.id, name: groupName(g), color: g.color })),
  ];

  const content: GcsAccountItem[] = [
    { key: "profile", href, icon: "fa-solid fa-user" },
    { key: "content", href: `${href}?tab=activity`, icon: "fa-solid fa-file-lines" },
    { key: "attachments", href: "/settings/attachments", icon: "fa-solid fa-paperclip", ...(files > 0 ? { count: files } : {}) },
    { key: "following", href: "/settings/following", icon: "fa-solid fa-eye", ...(follows > 0 ? { count: follows } : {}) },
  ];
  const providers = [...new Set(accounts.map((a) => a.providerId).filter((p) => p !== "credential"))].map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  const gaming: GcsAccountItem[] = [
    ...(card ? [{ key: "player", href: playerHref(card.player), icon: "fa-solid fa-crosshairs", ...(card.elo !== null ? { note: `ELO ${card.elo}` } : {}) }] : []),
    ...(clans.clans[0] ? [{ key: "clan", href: clans.clans[0].href, icon: "fa-solid fa-people-group", note: `[${clans.clans[0].tag}]` }] : []),
    ...(servers || usable("clans") ? [{ key: "linked", href: "/settings/account", icon: "fa-solid fa-link", ...(providers.length > 0 ? { note: providers.join(" · ") } : {}) }] : []),
  ];
  const vipUrl = vipStudio?.enabled ? String(((vipStudio.settings ?? {}) as Record<string, unknown>).vipPageUrl ?? "/vip") || "/vip" : null;
  const settings: GcsAccountItem[] = [
    { key: "account", href: "/settings/account", icon: "fa-solid fa-gear" },
    { key: "notifications", href: "/settings/notifications", icon: "fa-solid fa-bell" },
    { key: "privacy", href: "/settings/privacy", icon: "fa-solid fa-lock" },
    ...(vipUrl && vipUrl.startsWith("/") ? [{ key: "vipStudio", href: vipUrl, icon: "fa-solid fa-paintbrush" }] : []),
  ];
  const staff: GcsAccountItem[] = [
    ...(queue ? [{ key: "moderation", href: "/admin/members/moderation/queue", icon: "fa-solid fa-shield-halved", ...(queue.pending + queue.reports > 0 ? { count: queue.pending + queue.reports } : {}) }] : []),
    ...(staffLinks.themeEditor ? [{ key: "themeEditor", href: staffLinks.themeEditor, icon: "fa-solid fa-palette" }] : []),
    ...(staffLinks.pageEditor ? [{ key: "pageEditor", href: "#gcs-page-editor", icon: "fa-solid fa-table-columns" }] : []),
    ...(canAcp ? [{ key: "acp", href: "/admin", icon: "fa-solid fa-screwdriver-wrench" }] : []),
  ];

  return {
    user: { id: display.id, name: display.name, nameKey: display.nameKey, image: display.image, frameKey: display.frameKey, href },
    groups,
    status: normalizePrivacy(user.privacy).showOnline ? "online" : "invisible",
    level: levelProgress(user, ladder),
    stats: { posts: user.postsCount, reputation: user.reputation, elo: card?.elo ?? null },
    sections: [
      { key: "content", items: content },
      ...(gaming.length > 0 ? [{ key: "gaming" as const, items: gaming }] : []),
      { key: "settings", items: settings },
      ...(staff.length > 0 ? [{ key: "staff" as const, items: staff }] : []),
    ],
  };
}
