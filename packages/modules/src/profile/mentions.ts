import { normalizeGroupName, normalizeUsername, type GcsActor, type GcsCache, type GcsGroupMentionService, type GcsPermissionService } from "@gcs/core";
import { type PrismaClient, sql } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { normalizePrivacy } from "./privacy";

/** Câți membri și câte grupuri arată lista de sugestii a editorului. */
export const MENTION_USER_LIMIT = 10;
export const MENTION_GROUP_LIMIT = 5;
/** Câți membri arată cardul unui grup (cei online primii). */
export const GROUP_CARD_MEMBERS = 12;
const ONLINE_MS = 5 * 60_000;
const CARD_TTL_SEC = 30;

/** Un membru în lista de sugestii: avatarul, numele stilizat și statusul online (ascuns dacă membrul l-a ascuns). */
export type GcsMentionUser = GcsUserRef & { online: boolean };
/** Un grup în lista de sugestii (doar grupurile pe care viewer-ul le poate menționa). */
export type GcsMentionGroupItem = { id: number; key: string; name: string; color: string | null; icon: string | null };
export type GcsGroupCardMember = GcsUserRef & { online: boolean };

/** Cardul unui grup (hover pe pastila `@Grup`): identitatea, contoarele și primii membri (online primii). */
export type GcsGroupCard = {
  id: number;
  key: string;
  name: string;
  /** Titlul grupului (descrierea scurtă din ACP), dacă există. */
  title: string | null;
  color: string | null;
  icon: string | null;
  banner: string | null;
  memberCount: number;
  onlineCount: number;
  members: GcsGroupCardMember[];
  /** Viewer-ul vede lista de membri (`core.members_list`): altfel cardul are doar contoarele. */
  canListMembers: boolean;
};

type CardCore = Omit<GcsGroupCard, "canListMembers">;

const memberSelect = { ...userRefSelect, lastActiveAt: true, privacy: true } as const;
type MemberRow = { id: string; name: string; image: string | null; primaryGroup: { key: string }; nameStyle: { key: string } | null; avatarFrame: { key: string } | null; lastActiveAt: Date | null; privacy: unknown };

/** Online = activ în ultimele 5 minute, doar dacă membrul nu și-a ascuns statusul (ca în lista de membri). */
const isOnline = (row: Pick<MemberRow, "lastActiveAt" | "privacy">, now: number) =>
  normalizePrivacy(row.privacy).showOnline && row.lastActiveAt !== null && now - row.lastActiveAt.getTime() <= ONLINE_MS;

/** Un prefix pentru `LIKE`, cu caracterele speciale (`%`, `_`, `\`) escapate. */
const likePrefix = (s: string) => `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Citirile pentru @mențiuni (Mențiuni v2): sugestiile editorului (membri și grupuri) și cardul unui grup. Căutarea
 * membrilor e un prefix pe numele normalizat, pe indexul `users_nameNormalized_prefix_idx` (colaționare C), deci
 * rămâne rapidă și pe o bază mare: cel mult 10 rezultate, în ordinea indexului (numele exact primul).
 */
export class GcsMentionQueries {
  constructor(
    private readonly deps: { db: PrismaClient; cache: GcsCache; permissions: GcsPermissionService; groupMentions: GcsGroupMentionService },
  ) {}

  async users(query: string, now = Date.now()): Promise<GcsMentionUser[]> {
    const q = normalizeUsername(query);
    if (q.length < 2 || q.length > 40) return [];
    const ids = await this.deps.db.$queryRaw<{ id: string }[]>(sql`
      SELECT id FROM users
      WHERE "nameNormalized" COLLATE "C" LIKE ${likePrefix(q)}
      ORDER BY "nameNormalized" COLLATE "C"
      LIMIT ${MENTION_USER_LIMIT}`);
    if (ids.length === 0) return [];
    const rows = await this.deps.db.user.findMany({ where: { id: { in: ids.map((r) => r.id) } }, select: memberSelect });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap(({ id }) => {
      const row = byId.get(id);
      return row ? [{ ...toRef(row), online: isOnline(row, now) }] : [];
    });
  }

  /** Grupurile pe care viewer-ul le poate menționa, al căror nume începe cu textul scris (fără text: primele). */
  async groups(actor: GcsActor, query: string): Promise<GcsMentionGroupItem[]> {
    const q = normalizeGroupName(query);
    const groups = await this.deps.groupMentions.mentionableBy(actor);
    return groups
      .filter((g) => normalizeGroupName(g.name).startsWith(q))
      .slice(0, MENTION_GROUP_LIMIT)
      .map((g) => ({ id: g.id, key: g.key, name: g.name, color: g.color, icon: g.icon }));
  }

  /**
   * Cardul unui grup. `null` pentru un grup care nu poate fi menționat și nu apare în legendă (nu se expune). Partea
   * comună e cache-uită 30 s (aceeași pentru toți); lista de membri o primește doar cine poate vedea lista de membri.
   */
  async card(viewer: GcsActor, groupId: number, now = Date.now()): Promise<GcsGroupCard | null> {
    const group = await this.deps.groupMentions.group(groupId);
    if (!group || (!group.mentionable && !group.inLegend)) return null;
    const core = await this.cardCore(groupId, now);
    if (!core) return null;
    const canListMembers = !viewer.isBanned && (await this.deps.permissions.can(viewer, "core.members_list"));
    return { ...core, members: canListMembers ? core.members : [], canListMembers };
  }

  private async cardCore(groupId: number, now: number): Promise<CardCore | null> {
    const { db, cache } = this.deps;
    const key = `groups:card:${groupId}`;
    const cached = await cache.get<CardCore>(key);
    if (cached) return cached;
    const group = await db.group.findUnique({ where: { id: groupId }, select: { id: true, key: true, name: true, title: true, color: true, icon: true, banner: true } });
    if (!group) return null;
    const since = new Date(now - ONLINE_MS);
    // Membrii: grupul principal sau secundar. Online = activ recent și cu statusul vizibil (lipsa setării = vizibil).
    const [counts] = await db.$queryRaw<{ total: number; online: number }[]>(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE u."lastActiveAt" >= ${since.toISOString()}::timestamp AND COALESCE((u.privacy->>'showOnline')::boolean, true))::int AS online
      FROM users u
      WHERE u."primaryGroupId" = ${groupId} OR EXISTS (SELECT 1 FROM user_groups ug WHERE ug."userId" = u.id AND ug."groupId" = ${groupId})`);
    const top = await db.$queryRaw<{ id: string }[]>(sql`
      SELECT u.id FROM users u
      WHERE u."primaryGroupId" = ${groupId} OR EXISTS (SELECT 1 FROM user_groups ug WHERE ug."userId" = u.id AND ug."groupId" = ${groupId})
      ORDER BY (u."lastActiveAt" >= ${since.toISOString()}::timestamp AND COALESCE((u.privacy->>'showOnline')::boolean, true)) DESC NULLS LAST,
               u."lastActiveAt" DESC NULLS LAST, u.id
      LIMIT ${GROUP_CARD_MEMBERS}`);
    const rows = top.length > 0 ? await db.user.findMany({ where: { id: { in: top.map((r) => r.id) } }, select: memberSelect }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const members = top.flatMap(({ id }) => {
      const row = byId.get(id);
      return row ? [{ ...toRef(row), online: isOnline(row, now) }] : [];
    });
    const card: CardCore = { ...group, memberCount: counts?.total ?? 0, onlineCount: counts?.online ?? 0, members };
    // `name-styles`: orice schimbare a grupurilor (nume, culoare, setări) invalidează cardul.
    await cache.set(key, card, { ttlSec: CARD_TTL_SEC, tags: ["name-styles"] });
    return card;
  }
}
