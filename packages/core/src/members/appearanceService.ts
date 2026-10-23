import type { Prisma, PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import type { GcsKv } from "../infra/kv";
import { GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import { compileAppearanceCss, mergeAppearances, nameEffectOf, parseMemberAppearance, type GcsCompiledStyleInput, type GcsMemberAppearance } from "./appearance";
import { nameEffectUsesLetters } from "./nameEffects";
import { CUSTOM_STYLE_KEY, CUSTOM_STYLE_KINDS, customStyleClass, parseCustomStyle, type GcsCustomStyleError, type GcsCustomStyleKind } from "./customStyle";

const VERSION_KEY = "gcs:appearance:version";
const USER_TTL = 300;
const CSS_TTL = 3600;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BATCH = 200;

type Redis = Pick<GcsKv, "incr" | "get">;
type Row = { pluginKey: string; data: GcsMemberAppearance };
/** Rezultatul verificării unui stil CSS: erorile au linia lor (formularul din ACP le arată). */
export type GcsCustomStyleResult = { ok: true; className: string } | { ok: false; errors: GcsCustomStyleError[] };

const userTag = (userId: string) => `appearance:user:${userId}`;

/**
 * Aspectul membrilor publicat de pluginuri (specul Studio VIP §2.1). Pluginul îl scrie (`set`), nucleul îl validează,
 * îl păstrează și îl randează; doar pluginurile încărcate acum contează (`active`), în ordinea priorității.
 */
export class GcsMemberAppearanceService {
  /** Pluginurile active cu `appearance`, în ordinea priorității (le dă gazda pluginurilor). */
  private active: () => string[] = () => [];

  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; kv: Redis; bus: GcsEventBus }) {}

  setActiveProvider(provider: () => string[]): void {
    this.active = provider;
  }

  /** Versiunea CSS-ului (în URL-ul `/gcs-names.css`): crește la orice schimbare de aspect sau de pluginuri active. */
  async version(): Promise<number> {
    return Number((await this.deps.kv.get(VERSION_KEY)) ?? 0);
  }

  async bump(): Promise<void> {
    await this.deps.kv.incr(VERSION_KEY);
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

  // ─── Stilurile CSS scrise de admini (ACP-ul pluginului) ───

  /** Verifică CSS-ul unui stil, fără să-l salveze (erorile pe linii). */
  checkStyle(pluginKey: string, kind: unknown, key: unknown, css: unknown): GcsCustomStyleResult {
    const k = this.styleKind(kind);
    if (!k || typeof key !== "string" || !CUSTOM_STYLE_KEY.test(key)) return { ok: false, errors: [{ line: 1, code: "invalid_key" }] };
    const parsed = parseCustomStyle(typeof css === "string" ? css : "", { pluginKey });
    return parsed.ok ? { ok: true, className: customStyleClass(pluginKey, k, key) } : { ok: false, errors: parsed.errors };
  }

  /**
   * Salvează (sau șterge, cu `css` = `null`) un stil CSS al pluginului. Doar din rutele ACP ale pluginului (gazda
   * verifică); adminul ajunge în jurnalul ACP. CSS-ul nu se salvează dacă are erori.
   */
  async setStyle(pluginKey: string, kind: unknown, key: unknown, css: unknown, actor: { userId: string | null; ip?: string | null }): Promise<GcsCustomStyleResult> {
    const { db } = this.deps;
    const k = this.styleKind(kind);
    if (!k || typeof key !== "string" || !CUSTOM_STYLE_KEY.test(key)) return { ok: false, errors: [{ line: 1, code: "invalid_key" }] };
    if (css === null) {
      const { count } = await db.pluginAppearanceStyle.deleteMany({ where: { pluginKey, kind: k, key } });
      if (count > 0) {
        await writeAudit(db, { actorId: actor.userId, action: "plugin.appearance_style.delete", targetType: "plugin", targetId: pluginKey, before: { kind: k, key } });
        await this.bump();
      }
      return { ok: true, className: customStyleClass(pluginKey, k, key) };
    }
    const checked = this.checkStyle(pluginKey, k, key, css);
    if (!checked.ok) return checked;
    const before = await db.pluginAppearanceStyle.findUnique({ where: { pluginKey_kind_key: { pluginKey, kind: k, key } }, select: { css: true } });
    if (before?.css !== css) {
      await db.pluginAppearanceStyle.upsert({
        where: { pluginKey_kind_key: { pluginKey, kind: k, key } },
        create: { pluginKey, kind: k, key, css: css as string, updatedBy: actor.userId },
        update: { css: css as string, updatedBy: actor.userId },
      });
      await writeAudit(db, {
        actorId: actor.userId,
        action: before ? "plugin.appearance_style.update" : "plugin.appearance_style.create",
        targetType: "plugin",
        targetId: pluginKey,
        before: before ? { kind: k, key, css: before.css } : undefined,
        after: { kind: k, key, css },
        ip: actor.ip ?? null,
      });
      await this.bump();
    }
    return checked;
  }

  /** Stilurile CSS ale pluginului (cheile, tipul și sursa). */
  async listStyles(pluginKey: string, kind?: unknown): Promise<{ kind: GcsCustomStyleKind; key: string; css: string; className: string; updatedAt: string }[]> {
    const k = kind === undefined ? null : this.styleKind(kind);
    const rows = await this.deps.db.pluginAppearanceStyle.findMany({ where: { pluginKey, ...(k ? { kind: k } : {}) }, orderBy: [{ kind: "asc" }, { key: "asc" }], take: 500 });
    return rows
      .filter((r) => (CUSTOM_STYLE_KINDS as readonly string[]).includes(r.kind))
      .map((r) => ({ kind: r.kind as GcsCustomStyleKind, key: r.key, css: r.css, className: customStyleClass(pluginKey, r.kind as GcsCustomStyleKind, r.key), updatedAt: r.updatedAt.toISOString() }));
  }

  private styleKind(kind: unknown): GcsCustomStyleKind | null {
    return typeof kind === "string" && (CUSTOM_STYLE_KINDS as readonly string[]).includes(kind) ? (kind as GcsCustomStyleKind) : null;
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
      const ordered = active.map((key) => rows.find((r) => r.pluginKey === key)).filter((r): r is Row => Boolean(r));
      if (ordered.length > 0) out.set(id, mergeAppearances(ordered.map((r) => r.data), ordered.map((r) => r.pluginKey)));
    }
    return out;
  }

  async forUser(userId: string): Promise<GcsMemberAppearance | null> {
    return (await this.forUsers([userId])).get(userId) ?? null;
  }

  /**
   * CSS-ul numelor și ramelor (toți userii cu aspect), compilat o dată pe versiune și set de pluginuri active. Cu
   * `previews`, doar clasele de previzualizare (efectele, stilurile CSS ale pluginurilor), pentru paginile pluginurilor:
   * restul site-ului nu le descarcă.
   */
  async css(opts: { previews?: boolean } = {}): Promise<string> {
    const { db, cache } = this.deps;
    const active = this.active();
    if (active.length === 0) return "";
    const key = `appearance:css:${opts.previews ? "previews" : "members"}:${await this.version()}:${active.join(",")}`;
    const cached = await cache.get<string>(key);
    if (cached !== null) return cached;
    const entries = opts.previews ? [] : await this.allMerged(active);
    const styles: GcsCompiledStyleInput[] = [];
    for (const row of await db.pluginAppearanceStyle.findMany({ where: { pluginKey: { in: active } }, orderBy: [{ pluginKey: "asc" }, { kind: "asc" }, { key: "asc" }] })) {
      const parsed = parseCustomStyle(row.css, { pluginKey: row.pluginKey });
      if (parsed.ok && (CUSTOM_STYLE_KINDS as readonly string[]).includes(row.kind)) styles.push({ pluginKey: row.pluginKey, kind: row.kind as GcsCustomStyleKind, key: row.key, style: parsed.style });
    }
    const css = compileAppearanceCss(entries, { previews: opts.previews === true, styles });
    await cache.set(key, css, { ttlSec: CSS_TTL, tags: ["appearance"] });
    return css;
  }

  /**
   * Membrii ale căror efecte de nume se desenează pe litere (componenta numelui le separă literele): aceeași versiune
   * ca CSS-ul, deci lista și regulile rămân potrivite.
   */
  async letterUsers(): Promise<string[]> {
    const active = this.active();
    if (active.length === 0) return [];
    const key = `appearance:letters:${await this.version()}:${active.join(",")}`;
    const cached = await this.deps.cache.get<string[]>(key);
    if (cached !== null) return cached;
    const users = (await this.allMerged(active)).filter((e) => e.appearance.name && nameEffectUsesLetters(nameEffectOf(e.appearance.name))).map((e) => e.userId);
    await this.deps.cache.set(key, users, { ttlSec: CSS_TTL, tags: ["appearance"] });
    return users;
  }

  /** Aspectul combinat al tuturor membrilor care au unul (pluginurile active, în ordinea priorității). */
  private async allMerged(active: string[]): Promise<{ userId: string; appearance: GcsMemberAppearance }[]> {
    const rows = await this.deps.db.memberAppearance.findMany({ where: { pluginKey: { in: active } }, select: { pluginKey: true, userId: true, data: true } });
    const byUser = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byUser.get(r.userId) ?? [];
      list.push({ pluginKey: r.pluginKey, data: r.data as GcsMemberAppearance });
      byUser.set(r.userId, list);
    }
    return [...byUser].map(([userId, list]) => {
      const ordered = active.map((k) => list.find((r) => r.pluginKey === k)).filter((r): r is Row => Boolean(r));
      return { userId, appearance: mergeAppearances(ordered.map((r) => r.data), ordered.map((r) => r.pluginKey)) };
    });
  }
}
