import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsCache } from "../cache";
import { GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import { compileAppearanceCss, mergeAppearances, parseMemberAppearance, type GcsMemberAppearance } from "./appearance";

const VERSION_KEY = "gcs:appearance:version";
const USER_TTL = 300;
const CSS_TTL = 3600;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BATCH = 200;

type Redis = { incr(key: string): Promise<number>; get(key: string): Promise<string | null> };
type Row = { pluginKey: string; data: GcsMemberAppearance };

const userTag = (userId: string) => `appearance:user:${userId}`;

/**
 * Aspectul membrilor publicat de pluginuri (specul Studio VIP §2.1). Pluginul îl scrie (`set`), nucleul îl validează,
 * îl păstrează și îl randează; doar pluginurile încărcate acum contează (`active`), în ordinea priorității.
 */
export class GcsMemberAppearanceService {
  /** Pluginurile active cu `appearance`, în ordinea priorității (le dă gazda pluginurilor). */
  private active: () => string[] = () => [];

  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; redis: Redis; bus: GcsEventBus }) {}

  setActiveProvider(provider: () => string[]): void {
    this.active = provider;
  }

  /** Versiunea CSS-ului (în URL-ul `/gcs-names.css`): crește la orice schimbare de aspect sau de pluginuri active. */
  async version(): Promise<number> {
    return Number((await this.deps.redis.get(VERSION_KEY)) ?? 0);
  }

  async bump(): Promise<void> {
    await this.deps.redis.incr(VERSION_KEY);
  }

  /** Publică (sau șterge, cu `null`) aspectul unui membru. Validarea completă; o eroare listează câmpurile. */
  async set(pluginKey: string, userId: unknown, raw: unknown): Promise<void> {
    const { db, bus } = this.deps;
    if (typeof userId !== "string" || !USER_ID.test(userId)) throw new GcsValidationError({ userId: "invalid" });
    if (raw === null) {
      await db.memberAppearance.deleteMany({ where: { pluginKey, userId } });
    } else {
      const parsed = parseMemberAppearance(raw, { pluginKey });
      if (!parsed.ok) throw new GcsValidationError(parsed.errors);
      const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new GcsNotFound({ entity: "user" });
      const data = parsed.value as Prisma.InputJsonValue;
      await db.memberAppearance.upsert({ where: { pluginKey_userId: { pluginKey, userId } }, create: { pluginKey, userId, data }, update: { data } });
    }
    await this.bump();
    await bus.emit({ name: "appearance.updated", payload: { userId, plugin: pluginKey }, tags: [userTag(userId), `user:${userId}`] });
  }

  /** Rândurile proprii ale pluginului pentru acești useri. */
  async get(pluginKey: string, userIds: unknown): Promise<Record<string, GcsMemberAppearance>> {
    const list = this.ids(userIds);
    if (list.length === 0) return {};
    const rows = await this.deps.db.memberAppearance.findMany({ where: { pluginKey, userId: { in: list } }, select: { userId: true, data: true } });
    return Object.fromEntries(rows.map((r) => [r.userId, r.data as GcsMemberAppearance]));
  }

  /** Șterge tot aspectul publicat de plugin (ex. la dezinstalare sau când pluginul o cere). */
  async clear(pluginKey: string): Promise<number> {
    const { count } = await this.deps.db.memberAppearance.deleteMany({ where: { pluginKey } });
    await this.bump();
    await this.deps.bus.emit({ name: "appearance.updated", payload: { plugin: pluginKey }, tags: ["appearance"] });
    return count;
  }

  private ids(raw: unknown): string[] {
    return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string" && USER_ID.test(id)))].slice(0, MAX_BATCH) : [];
  }

  /** Rândurile unui user (toate pluginurile), din cache. */
  private async rows(userId: string): Promise<Row[]> {
    const { db, cache } = this.deps;
    const key = `appearance:u:${userId}`;
    const cached = await cache.get<Row[]>(key);
    if (cached) return cached;
    const rows = (await db.memberAppearance.findMany({ where: { userId }, select: { pluginKey: true, data: true } })).map((r) => ({ pluginKey: r.pluginKey, data: r.data as GcsMemberAppearance }));
    await cache.set(key, rows, { ttlSec: USER_TTL, tags: [userTag(userId), "appearance"] });
    return rows;
  }

  /**
   * Aspectul final al acestor useri (pluginurile active, în ordinea priorității). Userii fără aspect lipsesc din
   * rezultat. Pentru postbit, hover card și profil.
   */
  async forUsers(userIds: string[]): Promise<Map<string, GcsMemberAppearance>> {
    const active = this.active();
    const out = new Map<string, GcsMemberAppearance>();
    if (active.length === 0) return out;
    const list = this.ids(userIds);
    const all = await Promise.all(list.map(async (id) => [id, await this.rows(id)] as const));
    for (const [id, rows] of all) {
      const ordered = active.map((key) => rows.find((r) => r.pluginKey === key)?.data).filter((d): d is GcsMemberAppearance => Boolean(d));
      if (ordered.length > 0) out.set(id, mergeAppearances(ordered));
    }
    return out;
  }

  async forUser(userId: string): Promise<GcsMemberAppearance | null> {
    return (await this.forUsers([userId])).get(userId) ?? null;
  }

  /** CSS-ul numelor și ramelor (toți userii cu aspect), compilat o dată pe versiune și set de pluginuri active. */
  async css(): Promise<string> {
    const { db, cache } = this.deps;
    const active = this.active();
    if (active.length === 0) return "";
    const key = `appearance:css:${await this.version()}:${active.join(",")}`;
    const cached = await cache.get<string>(key);
    if (cached !== null) return cached;
    const rows = await db.memberAppearance.findMany({ where: { pluginKey: { in: active } }, select: { pluginKey: true, userId: true, data: true } });
    const byUser = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byUser.get(r.userId) ?? [];
      list.push({ pluginKey: r.pluginKey, data: r.data as GcsMemberAppearance });
      byUser.set(r.userId, list);
    }
    const entries = [...byUser].map(([userId, list]) => ({
      userId,
      appearance: mergeAppearances(active.map((k) => list.find((r) => r.pluginKey === k)?.data).filter((d): d is GcsMemberAppearance => Boolean(d))),
    }));
    const css = compileAppearanceCss(entries);
    await cache.set(key, css, { ttlSec: CSS_TTL, tags: ["appearance"] });
    return css;
  }
}
