import type { Prisma, PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsModuleRegistry, GcsPermissionDef } from "../modules/registry";
import type { GcsActor, GcsContainerRef } from "./types";

const CACHE_TTL_SEC = 3600;
const VERSION_TTL_SEC = 300;
const CACHE_TAG = "permissions";
const MAX_INHERIT_DEPTH = 32;
const ROOT_ADMIN = "root_admin";
const BANNED = "banned";
/** Singura cheie permisă unui user banat (spec §6.3). */
const BAN_EXEMPT_KEY = "core.view_public";

/** Permisiunile calculate pentru o combinație de grupuri (ce stă în cache). */
type GcsGroupSetPerms = {
  groupKeys: string[];
  /** Valoarea combinată a fiecărei setări de grup. */
  values: Record<string, unknown>;
  /** `${containerType}:${containerId}:${action}` permise măcar unui grup din set. */
  containers: string[];
};

type GcsModeratorRow = { userId: string | null; groupId: number | null; powers: string[] };

/**
 * Singurul punct de verificare a permisiunilor (spec §6.3).
 *
 * - Uniune permisivă: un boolean e true dacă măcar un grup îl are true; la numere câștigă maximul
 *   (`-1` = nelimitat), sau minimul pentru definițiile cu `merge: "min"`.
 * - Bannul (`isBanned` sau grupul `banned`) anulează tot, cu excepția `core.view_public`.
 * - `root_admin` primește true pentru orice cheie.
 * - În matricea pe container, `action` e cheia completă a permisiunii (ex. `forums.view`).
 *
 * Cache-ul e pe combinația de grupuri: `perm:${permVersion}:${groupIds sortate}`. `bumpVersion()`
 * schimbă versiunea, deci următorul request citește permisiunile noi, fără să aștepte TTL-ul.
 *
 * Etapa 5: **permisiunile individuale** (`user_permissions`) se aplică după grupuri, doar pentru setările de grup:
 * valoarea individuală o înlocuiește pe cea combinată a grupurilor (poate da sau lua un drept). Bannul și
 * `root_admin` rămân deasupra lor.
 */
export class GcsPermissionService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      bus: GcsEventBus;
      registry: GcsModuleRegistry;
    },
  ) {}

  /** Definiția unei chei de permisiune, din modulele înregistrate. */
  permissionDef(key: string): GcsPermissionDef | undefined {
    return this.deps.registry.permissionDef(key);
  }

  async can(actor: GcsActor, key: string, container?: GcsContainerRef): Promise<boolean> {
    const version = await this.version();
    const perms = await this.groupSetPerms(actor.groupIds, version);
    const banned = actor.isBanned || perms.groupKeys.includes(BANNED);

    if (banned && key !== BAN_EXEMPT_KEY) return false;
    if (perms.groupKeys.includes(ROOT_ADMIN)) return true;

    if (container) {
      const effective = await this.effectiveContainer(container, version);
      if (!effective) return false;
      return perms.containers.includes(`${effective.type}:${effective.id}:${key}`);
    }
    const own = await this.userOverrides(actor.userId, version);
    return isGranted(key in own ? own[key] : perms.values[key]);
  }

  async assert(actor: GcsActor, key: string, container?: GcsContainerRef): Promise<void> {
    if (!(await this.can(actor, key, container))) throw new GcsForbidden({ permission: key });
  }

  /**
   * Valoarea cea mai permisivă a unei setări de grup. Un user banat primește `false`;
   * `root_admin` primește `true` la booleene și valoarea nelimitată la numere.
   * Dacă niciun grup nu are valoare, întoarce `false`.
   */
  async groupValue<T>(actor: GcsActor, key: string): Promise<T> {
    const version = await this.version();
    const perms = await this.groupSetPerms(actor.groupIds, version);
    const def = this.deps.registry.permissionDef(key);
    const own = await this.userOverrides(actor.userId, version);
    const value = key in own ? own[key] : perms.values[key];

    if (actor.isBanned || perms.groupKeys.includes(BANNED)) {
      return (key === BAN_EXEMPT_KEY ? (value ?? false) : typeof value === "number" ? 0 : false) as T;
    }
    if (perms.groupKeys.includes(ROOT_ADMIN)) {
      if (typeof value === "number") return (def?.merge === "min" ? 0 : -1) as T;
      if (value === undefined || typeof value === "boolean") return true as T;
    }
    return (value ?? false) as T;
  }

  /** Moderator pe container: un rând `moderators` pe user sau pe unul din grupuri, cu puterea cerută. */
  async canModerate(actor: GcsActor, power: string, container: GcsContainerRef): Promise<boolean> {
    const powers = await this.moderatorPowers(actor, container);
    return powers.includes("*") || powers.includes(power);
  }

  /** Toate puterile de moderare ale actorului pe container, sortate; `["*"]` pentru root_admin, `[]` pentru banați. */
  async moderatorPowers(actor: GcsActor, container: GcsContainerRef): Promise<string[]> {
    const version = await this.version();
    const perms = await this.groupSetPerms(actor.groupIds, version);
    if (actor.isBanned || perms.groupKeys.includes(BANNED)) return [];
    if (perms.groupKeys.includes(ROOT_ADMIN)) return ["*"];

    const cacheKey = `perm:${version}:mod:${container.type}:${container.id}`;
    let rows = await this.deps.cache.get<GcsModeratorRow[]>(cacheKey);
    if (!rows) {
      rows = await this.deps.db.moderator.findMany({
        where: { containerType: container.type, containerId: container.id },
        select: { userId: true, groupId: true, powers: true },
      });
      await this.deps.cache.set(cacheKey, rows, { ttlSec: CACHE_TTL_SEC, tags: [CACHE_TAG] });
    }
    const mine = rows.filter(
      (r) => (r.userId !== null && r.userId === actor.userId) || (r.groupId !== null && actor.groupIds.includes(r.groupId)),
    );
    return [...new Set(mine.flatMap((r) => r.powers))].sort();
  }

  /**
   * `can(actor, key, container)` pentru mai multe containere de același tip, cu o singură citire a permisiunilor
   * (ex. lista de forumuri). Întoarce id-urile permise.
   */
  async filterContainers(actor: GcsActor, key: string, containers: GcsContainerRef[]): Promise<Set<string>> {
    const version = await this.version();
    const perms = await this.groupSetPerms(actor.groupIds, version);
    if ((actor.isBanned || perms.groupKeys.includes(BANNED)) && key !== BAN_EXEMPT_KEY) return new Set();
    if (perms.groupKeys.includes(ROOT_ADMIN)) return new Set(containers.map((c) => c.id));

    const parents = await this.inheritMap(version);
    const granted = new Set(perms.containers);
    const allowed = new Set<string>();
    for (const c of containers) {
      const effective = resolveInherit(parents, c);
      if (effective && granted.has(`${effective.type}:${effective.id}:${key}`)) allowed.add(c.id);
    }
    return allowed;
  }

  /** Permisiunile individuale ale unui membru (fișa membrului din ACP). */
  async userPermissions(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.deps.db.userPermission.findMany({ where: { userId }, orderBy: { key: "asc" } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /**
   * Setează (sau, cu `null`, șterge) permisiunea individuală a unui membru, cu jurnal. Doar pentru setările de grup;
   * valoarea trebuie să aibă tipul valorilor implicite (boolean sau număr). Verificarea dreptului ACP o face apelantul.
   */
  async setUserPermission(actor: GcsActor, userId: string, key: string, value: boolean | number | null): Promise<void> {
    const { db } = this.deps;
    const def = this.deps.registry.permissionDef(key);
    if (!def || def.scope !== "group") throw new GcsValidationError({ key: "unknown" });
    if (value !== null) {
      const sample = Object.values(def.default).find((v) => v !== undefined);
      const expected = typeof sample === "number" ? "number" : "boolean";
      if (typeof value !== expected || (typeof value === "number" && (!Number.isInteger(value) || value < -1))) {
        throw new GcsValidationError({ value: "invalid_value" });
      }
    }
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      const before = await tx.userPermission.findUnique({ where: { userId_key: { userId, key } } });
      if (value === null) await tx.userPermission.deleteMany({ where: { userId, key } });
      else {
        await tx.userPermission.upsert({
          where: { userId_key: { userId, key } },
          create: { userId, key, value: value as Prisma.InputJsonValue },
          update: { value: value as Prisma.InputJsonValue },
        });
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "permissions.user",
        targetType: "user",
        targetId: userId,
        before: before ? { [key]: before.value } : null,
        after: { [key]: value },
        ip: actor.ip,
      });
    });
    await this.bumpVersion();
  }

  /** Incrementează `permVersion` și emite `permissions.updated`. Se apelează după orice schimbare de permisiuni. */
  async bumpVersion(): Promise<void> {
    const state = await this.deps.db.systemState.upsert({
      where: { id: 1 },
      create: { id: 1, permVersion: 1 },
      update: { permVersion: { increment: 1 } },
    });
    await this.deps.bus.emit({
      name: "permissions.updated",
      payload: { permVersion: state.permVersion },
      tags: [CACHE_TAG],
    });
  }

  /** Versiunea curentă a permisiunilor (se schimbă la orice modificare de grupuri sau permisiuni). */
  currentVersion(): Promise<number> {
    return this.version();
  }

  private async version(): Promise<number> {
    const cached = await this.deps.cache.get<number>("perm:version");
    if (cached !== null) return cached;
    const state = await this.deps.db.systemState.findUnique({ where: { id: 1 }, select: { permVersion: true } });
    const version = state?.permVersion ?? 0;
    await this.deps.cache.set("perm:version", version, { ttlSec: VERSION_TTL_SEC, tags: [CACHE_TAG] });
    return version;
  }

  /** Suprascrierile individuale ale userului (cache pe versiunea permisiunilor); `{}` pentru vizitatori. */
  private async userOverrides(userId: string | null, version: number): Promise<Record<string, unknown>> {
    if (!userId) return {};
    const cacheKey = `perm:${version}:user:${userId}`;
    const cached = await this.deps.cache.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;
    const rows = await this.deps.db.userPermission.findMany({ where: { userId }, select: { key: true, value: true } });
    const own = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    await this.deps.cache.set(cacheKey, own, { ttlSec: CACHE_TTL_SEC, tags: [CACHE_TAG] });
    return own;
  }

  private async groupSetPerms(groupIds: number[], version: number): Promise<GcsGroupSetPerms> {
    const ids = [...new Set(groupIds)].sort((a, b) => a - b);
    const cacheKey = `perm:${version}:${ids.join(",")}`;
    const cached = await this.deps.cache.get<GcsGroupSetPerms>(cacheKey);
    if (cached) return cached;

    const [groups, containerRows] = await Promise.all([
      this.deps.db.group.findMany({
        where: { id: { in: ids } },
        select: { key: true, settings: { select: { key: true, value: true } } },
      }),
      this.deps.db.containerPermission.findMany({
        where: { groupId: { in: ids } },
        select: { containerType: true, containerId: true, action: true },
      }),
    ]);

    const values: Record<string, unknown> = {};
    for (const def of this.deps.registry.permissionDefs()) {
      if (def.scope !== "group") continue;
      const perGroup = groups.map((group) => {
        const row = group.settings.find((s) => s.key === def.key);
        return row ? row.value : def.default[group.key];
      });
      const merged = mergeValues(perGroup, def);
      if (merged !== undefined) values[def.key] = merged;
    }

    const perms: GcsGroupSetPerms = {
      groupKeys: groups.map((group) => group.key),
      values,
      containers: [...new Set(containerRows.map((r) => `${r.containerType}:${r.containerId}:${r.action}`))],
    };
    await this.deps.cache.set(cacheKey, perms, { ttlSec: CACHE_TTL_SEC, tags: [CACHE_TAG] });
    return perms;
  }

  /** Urcă pe lanțul de moștenire până la containerul care își definește permisiunile; `null` la ciclu. */
  private async effectiveContainer(container: GcsContainerRef, version: number): Promise<GcsContainerRef | null> {
    return resolveInherit(await this.inheritMap(version), container);
  }

  /** `${type}:${id}` → id-ul părintelui, pentru containerele care moștenesc. */
  private async inheritMap(version: number): Promise<Record<string, string>> {
    const cacheKey = `perm:${version}:inherit`;
    const cached = await this.deps.cache.get<Record<string, string>>(cacheKey);
    if (cached) return cached;
    const rows = await this.deps.db.containerInherit.findMany({
      where: { inherits: true, parentId: { not: null } },
      select: { containerType: true, containerId: true, parentId: true },
    });
    const map: Record<string, string> = {};
    for (const r of rows) if (r.parentId !== null) map[`${r.containerType}:${r.containerId}`] = r.parentId;
    await this.deps.cache.set(cacheKey, map, { ttlSec: CACHE_TTL_SEC, tags: [CACHE_TAG] });
    return map;
  }
}

/** Containerul care își definește permisiunile, urcând pe lanțul de moștenire; `null` la ciclu sau peste 32 de niveluri. */
function resolveInherit(parents: Record<string, string>, container: GcsContainerRef): GcsContainerRef | null {
  let id = container.id;
  for (let depth = 0; depth <= MAX_INHERIT_DEPTH; depth++) {
    const parent = parents[`${container.type}:${id}`];
    if (parent === undefined) return { type: container.type, id };
    id = parent;
  }
  return null;
}

function isGranted(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return false;
}

/** Combină valorile grupurilor după regula uniunii permisive. */
function mergeValues(values: unknown[], def: GcsPermissionDef): unknown {
  const present = values.filter((v) => v !== undefined && v !== null);
  if (present.length === 0) return undefined;
  if (present.some((v) => typeof v === "boolean")) return present.some((v) => v === true);

  const numbers = present.filter((v): v is number => typeof v === "number");
  if (numbers.length === 0) return present[0];
  if (def.merge === "min") return Math.min(...numbers);
  return numbers.includes(-1) ? -1 : Math.max(...numbers);
}
