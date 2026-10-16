import "server-only";
import { GcsError, type GcsActor } from "@gcs/core";
import { playerHref, serverHref } from "../app/(site)/_components/servers/types";
import { memberHref, postHref, topicHref } from "./forum-urls";
import { availableScopes, periodSince, type GcsQuickResult, type GcsSearchFilters, type GcsSearchScope } from "./quick-search";
import { visibleServers } from "./live-summary.server";
import { services } from "./services";

/** Câte rezultate rapide pe domeniu (în „Tot”: puține din fiecare). */
const PER_SCOPE = 6;
const PER_SCOPE_ALL: Partial<Record<GcsSearchScope, number>> = { topics: 3, members: 2, servers: 2, players: 2, clans: 2 };

/** Domeniile căutării pentru viewer (doar aplicațiile pornite și accesibile, cu drepturile lor). */
export async function searchScopes(actor: GcsActor): Promise<GcsSearchScope[]> {
  const { apps, permissions, bridge } = services();
  const usable = await apps.accessFilter(actor);
  const [members, players] = await Promise.all([permissions.can(actor, "core.members_list"), usable("servers") ? bridge.queries.canViewStats(actor).catch(() => false) : false]);
  return availableScopes({ members, servers: usable("servers"), players, clans: usable("clans") });
}

/**
 * Rezultatele rapide ale panoului de căutare: topicuri / postări (căutarea forumului, cu filtrele), membri, servere,
 * jucători și clanuri. Un domeniu care eșuează (drept lipsă, prea multe căutări) lipsește, fără să strice restul;
 * `limited` spune că limita de căutări a fost atinsă.
 */
export async function quickSearch(actor: GcsActor, q: string, scope: GcsSearchScope, filters: GcsSearchFilters): Promise<{ results: GcsQuickResult[]; limited: boolean }> {
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return { results: [], limited: false };
  const scopes = await searchScopes(actor);
  if (!scopes.includes(scope)) return { results: [], limited: false };
  const { search, memberList, clanQueries, bridge } = services();
  const wanted = (s: GcsSearchScope) => (scope === "all" ? s !== "posts" && scopes.includes(s) : scope === s);
  const take = (s: GcsSearchScope) => (scope === "all" ? (PER_SCOPE_ALL[s] ?? 2) : PER_SCOPE);
  let limited = false;
  const safe = async <T>(fn: () => Promise<T[]>): Promise<T[]> =>
    fn().catch((error: unknown) => {
      if (error instanceof GcsError && error.status === 429) limited = true;
      return [];
    });

  const forum = async (type: "topics" | "posts"): Promise<GcsQuickResult[]> => {
    const since = periodSince(filters.period);
    const { results } = await search.search(actor, {
      q: term,
      type: filters.titles ? "topics" : type,
      page: 1,
      ...(filters.forum ? { forumId: filters.forum } : {}),
      ...(filters.author.trim() ? { authorName: filters.author.trim() } : {}),
      ...(since ? { since } : {}),
    });
    return results.slice(0, take(type)).map((r) =>
      type === "topics" || filters.titles
        ? { type: "topic", title: r.topicTitle, href: topicHref({ id: r.topicId, slug: r.topicSlug }), meta: r.forumName }
        : { type: "post", title: r.topicTitle, href: postHref(r.topicId, r.postId), meta: r.author?.name ?? r.forumName },
    );
  };

  const groups = await Promise.all([
    wanted("topics") ? safe(() => forum("topics")) : [],
    wanted("posts") ? safe(() => forum("posts")) : [],
    wanted("members")
      ? safe(async () =>
          (await memberList.list(actor, { q: term, page: 1 })).members.slice(0, take("members")).map(
            (m): GcsQuickResult => ({ type: "member", title: m.name, href: memberHref(m), meta: m.group.name, user: { id: m.id, name: m.name, nameKey: m.nameKey } }),
          ),
        )
      : [],
    wanted("servers")
      ? safe(async () => {
          const needle = term.toLowerCase();
          return (await visibleServers(actor))
            .filter((s) => s.name.toLowerCase().includes(needle) || (s.status?.map ?? "").toLowerCase().includes(needle))
            .slice(0, take("servers"))
            .map((s): GcsQuickResult => ({
              type: "server",
              title: s.name,
              href: serverHref(s),
              meta: s.status?.online ? `${s.status.map ?? ""} · ${s.status.players}/${s.status.maxPlayers}`.replace(/^ · /, "") : null,
            }));
        })
      : [],
    wanted("players")
      ? safe(async () => (await bridge.queries.searchPlayers(actor, term)).slice(0, take("players")).map((p): GcsQuickResult => ({ type: "player", title: p.name, href: playerHref(p), meta: null })))
      : [],
    wanted("clans")
      ? safe(async () =>
          (await clanQueries.directory(actor, { q: term, page: 1 })).clans.slice(0, take("clans")).map((c): GcsQuickResult => ({ type: "clan", title: `[${c.tag}] ${c.name}`, href: c.href, meta: null })),
        )
      : [],
  ]);
  return { results: groups.flat(), limited };
}
