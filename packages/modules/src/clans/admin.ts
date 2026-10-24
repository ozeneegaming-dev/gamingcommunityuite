import { GcsValidationError, settingValueError, type GcsAcpRoleService, type GcsActor, type GcsEventBus, type GcsModuleRegistry, type GcsPermissionService, type GcsSettingsService } from "@gcs/core";
import { type Prisma, type PrismaClient, jsonHas, jsonStrings, ci } from "@gcs/db";
import { toRef, userRefSelect, type GcsPagination, type GcsUserRef } from "../forums/queries";
import { syncClanForumStaff } from "./forum";
import { CLAN_SETTING, CLAN_SETTINGS, readClanOptions } from "./options";
import { toClanCard, type GcsClanCard } from "./queries";
import { CLANS_ACP_SECTION, CLANS_CACHE_TAG, CLANS_SETTINGS_ACP_SECTION, type GcsClanService } from "./service";

export const GCS_CLAN_ACP_FILTERS = ["pending", "active", "archived", "locked", "all"] as const;
export type GcsClanAcpFilter = (typeof GCS_CLAN_ACP_FILTERS)[number];
const ACP_PER_PAGE = 30;
const AUDIT_LIMIT = 30;

export type GcsClanAcpRow = GcsClanCard & { leader: GcsUserRef | null; createdAt: string; forumId: number | null; memberLimit: number | null; lockReason: string | null };
export type GcsClanAuditEntry = { id: string; action: string; at: string; actor: GcsUserRef | null; before: unknown; after: unknown };

const filterWhere = (filter: GcsClanAcpFilter): Prisma.ClanWhereInput =>
  filter === "pending" ? { status: "PENDING" } : filter === "active" ? { status: "ACTIVE" } : filter === "archived" ? { status: "ARCHIVED" } : filter === "locked" ? { locked: true } : {};

/**
 * ACP → Gaming → Clanuri (specul 2026-10-08-clanuri §8): lista pe stări, fișa unui clan cu jurnalul lui și salvarea
 * opțiunilor (cu efectele lor: drepturile ofițerilor scoase, staff-ul forumurilor private). Acțiunile pe un clan
 * (aprobare, blocare, transfer, desființare) sunt în `GcsClanService`.
 */
export class GcsClanAdmin {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      acp: GcsAcpRoleService;
      settings: GcsSettingsService;
      permissions: GcsPermissionService;
      bus: GcsEventBus;
      registry: GcsModuleRegistry;
      clans: GcsClanService;
    },
  ) {}

  async list(actor: GcsActor, query: { filter: GcsClanAcpFilter; q?: string; page?: number }): Promise<{ rows: GcsClanAcpRow[]; counts: Record<GcsClanAcpFilter, number>; pagination: GcsPagination }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CLANS_ACP_SECTION, "view");
    const q = (query.q ?? "").trim().slice(0, 40);
    const where: Prisma.ClanWhereInput = {
      ...filterWhere(query.filter),
      ...(q ? { OR: [{ tag: ci({ contains: q }) }, { name: ci({ contains: q }) }] } : {}),
    };
    const counts = Object.fromEntries(
      await Promise.all(GCS_CLAN_ACP_FILTERS.map(async (f) => [f, await db.clan.count({ where: filterWhere(f) })] as const)),
    ) as Record<GcsClanAcpFilter, number>;
    const total = await db.clan.count({ where });
    const pages = Math.max(1, Math.ceil(total / ACP_PER_PAGE));
    const page = Math.min(Math.max(1, query.page ?? 1), pages);
    const rows = await db.clan.findMany({
      where,
      orderBy: query.filter === "pending" ? [{ createdAt: "asc" }] : [{ createdAt: "desc" }],
      skip: (page - 1) * ACP_PER_PAGE,
      take: ACP_PER_PAGE,
      include: { members: { where: { role: "LEADER" }, select: { user: { select: userRefSelect } } } },
    });
    return {
      rows: rows.map((c) => ({
        ...toClanCard(c),
        leader: c.members[0] ? toRef(c.members[0].user) : null,
        createdAt: c.createdAt.toISOString(),
        forumId: c.forumId,
        memberLimit: c.memberLimit,
        lockReason: c.lockReason,
      })),
      counts,
      pagination: { page, pages, perPage: ACP_PER_PAGE, total },
    };
  }

  /** Fișa unui clan: datele, membrii (cu rolurile) și ultimele intrări din jurnalul lui. */
  async detail(actor: GcsActor, clanId: number) {
    const { db, acp, clans } = this.deps;
    await acp.assert(actor, CLANS_ACP_SECTION, "view");
    const clan = Number.isInteger(clanId)
      ? await db.clan.findUnique({ where: { id: clanId }, include: { members: { orderBy: [{ role: "asc" }, { joinedAt: "asc" }], select: { role: true, joinedAt: true, user: { select: userRefSelect } } } } })
      : null;
    if (!clan) return null;
    const log = await db.auditLog.findMany({ where: { targetType: "clan", targetId: String(clanId) }, orderBy: { createdAt: "desc" }, take: AUDIT_LIMIT });
    const actorIds = [...new Set(log.map((l) => l.actorId).filter((id): id is string => id !== null))];
    const actors = new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: userRefSelect })).map((u) => [u.id, toRef(u)] as const));
    return {
      clan: {
        ...toClanCard(clan),
        createdAt: clan.createdAt.toISOString(),
        forumId: clan.forumId,
        memberLimit: clan.memberLimit,
        effectiveLimit: await clans.memberLimit(clan),
        lockReason: clan.lockReason,
      },
      members: clan.members.map((m) => ({ user: toRef(m.user), role: m.role, joinedAt: m.joinedAt.toISOString() })),
      audit: log.map((l): GcsClanAuditEntry => ({ id: l.id, action: l.action, at: l.createdAt.toISOString(), actor: l.actorId ? (actors.get(l.actorId) ?? null) : null, before: l.before, after: l.after })),
    };
  }

  /**
   * Salvează opțiunile (doar cele schimbate, fiecare cu jurnalul setărilor), după validarea fiecăreia și a regulilor
   * dintre ele: `tag_min ≤ tag_max`, categoria forumurilor (o categorie sau un forum existent), grupurile de staff.
   * Efecte: drepturile ofițerilor scoase dispar din clanuri; staff-ul forumurilor private se rescrie.
   */
  async saveOptions(actor: GcsActor, values: Record<string, unknown>): Promise<void> {
    const { db, acp, settings, permissions, bus } = this.deps;
    await acp.assert(actor, CLANS_SETTINGS_ACP_SECTION, "edit");
    const before = await readClanOptions(settings);
    const errors: Record<string, string> = {};
    const changed: [string, unknown][] = [];
    for (const def of CLAN_SETTINGS) {
      if (!(def.key in values)) continue;
      const value = values[def.key];
      const error = settingValueError(def, value);
      if (error) {
        errors[def.key] = error;
        continue;
      }
      if (JSON.stringify(await settings.get(def.key)) !== JSON.stringify(value)) changed.push([def.key, value]);
    }
    const next = (key: string) => (key in values ? values[key] : undefined);
    const tagMin = (next(CLAN_SETTING.tagMin) ?? before.tagMin) as number;
    const tagMax = (next(CLAN_SETTING.tagMax) ?? before.tagMax) as number;
    if (!errors[CLAN_SETTING.tagMin] && !errors[CLAN_SETTING.tagMax] && tagMin > tagMax) errors[CLAN_SETTING.tagMax] = "tag_range";
    const parent = next(CLAN_SETTING.forumParent);
    if (typeof parent === "number" && parent > 0 && !errors[CLAN_SETTING.forumParent]) {
      const forum = await db.forum.findUnique({ where: { id: parent }, select: { type: true } });
      if (!forum || forum.type === "LINK") errors[CLAN_SETTING.forumParent] = "invalid_parent";
    }
    const staffGroups = next(CLAN_SETTING.forumStaffGroups);
    if (Array.isArray(staffGroups) && !errors[CLAN_SETTING.forumStaffGroups]) {
      const known = await db.group.count({ where: { key: { in: staffGroups as string[] } } });
      if (known !== new Set(staffGroups).size) errors[CLAN_SETTING.forumStaffGroups] = "invalid_choice";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    for (const [key, value] of changed) await settings.set(key, value, actor);
    const after = await readClanOptions(settings);

    // Drepturile ofițerilor care nu mai sunt permise dispar din toate clanurile (și din drepturile pe forum).
    const removedRights = before.officerRights.filter((r) => !after.officerRights.includes(r));
    if (removedRights.length > 0) {
      const affected = (await db.clan.findMany({ where: { OR: removedRights.map((r) => ({ officerRights: jsonHas(r) })) }, select: { id: true, officerRights: true } })).filter((c) =>
        jsonStrings(c.officerRights).some((r) => removedRights.includes(r as never)),
      );
      for (const c of affected) await db.clan.update({ where: { id: c.id }, data: { officerRights: jsonStrings(c.officerRights).filter((r) => after.officerRights.includes(r as never)) } });
      const officers = await db.clanMember.findMany({ where: { role: "OFFICER", clanId: { in: affected.map((c) => c.id) } }, select: { userId: true } });
      await permissions.invalidateMemberGrants(officers.map((o) => o.userId));
    }
    // Staff-ul forumurilor private.
    if (JSON.stringify(before.forumStaffGroups) !== JSON.stringify(after.forumStaffGroups)) {
      const forums = (await db.clan.findMany({ where: { forumId: { not: null } }, select: { forumId: true } })).map((c) => c.forumId!);
      await db.$transaction(async (tx) => syncClanForumStaff(tx, forums, before.forumStaffGroups, after.forumStaffGroups));
      await permissions.bumpVersion();
      await bus.emit({ name: "forum.updated", payload: { forumIds: forums }, tags: ["forums-tree"] });
    }
    // Ponderile clasamentului: locurile se refac imediat.
    if (JSON.stringify(before.weights) !== JSON.stringify(after.weights)) await this.deps.clans.recompute(null);
    await bus.emit({ name: "clans.updated", payload: { clanId: null }, tags: [CLANS_CACHE_TAG] });
  }
}
