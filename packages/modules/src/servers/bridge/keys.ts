import { GcsNotFound, GcsValidationError, openSecret, sealSecret, writeAudit, type GcsAcpRoleService, type GcsActor } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { SERVERS_ACP_SECTION } from "../service";
import { generateBridgeKey } from "./signing";

/** Max chei active pe server (§5.4); cheile rotite, în perioada de grație, nu se numără. */
export const MAX_ACTIVE_KEYS = 5;
/** Cât rămâne valabilă cheia veche după rotire (cât să se schimbe configul pe server). */
export const ROTATE_GRACE_MS = 10 * 60_000;
const LABEL_MAX = 60;
/** `lastUsedAt` / `lastIp` se scriu cel mult o dată pe minut (nu la fiecare cerere). */
const TOUCH_MS = 60_000;

export type GcsBridgeKeyRow = {
  id: number;
  keyId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastIp: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  active: boolean;
};

/** O cheie verificată la o cerere: `signingKey` = K, desigilat. */
export type GcsBridgeKeyAuth = { id: number; keyId: string; serverId: number; signingKey: string; lastUsedAt: Date | null };

const label = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX) : "");

/**
 * Cheile API ale serverelor (specul 2026-10-08-servere-bridge §5.1): crearea (cheia se arată o singură dată), rotirea
 * (cheia veche mai e valabilă 10 minute), revocarea (imediată). În baza de date stă doar hash-ul secretului, sigilat cu
 * `GCS_SECRET`. Fiecare schimbare cere dreptul pe secțiunea serverelor și intră în jurnal.
 */
export class GcsBridgeKeys {
  constructor(private readonly deps: { db: PrismaClient; acp: GcsAcpRoleService; now?: () => number }) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  private isActive(k: { revokedAt: Date | null; expiresAt: Date | null }, now: Date): boolean {
    return k.revokedAt === null && (k.expiresAt === null || k.expiresAt > now);
  }

  async list(actor: GcsActor, serverId: number): Promise<GcsBridgeKeyRow[]> {
    await this.deps.acp.assert(actor, SERVERS_ACP_SECTION, "view");
    const now = this.now();
    const rows = await this.deps.db.gameServerKey.findMany({ where: { serverId }, orderBy: { id: "desc" } });
    return rows.map((k) => ({
      id: k.id,
      keyId: k.keyId,
      label: k.label,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      lastIp: k.lastIp,
      revokedAt: k.revokedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      active: this.isActive(k, now),
    }));
  }

  /** O cheie nouă; `token` (`gcs1.<keyId>.<secret>`) se arată o singură dată. */
  async create(actor: GcsActor, serverId: number, input: { label?: string } = {}): Promise<{ id: number; keyId: string; token: string }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const server = await db.gameServer.findUnique({ where: { id: serverId }, select: { id: true } });
    if (!server) throw new GcsNotFound();
    const now = this.now();
    const active = await db.gameServerKey.count({ where: { serverId, revokedAt: null, expiresAt: null } });
    if (active >= MAX_ACTIVE_KEYS) throw new GcsValidationError({ keys: "too_many" }, { max: String(MAX_ACTIVE_KEYS) });
    const key = generateBridgeKey();
    const row = await db.$transaction(async (tx) => {
      const created = await tx.gameServerKey.create({
        data: { serverId, keyId: key.keyId, signingKey: sealSecret(key.signingKey), label: label(input.label), createdById: actor.userId, createdAt: now },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.key.create", targetType: "game_server", targetId: String(serverId), after: { keyId: key.keyId, label: created.label }, ip: actor.ip });
      return created;
    });
    return { id: row.id, keyId: row.keyId, token: key.token };
  }

  /** Rotirea: o cheie nouă (cu aceeași etichetă), iar cea veche expiră peste 10 minute. */
  async rotate(actor: GcsActor, serverId: number, id: number): Promise<{ id: number; keyId: string; token: string }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const now = this.now();
    const old = await db.gameServerKey.findFirst({ where: { id, serverId } });
    if (!old || !this.isActive(old, now)) throw new GcsNotFound();
    const key = generateBridgeKey();
    const row = await db.$transaction(async (tx) => {
      const graceUntil = new Date(now.getTime() + ROTATE_GRACE_MS);
      await tx.gameServerKey.update({ where: { id: old.id }, data: { expiresAt: old.expiresAt && old.expiresAt < graceUntil ? old.expiresAt : graceUntil } });
      const created = await tx.gameServerKey.create({
        data: { serverId, keyId: key.keyId, signingKey: sealSecret(key.signingKey), label: old.label, createdById: actor.userId, createdAt: now },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.key.rotate", targetType: "game_server", targetId: String(serverId), before: { keyId: old.keyId }, after: { keyId: key.keyId }, ip: actor.ip });
      return created;
    });
    return { id: row.id, keyId: row.keyId, token: key.token };
  }

  /** Revocarea: imediată. */
  async revoke(actor: GcsActor, serverId: number, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "delete");
    const key = await db.gameServerKey.findFirst({ where: { id, serverId } });
    if (!key) throw new GcsNotFound();
    if (key.revokedAt) return;
    await db.$transaction(async (tx) => {
      await tx.gameServerKey.update({ where: { id }, data: { revokedAt: this.now() } });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.key.revoke", targetType: "game_server", targetId: String(serverId), before: { keyId: key.keyId }, ip: actor.ip });
    });
  }

  /** Cheia unei cereri: există, nu e revocată, nu a expirat; K desigilat. `null` în orice alt caz. */
  async lookup(keyId: string): Promise<GcsBridgeKeyAuth | null> {
    const key = await this.deps.db.gameServerKey.findUnique({ where: { keyId } });
    if (!key || !this.isActive(key, this.now())) return null;
    const signingKey = openSecret(key.signingKey);
    if (!signingKey || !/^[0-9a-f]{64}$/.test(signingKey)) return null;
    return { id: key.id, keyId: key.keyId, serverId: key.serverId, signingKey, lastUsedAt: key.lastUsedAt };
  }

  /** Ultima folosire (cel mult o scriere pe minut). */
  async touch(key: GcsBridgeKeyAuth, ip: string): Promise<void> {
    const now = this.now();
    if (key.lastUsedAt && now.getTime() - key.lastUsedAt.getTime() < TOUCH_MS) return;
    await this.deps.db.gameServerKey.update({ where: { id: key.id }, data: { lastUsedAt: now, lastIp: ip.slice(0, 64) } });
  }
}
