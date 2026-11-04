import { normalizeUsername, type GcsActor } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { slugify } from "../forums/slug";
import type { GcsForumQueries } from "../forums/queries";
import type { GcsProfileQueries } from "../profile/queries";
import type { GcsServerQueries } from "../servers/queries";

export type GcsApiStats = { topics: number; posts: number; members: number; newestMember: { id: string; name: string; url: string; joinedAt: string } | null };
export type GcsApiTopic = { id: number; title: string; url: string; lastPostAt: string; lastPoster: { id: string; name: string } | null };
export type GcsApiMember = {
  id: string;
  name: string;
  url: string;
  avatar: string | null;
  group: string;
  joinedAt: string;
  posts: number;
  reputation: number;
  followers: number;
  /** `null` = membrul și-a ascuns starea. */
  online: boolean | null;
  lastActiveAt: string | null;
};
export type GcsApiServer = {
  id: number;
  name: string;
  game: string;
  address: string;
  url: string;
  online: boolean | null;
  players: number | null;
  maxPlayers: number | null;
  map: string | null;
  uptime30: number | null;
};

/**
 * Datele rutelor `/api/v1`: doar ce vede un vizitator (forumurile citibile de grupul „guest”, profilurile publice,
 * serverele vizibile), cu adresele absolute ale paginilor.
 */
export class GcsPublicApi {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      forumQueries: Pick<GcsForumQueries, "stats" | "recentTopics">;
      profileQueries: Pick<GcsProfileQueries, "card">;
      serverQueries: Pick<GcsServerQueries, "appEnabled" | "list">;
      baseUrl: () => Promise<string>;
    },
  ) {}

  private async abs(path: string): Promise<string> {
    return `${(await this.deps.baseUrl()).replace(/\/+$/, "")}${path}`;
  }

  async stats(): Promise<GcsApiStats> {
    const s = await this.deps.forumQueries.stats();
    const n = s.newestMember;
    return {
      topics: s.topics,
      posts: s.posts,
      members: s.members,
      newestMember: n ? { id: n.id, name: n.name, url: await this.abs(`/members/${n.id}-${slugify(n.name)}`), joinedAt: n.joinedAt } : null,
    };
  }

  async topics(guest: GcsActor, limit: number): Promise<GcsApiTopic[]> {
    const rows = await this.deps.forumQueries.recentTopics(guest, Math.min(50, Math.max(1, limit)));
    return Promise.all(
      rows.map(async (t) => ({
        id: t.id,
        title: t.title,
        url: await this.abs(`/topic/${t.id}-${t.slug}`),
        lastPostAt: t.lastPostAt,
        lastPoster: t.user ? { id: t.user.id, name: t.user.name } : null,
      })),
    );
  }

  /** Profilul public după nume; `null` = nu există sau nu e vizibil vizitatorilor. */
  async member(guest: GcsActor, name: string): Promise<GcsApiMember | null> {
    const row = await this.deps.db.user.findUnique({ where: { nameNormalized: normalizeUsername(name) }, select: { id: true, isBot: true } });
    if (!row || row.isBot) return null;
    const card = await this.deps.profileQueries.card(guest, row.id);
    if (!card) return null;
    return {
      id: card.user.id,
      name: card.user.name,
      url: await this.abs(`/members/${card.user.id}-${card.user.slug}`),
      avatar: card.user.image ? (card.user.image.startsWith("/") ? await this.abs(card.user.image) : card.user.image) : null,
      group: card.user.group.name,
      joinedAt: card.stats.joinedAt,
      posts: card.stats.posts,
      reputation: card.stats.reputation,
      followers: card.stats.followers,
      online: card.online.hidden ? null : card.online.online,
      lastActiveAt: card.online.hidden ? null : card.online.lastActiveAt,
    };
  }

  /** Serverele vizibile vizitatorilor; `null` = aplicația Servere nu e pornită. */
  async servers(guest: GcsActor): Promise<GcsApiServer[] | null> {
    if (!(await this.deps.serverQueries.appEnabled())) return null;
    const rows = await this.deps.serverQueries.list(guest);
    return Promise.all(
      rows.map(async (s) => ({
        id: s.id,
        name: s.name,
        game: s.game.name,
        address: s.address,
        url: await this.abs(`/servers/${s.id}-${s.slug}`),
        online: s.status ? s.status.online : null,
        players: s.status?.players ?? null,
        maxPlayers: s.status?.maxPlayers ?? null,
        map: s.status?.map ?? null,
        uptime30: s.uptime30,
      })),
    );
  }
}
