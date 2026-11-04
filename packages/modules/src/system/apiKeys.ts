import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsKv, type GcsRateLimiter } from "@gcs/core";
import type { ApiKey, PrismaClient } from "@gcs/db";

/** Secțiunea ACP (ACP › Sistem › Funcții site › API). */
export const API_ACP_SECTION = "system.api";
/** Ce poate citi o cheie. */
export const GCS_API_SCOPES = ["stats:read", "forums:read", "members:read", "servers:read"] as const;
export type GcsApiScope = (typeof GCS_API_SCOPES)[number];
/** Cererile pe minut ale unei chei. */
export const API_RATE_PER_MINUTE = 60;
const LOG_MAX = 50;
const logKey = (id: number) => `gcs:api:log:${id}`;

export type GcsApiCall = { at: number; path: string; status: number; ip: string | null };
export type GcsApiKeyView = Omit<ApiKey, "hash" | "scopes"> & { scopes: GcsApiScope[]; log: GcsApiCall[] };

const scopesOf = (v: unknown): GcsApiScope[] => (Array.isArray(v) ? v.filter((s): s is GcsApiScope => (GCS_API_SCOPES as readonly string[]).includes(s as string)) : []);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Cheile API: create din ACP (cheia întreagă se arată o singură dată, se păstrează doar prefixul și hash-ul), cu
 * drepturile de citire alese, revocabile. `authorize` verifică cheia din `Authorization: Bearer …`, dreptul și limita
 * pe minut, apoi notează cererea (ultimele 50, cu codul și IP-ul).
 */
export class GcsApiKeyService {
  constructor(private readonly deps: { db: PrismaClient; kv: GcsKv; acp: Pick<GcsAcpRoleService, "assert">; rateLimiter: Pick<GcsRateLimiter, "consume"> }) {}

  async list(actor: GcsActor): Promise<GcsApiKeyView[]> {
    await this.deps.acp.assert(actor, API_ACP_SECTION, "view");
    const rows = await this.deps.db.apiKey.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return Promise.all(rows.map(async ({ hash: _hash, ...r }) => ({ ...r, scopes: scopesOf(r.scopes), log: await this.log(r.id, 10) })));
  }

  async log(id: number, count = LOG_MAX): Promise<GcsApiCall[]> {
    const raw = await this.deps.kv.listRange(logKey(id), count).catch(() => [] as string[]);
    return raw.flatMap((l) => {
      try {
        return [JSON.parse(l) as GcsApiCall];
      } catch {
        return [];
      }
    });
  }

  /** O cheie nouă; întoarce cheia întreagă (singura dată când se vede). */
  async create(actor: GcsActor, name: string, scopes: string[]): Promise<{ id: number; key: string }> {
    await this.deps.acp.assert(actor, API_ACP_SECTION, "edit");
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 60) throw new GcsValidationError({ name: "length" });
    const chosen = [...new Set(scopesOf(scopes))];
    if (chosen.length === 0) throw new GcsValidationError({ scopes: "required" });
    const prefix = randomBytes(6).toString("hex");
    const secret = randomBytes(24).toString("base64url");
    const key = `gcs_${prefix}_${secret}`;
    const row = await this.deps.db.apiKey.create({ data: { name: clean, prefix, hash: sha(key), scopes: chosen, createdById: actor.userId }, select: { id: true } });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "api.key_create", targetType: "api_key", targetId: String(row.id), after: { name: clean, scopes: chosen, prefix }, ip: actor.ip });
    return { id: row.id, key };
  }

  async update(actor: GcsActor, id: number, name: string, scopes: string[]): Promise<void> {
    await this.deps.acp.assert(actor, API_ACP_SECTION, "edit");
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 60) throw new GcsValidationError({ name: "length" });
    const chosen = [...new Set(scopesOf(scopes))];
    if (chosen.length === 0) throw new GcsValidationError({ scopes: "required" });
    const { count } = await this.deps.db.apiKey.updateMany({ where: { id }, data: { name: clean, scopes: chosen } });
    if (count === 0) throw new GcsNotFound({ entity: "api_key" });
  }

  async revoke(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, API_ACP_SECTION, "edit");
    const { count } = await this.deps.db.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) throw new GcsNotFound({ entity: "api_key" });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "api.key_revoke", targetType: "api_key", targetId: String(id), ip: actor.ip });
  }

  async remove(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, API_ACP_SECTION, "delete");
    const { count } = await this.deps.db.apiKey.deleteMany({ where: { id } });
    if (count === 0) throw new GcsNotFound({ entity: "api_key" });
    await this.deps.kv.del(logKey(id)).catch(() => 0);
  }

  /**
   * Cererea unei rute `/api/v1`: cheia validă și nerevocată, cu dreptul cerut, în limita pe minut. Întoarce id-ul
   * cheii (pentru `record`); altfel `GcsForbidden` (cheie lipsă / greșită / fără drept) sau `GcsRateLimited`.
   */
  async authorize(header: string | null, scope: GcsApiScope): Promise<number> {
    const m = /^Bearer\s+(gcs_([a-f0-9]{12})_[A-Za-z0-9_-]{20,64})$/.exec(header?.trim() ?? "");
    if (!m) throw new GcsForbidden({ reason: "api_key" });
    const row = await this.deps.db.apiKey.findUnique({ where: { prefix: m[2]! } });
    const want = Buffer.from(sha(m[1]!));
    if (!row || row.revokedAt || !timingSafeEqual(Buffer.from(row.hash), want)) throw new GcsForbidden({ reason: "api_key" });
    if (!scopesOf(row.scopes).includes(scope)) throw new GcsForbidden({ reason: "api_scope" });
    const limit = await this.deps.rateLimiter.consume(`api:${row.id}`, { window: 60, max: API_RATE_PER_MINUTE });
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter ?? 60) });
    await this.deps.db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return row.id;
  }

  /** Notează o cerere (ultimele 50 pe cheie). */
  async record(id: number, call: GcsApiCall): Promise<void> {
    await this.deps.kv.listPush(logKey(id), JSON.stringify(call), LOG_MAX).catch(() => {});
  }
}
