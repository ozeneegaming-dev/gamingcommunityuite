import { GcsNotFound, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEventBus } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { SERVERS_ACP_SECTION } from "../service";
import { cssPermissions, mergeGrants, normalizeFlags } from "./flags";
import type { GcsBridgeStore } from "./store";
import { authOf, identityKey, unix, type GcsBridgeAuth, type GcsBridgeServer } from "./types";

/** Un grup VIP pe server, în ACP. */
export type GcsVipMappingView = { groupId: number; name: string; color: string | null; enabled: boolean; flags: string };
export type GcsVipMappingInput = { groupId: number; enabled: boolean; flags: string };

/** O intrare din lista `/vip` (§6.7). */
export type GcsBridgeVipEntry = { auth: GcsBridgeAuth; flags: string; permissions: string[]; expiresAt: number | null; group: string };

/** Evenimentele VIP care schimbă listele serverelor. */
const VIP_EVENTS = ["vip.granted", "vip.extended", "vip.revoked", "vip.expired"];

/**
 * VIP-ul pe servere (specul 2026-10-08-servere-bridge §12): fiecare grup VIP, pornit / oprit pe fiecare server, cu
 * flag-urile lui; lista efectivă = abonamentele VIP active ale grupurilor pornite → identitățile Steam și non-Steam
 * legate de membru (niciodată cele pe nume).
 */
export class GcsBridgeVip {
  constructor(private readonly deps: { db: PrismaClient; acp: GcsAcpRoleService; store: GcsBridgeStore; now?: () => number }) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  /** Orice schimbare de abonament VIP face listele să primească un ETag nou. */
  listen(bus: GcsEventBus): void {
    for (const name of VIP_EVENTS) bus.on(name, async () => this.deps.store.bumpVersion());
  }

  async mappings(actor: GcsActor, serverId: number): Promise<GcsVipMappingView[]> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "view");
    const [groups, rows] = await Promise.all([
      db.group.findMany({ where: { isVip: true }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, color: true } }),
      db.gameVipMapping.findMany({ where: { serverId } }),
    ]);
    const byGroup = new Map(rows.map((r) => [r.groupId, r]));
    return groups.map((g) => ({ groupId: g.id, name: g.name, color: g.color, enabled: byGroup.get(g.id)?.enabled ?? false, flags: byGroup.get(g.id)?.flags ?? "b" }));
  }

  async saveMappings(actor: GcsActor, serverId: number, items: GcsVipMappingInput[]): Promise<void> {
    const { db, acp, store } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    if (!(await db.gameServer.findUnique({ where: { id: serverId }, select: { id: true } }))) throw new GcsNotFound();
    const vipGroups = new Set((await db.group.findMany({ where: { isVip: true }, select: { id: true } })).map((g) => g.id));
    const errors: Record<string, string> = {};
    const clean = (Array.isArray(items) ? items : []).map((item) => {
      const flags = normalizeFlags(item.flags);
      if (!vipGroups.has(item.groupId)) errors[`vip.${item.groupId}`] = "invalid";
      else if (item.enabled && !flags) errors[`vip.${item.groupId}.flags`] = "required";
      return { groupId: item.groupId, enabled: item.enabled === true, flags: flags || "b" };
    });
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    await db.$transaction(async (tx) => {
      for (const item of clean) {
        await tx.gameVipMapping.upsert({ where: { serverId_groupId: { serverId, groupId: item.groupId } }, create: { serverId, ...item }, update: { enabled: item.enabled, flags: item.flags } });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "servers.vip.update", targetType: "game_server", targetId: String(serverId), after: clean, ip: actor.ip });
    });
    await store.bumpVersion();
  }

  /** Lista `/vip` a serverului: o intrare pe identitate (reuniunea flag-urilor, expirarea cea mai târzie). */
  async serverList(server: Pick<GcsBridgeServer, "id" | "game">): Promise<GcsBridgeVipEntry[]> {
    return this.deps.store.cachedList("vip", server.id, async () => {
      const { db } = this.deps;
      const now = this.now();
      const mappings = await db.gameVipMapping.findMany({ where: { serverId: server.id, enabled: true }, include: { group: { select: { name: true } } }, orderBy: { groupId: "asc" } });
      if (mappings.length === 0) return [];
      const byGroup = new Map(mappings.map((m) => [m.groupId, m]));
      const subs = await db.vipSubscription.findMany({
        where: { status: "ACTIVE", groupId: { in: [...byGroup.keys()] }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { groupId: true, expiresAt: true, user: { select: { gamePlayers: { where: { kind: { in: ["STEAM", "NONSTEAM"] } }, select: { kind: true, value: true }, orderBy: { id: "asc" } } } } },
        orderBy: { id: "asc" },
      });
      const out = new Map<string, { auth: GcsBridgeAuth; grants: { flags: string; immunity: number; expiresAt: Date | null }[]; group: string }>();
      for (const sub of subs) {
        const mapping = byGroup.get(sub.groupId)!;
        for (const p of sub.user.gamePlayers) {
          const auth = authOf(p.kind, p.value, server.game);
          if (!auth) continue;
          const key = identityKey(p.kind, p.value);
          const grant = { flags: mapping.flags, immunity: 0, expiresAt: sub.expiresAt };
          const current = out.get(key);
          if (current) current.grants.push(grant);
          else out.set(key, { auth, grants: [grant], group: mapping.group.name });
        }
      }
      return [...out.values()].map((v) => {
        const merged = mergeGrants(v.grants);
        return { auth: v.auth, flags: merged.flags, permissions: cssPermissions(merged.flags), expiresAt: unix(merged.expiresAt), group: v.group };
      });
    });
  }
}
