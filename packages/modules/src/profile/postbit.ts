import type { GcsActor, GcsCache, GcsPermissionService, GcsSettingsService } from "@gcs/core";
import type { FieldVisibility, PrismaClient, ProfileFieldType } from "@gcs/db";
import { badgeArtSrc } from "@gcs/ui/badge-art";
import { normalizePrivacy } from "./privacy";

/** „Online” în postbit = activitate în ultimele 5 minute (ca prezența din etapa 4). */
const ONLINE_MS = 5 * 60_000;
const RECENT_BADGES = 5;
const FIELDS_KEY = "profile:postbit-fields";
/** Scara rangurilor (toate, cu poziția): pragurile de XP și nivelul rangului (coroanele din postbit). */
const LADDER_KEY = "profile:rank-ladder";
/** Motto-ul din postbit: ultimul status al membrului, ca text, scurtat. */
const MOTTO_MAX = 140;

export type GcsPostbitField = { key: string; label: string; icon: string | null; type: ProfileFieldType; value: string; image: string | null };
/** `art` = adresa insignei generate (specul 2026-10-07-insigne-grafice); `image` = imaginea proprie, dacă există. */
export type GcsPostbitBadge = { key: string; name: string; description: string; symbol: string | null; color: string; image: string | null; art: string };

/** Tot ce arată cardul autorului lângă o postare (specul etapei 5, „Postbit”). */
export type GcsPostbitData = {
  customTitle: string | null;
  group: { key: string; name: string; color: string | null; icon: string | null; banner: string | null };
  vip: boolean;
  /** Numele planului VIP activ (grupul abonamentului), dacă există. */
  vipName: string | null;
  /** Titlul unui grup secundar (primul după poziție), dacă există. */
  secondaryGroup: string | null;
  /** Nivelul rangului obținut (1 = primul din scară, după poziție) → coroanele din postbit; `null` = fără rang. */
  rankLevel: number | null;
  /** Topicurile vizibile pornite de membru. */
  topicsCount: number;
  /** Ultimul status (motto) al membrului, ca text scurtat; `null` dacă nu are sau profilul nu e vizibil viewer-ului. */
  motto: string | null;
  /** XP = punctele din realizări; progresul spre următorul rang cu prag de puncte. */
  xp: { points: number; floor: number; next: number | null; nextRank: string | null; percent: number };
  badges: { count: number; recent: GcsPostbitBadge[] };
  fields: GcsPostbitField[];
  online: boolean;
  joinedAt: string;
};

type FieldDef = { id: number; key: string; label: string; icon: string | null; type: ProfileFieldType; visibility: FieldVisibility; optionImages: Record<string, string> };
type Rung = { name: string; minPoints: number };
type LadderRank = { id: number; name: string; minPoints: number | null; position: number };

/** Textul simplu al unui status (HTML sanitizat de renderer), scurtat la `max` caractere cu „…”. */
export function mottoText(html: string, max = MOTTO_MAX): string | null {
  const text = html
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|blockquote)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Progresul XP: pragul rangului atins și pragul următor (rangurile cu `minPoints`). */
export function xpProgress(points: number, ladder: Rung[]): GcsPostbitData["xp"] {
  const sorted = [...ladder].sort((a, b) => a.minPoints - b.minPoints);
  const floor = sorted.filter((r) => r.minPoints <= points).at(-1)?.minPoints ?? 0;
  const next = sorted.find((r) => r.minPoints > points) ?? null;
  const percent = next ? Math.max(0, Math.min(100, Math.round(((points - floor) / Math.max(1, next.minPoints - floor)) * 100))) : 100;
  return { points, floor, next: next?.minPoints ?? null, nextRank: next?.name ?? null, percent };
}

/**
 * Datele postbit-ului pentru toți autorii unei pagini, cu un număr fix de interogări (nu crește cu autorii):
 * userii, VIP-urile active, numărul de insigne, ultimele 5 insigne (o interogare cu `row_number`), valorile câmpurilor
 * din postbit, numărul de topicuri (grupat), grupurile secundare și ultimul status (`DISTINCT ON`). Câmpurile și scara
 * rangurilor vin din cache. Câmpurile respectă vizibilitatea lor (public / membri / staff).
 */
export class GcsPostbitService {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; permissions: GcsPermissionService; settings: GcsSettingsService }) {}

  /** Câmpurile marcate „în postbit”, în ordinea din ACP (`postbit.fields`), apoi după poziție. */
  async fieldDefs(): Promise<FieldDef[]> {
    const { db, cache, settings } = this.deps;
    const cached = await cache.get<FieldDef[]>(FIELDS_KEY);
    if (cached) return cached;
    const [rows, order] = await Promise.all([
      db.profileField.findMany({ where: { showInPostbit: true }, orderBy: [{ position: "asc" }, { id: "asc" }] }),
      settings.get<string[]>("postbit.fields").catch((): string[] => []),
    ]);
    const rank = (key: string) => {
      const i = Array.isArray(order) ? order.indexOf(key) : -1;
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const defs = rows
      .map((f) => ({
        id: f.id,
        key: f.key,
        label: f.label,
        icon: f.icon,
        type: f.type,
        visibility: f.visibility,
        optionImages: (f.optionImages && typeof f.optionImages === "object" ? f.optionImages : {}) as Record<string, string>,
      }))
      .sort((a, b) => rank(a.key) - rank(b.key));
    // `profile-fields` e invalidat de editarea câmpurilor; `settings` de schimbarea ordinii.
    await cache.set(FIELDS_KEY, defs, { ttlSec: 3600, tags: ["profile-fields", "settings"] });
    return defs;
  }

  /** Toate rangurile, în ordinea ierarhiei (poziția, apoi id-ul). */
  private async ladder(): Promise<LadderRank[]> {
    const { db, cache } = this.deps;
    const cached = await cache.get<LadderRank[]>(LADDER_KEY);
    if (cached) return cached;
    const ladder = await db.rank.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, minPoints: true, position: true } });
    await cache.set(LADDER_KEY, ladder, { ttlSec: 3600, tags: ["ranks"] });
    return ladder;
  }

  async forAuthors(viewer: GcsActor, userIds: string[], now = Date.now()): Promise<Map<string, GcsPostbitData>> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, GcsPostbitData>();
    if (ids.length === 0) return out;
    const { db, permissions } = this.deps;
    const [defs, ladder] = await Promise.all([this.fieldDefs(), this.ladder()]);
    const xpLadder = ladder.flatMap((r) => (r.minPoints === null ? [] : [{ name: r.name, minPoints: r.minPoints }]));
    const levels = new Map(ladder.map((r, i) => [r.id, i + 1]));
    const [users, vips, counts, recent, values, seeStaff, topics, secondary, statuses] = await Promise.all([
      db.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          customTitle: true,
          points: true,
          createdAt: true,
          lastActiveAt: true,
          privacy: true,
          rankId: true,
          primaryGroupId: true,
          primaryGroup: { select: { key: true, name: true, title: true, color: true, icon: true, banner: true } },
        },
      }),
      db.vipSubscription.findMany({
        where: { userId: { in: ids }, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] },
        select: { userId: true, groupId: true, group: { select: { name: true, title: true } } },
      }),
      db.userBadge.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { _all: true } }),
      db.$queryRaw<
        {
          userId: string;
          key: string;
          name: string;
          description: string;
          symbol: string | null;
          color: string;
          imageAttachmentId: string | null;
          manual: boolean;
          artShape: string | null;
          artTier: string | null;
          artIcon: string | null;
        }[]
      >`
        SELECT r."userId", b."key", b."name", b."description", b."symbol", b."color", b."imageAttachmentId", b."manual", b."artShape", b."artTier", b."artIcon"
        FROM (
          SELECT ub."userId", ub."badgeId", ub."createdAt",
                 row_number() OVER (PARTITION BY ub."userId" ORDER BY ub."createdAt" DESC, ub."id" DESC) AS rn
          FROM "user_badges" ub
          WHERE ub."userId" = ANY(${ids})
        ) r
        JOIN "badges" b ON b."id" = r."badgeId"
        WHERE r.rn <= ${RECENT_BADGES}
        ORDER BY r."userId", r.rn`,
      defs.length === 0
        ? Promise.resolve([])
        : db.profileFieldValue.findMany({ where: { userId: { in: ids }, fieldId: { in: defs.map((d) => d.id) } }, select: { userId: true, fieldId: true, value: true } }),
      viewer.userId !== null ? permissions.can(viewer, "profile.see_private_fields") : Promise.resolve(false),
      db.topic.groupBy({ by: ["authorId"], where: { authorId: { in: ids }, visibility: "VISIBLE" }, _count: { _all: true } }),
      db.userGroup.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, groupId: true, group: { select: { name: true, title: true, position: true } } },
        orderBy: [{ group: { position: "asc" } }, { groupId: "asc" }],
      }),
      // Ultimul status scris de membru pe propriul perete (fără răspunsuri), unul per autor, într-o singură interogare.
      db.$queryRaw<{ userId: string; contentHtml: string }[]>`
        SELECT DISTINCT ON (s."profileUserId") s."profileUserId" AS "userId", s."contentHtml"
        FROM "status_updates" s
        WHERE s."profileUserId" = ANY(${ids})
          AND s."authorId" = s."profileUserId"
          AND s."parentId" IS NULL
          AND s."visibility" = 'VISIBLE'
        ORDER BY s."profileUserId", s."createdAt" DESC, s."id" DESC`,
    ]);

    const vipMap = new Map(vips.map((v) => [v.userId, v]));
    const topicMap = new Map(topics.map((c) => [c.authorId, c._count._all]));
    const mottoMap = new Map(statuses.map((s) => [s.userId, s.contentHtml]));
    const countMap = new Map(counts.map((c) => [c.userId, c._count._all]));
    const valueMap = new Map(values.map((v) => [`${v.userId}:${v.fieldId}`, v.value]));
    for (const u of users) {
      const own = viewer.userId === u.id;
      const allowed = (v: FieldVisibility) => own || v === "PUBLIC" || (v === "MEMBERS" && viewer.userId !== null) || (v === "STAFF" && seeStaff);
      const fields = defs.flatMap((d) => {
        const value = valueMap.get(`${u.id}:${d.id}`);
        if (!value || !allowed(d.visibility)) return [];
        const image = d.type === "IMAGE_SELECT" ? (d.optionImages[value] ?? null) : null;
        return [{ key: d.key, label: d.label, icon: d.icon, type: d.type, value, image }];
      });
      const privacy = normalizePrivacy(u.privacy);
      const vip = vipMap.get(u.id);
      const second = secondary.find((g) => g.userId === u.id && g.groupId !== u.primaryGroupId && g.groupId !== vip?.groupId);
      // Motto-ul vine de pe perete: îl arătăm doar dacă profilul e vizibil viewer-ului („doar urmăritori” → doar autorului).
      const profileVisible = own || privacy.profile === "PUBLIC" || (privacy.profile === "MEMBERS" && viewer.userId !== null);
      const motto = profileVisible ? mottoText(mottoMap.get(u.id) ?? "") : null;
      out.set(u.id, {
        customTitle: u.customTitle,
        group: { key: u.primaryGroup.key, name: u.primaryGroup.title ?? u.primaryGroup.name, color: u.primaryGroup.color, icon: u.primaryGroup.icon, banner: u.primaryGroup.banner },
        vip: vip !== undefined,
        vipName: vip ? (vip.group.title ?? vip.group.name) : null,
        secondaryGroup: second ? (second.group.title ?? second.group.name) : null,
        rankLevel: u.rankId !== null ? (levels.get(u.rankId) ?? null) : null,
        topicsCount: topicMap.get(u.id) ?? 0,
        motto,
        xp: xpProgress(u.points, xpLadder),
        badges: {
          count: countMap.get(u.id) ?? 0,
          recent: recent
            .filter((b) => b.userId === u.id)
            .map((b) => ({
              key: b.key,
              name: b.name,
              description: b.description,
              symbol: b.symbol,
              color: b.color,
              image: b.imageAttachmentId ? `/files/${b.imageAttachmentId}` : null,
              art: badgeArtSrc(b),
            })),
        },
        fields,
        online: privacy.showOnline && u.lastActiveAt !== null && now - u.lastActiveAt.getTime() <= ONLINE_MS,
        joinedAt: u.createdAt.toISOString(),
      });
    }
    return out;
  }
}
