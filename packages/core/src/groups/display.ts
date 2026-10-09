import type { PrismaClient } from "@gcs/db";
import type { GcsCache } from "../cache";
import { writeAudit } from "../audit";
import { GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsActor } from "../permissions/types";
import { isHexColor, type GcsNameStyle } from "./nameStyles";

/**
 * Grupul afișat al unui membru (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot): când un membru are un grup principal
 * și grupuri secundare (ex. Moderator + VIP Gold), numele are stilul unui singur grup, ales determinist:
 * - grupul ales de membru în Setări, dacă e unul dintre grupurile lui și grupul permite alegerea;
 * - altfel, dintre grupurile lui care au un stil de nume, cel cu „Prioritate afișare” cea mai mare (la egalitate,
 *   grupul principal, apoi ordinea din ACP);
 * - altfel, grupul principal.
 * Efectul personal din Studio VIP rămâne peste el (CSS-ul generat, pe `data-user-id`). Rezultatul se păstrează pe user
 * (`nameGroupId`, `null` = grupul principal), recalculat când se schimbă grupurile lui sau setările grupurilor.
 *
 * Setările de afișare ale unui grup (rânduri `group_settings`): prioritatea, alegerea de către membri, apariția ca
 * grup secundar (pastile), lista membrilor doar cu grupul principal și descrierea scurtă (tooltip-ul pastilei).
 */
export const GROUP_DISPLAY_SETTING = {
  priority: "display.priority",
  selectable: "display.selectable",
  showSecondary: "display.show_secondary",
  primaryOnly: "display.primary_only",
  description: "display.description",
} as const;
export const GROUP_DISPLAY_KEYS: readonly string[] = Object.values(GROUP_DISPLAY_SETTING);
export const GROUP_DESCRIPTION_MAX = 120;
export const GROUP_PRIORITY_RANGE = { min: 0, max: 1000 } as const;

export type GcsGroupDisplaySettings = {
  /** „Prioritate afișare”: mai mare = câștigă stilul numelui. */
  priority: number;
  /** „Membrii pot alege acest grup ca grup afișat”. */
  selectable: boolean;
  /** „Afișează ca grup secundar” (pastilele de lângă grupul principal). */
  showSecondary: boolean;
  /** Pagina membrilor grupului și @mențiunile grupului: doar membrii cu el ca grup principal. */
  primaryOnly: boolean;
  /** „Descriere scurtă (tooltip)”: primul rând al tooltip-ului pastilei. */
  description: string;
};

/** Grupurile de staff (prioritate mare), în ordinea lor. */
const STAFF_PRIORITY: Record<string, number> = { root_admin: 100, admin: 90, super_moderator: 80, moderator: 70 };

/** Valorile implicite: staff-ul sus, VIP-urile după, ceilalți jos; vizitatorii și banații la zero. */
export function defaultDisplaySettings(group: { key: string; isVip: boolean }): GcsGroupDisplaySettings {
  const priority = STAFF_PRIORITY[group.key] ?? (group.isVip ? 50 : group.key === "guest" || group.key === "banned" ? 0 : 10);
  return { priority, selectable: false, showSecondary: group.key !== "guest", primaryOnly: false, description: "" };
}

/** Un text simplu: fără caractere de control, cu spațiile strânse, cel mult `max` caractere. */
function plain(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return [...t].length <= max ? t : null;
}

/** Setările efective: valorile salvate valide, peste cele implicite. */
export function displaySettingsOf(group: { key: string; isVip: boolean }, stored: ReadonlyMap<string, unknown>): GcsGroupDisplaySettings {
  const d = defaultDisplaySettings(group);
  const bool = (key: string, fallback: boolean) => {
    const v = stored.get(key);
    return typeof v === "boolean" ? v : fallback;
  };
  const p = stored.get(GROUP_DISPLAY_SETTING.priority);
  return {
    priority: typeof p === "number" && Number.isInteger(p) ? Math.min(GROUP_PRIORITY_RANGE.max, Math.max(GROUP_PRIORITY_RANGE.min, p)) : d.priority,
    selectable: bool(GROUP_DISPLAY_SETTING.selectable, d.selectable),
    showSecondary: bool(GROUP_DISPLAY_SETTING.showSecondary, d.showSecondary),
    primaryOnly: bool(GROUP_DISPLAY_SETTING.primaryOnly, d.primaryOnly),
    description: plain(stored.get(GROUP_DISPLAY_SETTING.description), GROUP_DESCRIPTION_MAX) ?? d.description,
  };
}

/** Un grup are stil de nume dacă îi dă o culoare sau un gradient (din `nameStyle` sau culoarea grupului). */
export function hasNameStyle(group: { color: string | null; nameStyle: unknown }): boolean {
  const s = (group.nameStyle ?? {}) as GcsNameStyle;
  return isHexColor(s.color) || (Array.isArray(s.gradient) && s.gradient.filter(isHexColor).length >= 2) || isHexColor(group.color);
}

export type GcsDisplayGroupInfo = { id: number; key: string; name: string; position: number; hasStyle: boolean; settings: GcsGroupDisplaySettings };

/**
 * Grupul care dă stilul numelui (id-ul lui): alegerea membrului (dacă e permisă), altfel prioritatea cea mai mare
 * dintre grupurile cu stil, altfel grupul principal. `groupIds` = toate grupurile membrului (principal + secundare).
 */
export function resolveNameGroup(input: { primaryId: number; groupIds: readonly number[]; choiceId?: number | null }, info: ReadonlyMap<number, GcsDisplayGroupInfo>): number {
  const own = [...new Set([input.primaryId, ...input.groupIds])];
  const choice = input.choiceId ?? null;
  if (choice !== null && own.includes(choice) && info.get(choice)?.settings.selectable) return choice;
  const styled = own.map((id) => info.get(id)).filter((g): g is GcsDisplayGroupInfo => g !== undefined && g.hasStyle);
  if (styled.length === 0) return input.primaryId;
  styled.sort((a, b) => b.settings.priority - a.settings.priority || Number(b.id === input.primaryId) - Number(a.id === input.primaryId) || a.position - b.position || a.id - b.id);
  return styled[0]!.id;
}

const CACHE_KEY = "groups:display";
const CACHE_TTL_SEC = 600;
const BATCH = 500;

/**
 * Grupul afișat, ținut la zi: ascultă schimbările grupurilor unui membru (`user.groups_changed`) și ale grupurilor
 * (`group.updated`: stilul, prioritatea, alegerea), salvează alegerea membrului și setările de afișare ale grupului.
 */
export class GcsGroupDisplayService {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; bus: GcsEventBus }) {}

  /** Toate grupurile, cu setările de afișare efective (cache invalidat de orice schimbare a grupurilor). */
  async info(): Promise<Map<number, GcsDisplayGroupInfo>> {
    const cached = await this.deps.cache.get<GcsDisplayGroupInfo[]>(CACHE_KEY);
    if (cached) return new Map(cached.map((g) => [g.id, g]));
    const [groups, rows] = await Promise.all([
      this.deps.db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, key: true, name: true, position: true, isVip: true, color: true, nameStyle: true } }),
      this.deps.db.groupSetting.findMany({ where: { key: { in: [...GROUP_DISPLAY_KEYS] } }, select: { groupId: true, key: true, value: true } }),
    ]);
    const byGroup = new Map<number, Map<string, unknown>>();
    for (const r of rows) {
      const m = byGroup.get(r.groupId) ?? new Map<string, unknown>();
      m.set(r.key, r.value);
      byGroup.set(r.groupId, m);
    }
    const list: GcsDisplayGroupInfo[] = groups.map((g) => ({
      id: g.id,
      key: g.key,
      name: g.name,
      position: g.position,
      hasStyle: hasNameStyle(g),
      settings: displaySettingsOf(g, byGroup.get(g.id) ?? new Map()),
    }));
    await this.deps.cache.set(CACHE_KEY, list, { ttlSec: CACHE_TTL_SEC, tags: ["name-styles"] });
    return new Map(list.map((g) => [g.id, g]));
  }

  /** Recalculează grupul afișat al acestor membri (scrie doar unde s-a schimbat). Întoarce câți s-au schimbat. */
  async refreshUsers(userIds: readonly string[]): Promise<number> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return 0;
    const info = await this.info();
    let changed = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const users = await this.deps.db.user.findMany({
        where: { id: { in: ids.slice(i, i + BATCH) } },
        select: { id: true, primaryGroupId: true, nameGroupId: true, displayGroupChoiceId: true, groups: { select: { groupId: true } } },
      });
      for (const u of users) {
        const resolved = resolveNameGroup({ primaryId: u.primaryGroupId, groupIds: u.groups.map((g) => g.groupId), choiceId: u.displayGroupChoiceId }, info);
        const next = resolved === u.primaryGroupId ? null : resolved;
        if (next !== u.nameGroupId) {
          await this.deps.db.user.update({ where: { id: u.id }, data: { nameGroupId: next } });
          changed++;
        }
      }
    }
    return changed;
  }

  /** Recalculează membrii acestor grupuri (principal sau secundar). */
  async refreshGroups(groupIds: readonly number[]): Promise<number> {
    if (groupIds.length === 0) return 0;
    const [primary, secondary] = await Promise.all([
      this.deps.db.user.findMany({ where: { primaryGroupId: { in: [...groupIds] } }, select: { id: true } }),
      this.deps.db.userGroup.findMany({ where: { groupId: { in: [...groupIds] } }, select: { userId: true } }),
    ]);
    // Și cei care au acum ca grup afișat unul dintre ele (ex. grupul a pierdut stilul sau prioritatea).
    const shown = await this.deps.db.user.findMany({ where: { nameGroupId: { in: [...groupIds] } }, select: { id: true } });
    return this.refreshUsers([...primary.map((u) => u.id), ...secondary.map((u) => u.userId), ...shown.map((u) => u.id)]);
  }

  /**
   * Ascultă schimbările: grupurile unui membru (imediat) și setările / stilul unui grup (doar când s-a schimbat ceva
   * relevant pentru afișare: stilul, prioritatea sau alegerea, comparat cu ultima stare văzută).
   */
  listen(): void {
    this.deps.bus.on("user.groups_changed", async (e) => {
      const userId = (e.payload as { userId?: unknown }).userId;
      if (typeof userId === "string") await this.refreshUsers([userId]);
    });
    this.deps.bus.on("group.updated", async (e) => {
      const groupIds = ((e.payload as { groupIds?: unknown }).groupIds ?? []) as unknown[];
      const ids = groupIds.filter((id): id is number => Number.isInteger(id));
      if (ids.length === 0) return;
      const before = this.snapshot;
      await this.deps.cache.invalidateTags(["name-styles"]);
      const info = await this.info();
      const sig = (id: number) => {
        const g = info.get(id);
        return g ? `${g.hasStyle}:${g.settings.priority}:${g.settings.selectable}:${g.position}` : "-";
      };
      this.snapshot = new Map([...info.keys()].map((id) => [id, sig(id)]));
      const touched = before === null ? ids : ids.filter((id) => before.get(id) !== sig(id));
      if (touched.length > 0) await this.refreshGroups(touched);
    });
  }

  private snapshot: Map<number, string> | null = null;

  /** Grupurile membrului (principal + secundare), cu cel afișat acum și cele pe care le poate alege. */
  async choices(userId: string): Promise<{ current: number; choiceId: number | null; groups: { id: number; key: string; name: string; selectable: boolean; primary: boolean }[] }> {
    const user = await this.deps.db.user.findUnique({ where: { id: userId }, select: { primaryGroupId: true, nameGroupId: true, displayGroupChoiceId: true, groups: { select: { groupId: true } } } });
    if (!user) throw new GcsNotFound({ entity: "user" });
    const info = await this.info();
    const ids = [user.primaryGroupId, ...user.groups.map((g) => g.groupId).filter((id) => id !== user.primaryGroupId)];
    return {
      current: user.nameGroupId ?? user.primaryGroupId,
      choiceId: user.displayGroupChoiceId,
      groups: ids
        .map((id) => info.get(id))
        .filter((g): g is GcsDisplayGroupInfo => g !== undefined)
        .map((g) => ({ id: g.id, key: g.key, name: g.name, selectable: g.settings.selectable, primary: g.id === user.primaryGroupId })),
    };
  }

  /** „Grupul afișat” ales de membru (`null` = automat, după prioritate): doar unul dintre grupurile lui care permit. */
  async choose(actor: GcsActor, groupId: number | null): Promise<void> {
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ reason: "not_member" });
    if (groupId !== null) {
      const own = await this.choices(actor.userId);
      if (!own.groups.some((g) => g.id === groupId && g.selectable)) throw new GcsValidationError({ group: "not_selectable" });
    }
    await this.deps.db.user.update({ where: { id: actor.userId }, data: { displayGroupChoiceId: groupId } });
    await this.refreshUsers([actor.userId]);
    await this.deps.bus.emit({ name: "user.display_group_changed", payload: { userId: actor.userId }, tags: [`user:${actor.userId}`] });
  }

  /** Setările de afișare ale unui grup (ACP → Grupuri): validate, cu jurnal; grupul se recalculează. */
  async setSettings(groupId: number, input: Partial<GcsGroupDisplaySettings>, actor: GcsActor): Promise<GcsGroupDisplaySettings> {
    const group = await this.deps.db.group.findUnique({ where: { id: groupId }, select: { id: true, key: true, isVip: true } });
    if (!group) throw new GcsNotFound({ entity: "group" });
    const errors: Record<string, string> = {};
    const values: [string, unknown][] = [];
    if (input.priority !== undefined) {
      if (!Number.isInteger(input.priority) || input.priority < GROUP_PRIORITY_RANGE.min || input.priority > GROUP_PRIORITY_RANGE.max) errors.priority = "invalid_range";
      else values.push([GROUP_DISPLAY_SETTING.priority, input.priority]);
    }
    for (const k of ["selectable", "showSecondary", "primaryOnly"] as const) {
      if (input[k] === undefined) continue;
      if (typeof input[k] !== "boolean") errors[k] = "invalid_type";
      else values.push([GROUP_DISPLAY_SETTING[k], input[k]]);
    }
    if (input.description !== undefined) {
      const t = plain(input.description, GROUP_DESCRIPTION_MAX);
      if (t === null) errors.description = "too_long";
      else values.push([GROUP_DISPLAY_SETTING.description, t]);
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const before = await this.deps.db.groupSetting.findMany({ where: { groupId, key: { in: values.map(([k]) => k) } }, select: { key: true, value: true } });
    await this.deps.db.$transaction(async (tx) => {
      for (const [key, value] of values) {
        await tx.groupSetting.upsert({ where: { groupId_key: { groupId, key } }, create: { groupId, key, value: value as never }, update: { value: value as never } });
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "group.display",
        targetType: "group",
        targetId: String(groupId),
        before: Object.fromEntries(before.map((r) => [r.key, r.value])),
        after: Object.fromEntries(values),
        ip: actor.ip,
      });
    });
    await this.deps.cache.invalidateTags(["name-styles"]);
    await this.refreshGroups([groupId]);
    await this.deps.bus.emit({ name: "group.updated", payload: { groupIds: [groupId] }, tags: [`group:${groupId}`, "name-styles"] });
    return (await this.info()).get(groupId)!.settings;
  }
}
