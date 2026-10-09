import type { PrismaClient } from "@gcs/db";
import type Redis from "ioredis";
import type { GcsCache } from "../cache";
import { contentRefs } from "../content/renderer";
import { GcsRateLimited } from "../errors";
import type { GcsActor } from "../permissions/types";
import { isHexColor } from "./nameStyles";

/**
 * Mențiunile de grup (specul 2026-10-10-mentiuni-v2): setările fiecărui grup, ca rânduri `group_settings` cu cheile
 * de mai jos. Nu sunt permisiuni (nu se combină între grupurile autorului): descriu grupul **menționat**.
 */
export const GROUP_MENTION_SETTING = {
  enabled: "mentions.enabled",
  allowedGroups: "mentions.allowed_groups",
  notify: "mentions.notify",
  notifyLimit: "mentions.notify_limit",
  cooldownMinutes: "mentions.cooldown_minutes",
} as const;
export const GROUP_MENTION_KEYS: readonly string[] = Object.values(GROUP_MENTION_SETTING);

/** Grupurile de staff: pot fi menționate implicit și sunt, implicit, cele care pot menționa un grup. */
export const GROUP_MENTION_STAFF: readonly string[] = ["admin", "super_moderator", "moderator"];
/** Grupurile care nu pot fi menționate niciodată, orice ar fi salvat în setări. */
export const GROUP_MENTION_NEVER: readonly string[] = ["guest", "banned"];
export const GROUP_MENTION_LIMITS = { notifyLimit: { min: 1, max: 500 }, cooldownMinutes: { min: 0, max: 1440 } } as const;
const ROOT_ADMIN = "root_admin";
const BANNED = "banned";
const CACHE_KEY = "groups:mentions";
const CACHE_TTL_SEC = 600;

export type GcsGroupMentionSettings = {
  /** „Poate fi menționat”. */
  enabled: boolean;
  /** Grupurile ai căror membri pot menționa grupul (Root Admin poate oricum). */
  allowedGroupIds: number[];
  /** „Notifică membrii”. */
  notify: boolean;
  /** Câți membri primesc cel mult notificarea, la o mențiune. */
  notifyLimit: number;
  /** Pauza dintre două mențiuni ale grupului de către același membru (0 = fără pauză). */
  cooldownMinutes: number;
};

/** Un grup, cu setările de mențiune efective (salvate sau implicite). */
export type GcsMentionGroup = {
  id: number;
  key: string;
  name: string;
  color: string | null;
  icon: string | null;
  inLegend: boolean;
  settings: GcsGroupMentionSettings;
  /** Activ și nu e un grup care nu poate fi menționat niciodată (Vizitator, Banat). */
  mentionable: boolean;
};

type GroupRow = { id: number; key: string; name: string; color: string | null; icon: string | null; inLegend: boolean };

/** Valorile implicite ale unui grup: staff-ul poate fi menționat de staff, restul grupurilor nu pot fi menționate. */
export function defaultMentionSettings(groupKey: string, staffIds: number[]): GcsGroupMentionSettings {
  return { enabled: GROUP_MENTION_STAFF.includes(groupKey), allowedGroupIds: [...staffIds], notify: true, notifyLimit: 50, cooldownMinutes: 10 };
}

const clampInt = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : null;

/** Setările efective: valorile salvate valide, peste cele implicite. */
export function mentionSettingsOf(groupKey: string, stored: ReadonlyMap<string, unknown>, staffIds: number[]): GcsGroupMentionSettings {
  const d = defaultMentionSettings(groupKey, staffIds);
  const bool = (key: string, fallback: boolean) => {
    const v = stored.get(key);
    return typeof v === "boolean" ? v : fallback;
  };
  const allowed = stored.get(GROUP_MENTION_SETTING.allowedGroups);
  const { notifyLimit: nl, cooldownMinutes: cd } = GROUP_MENTION_LIMITS;
  return {
    enabled: bool(GROUP_MENTION_SETTING.enabled, d.enabled),
    allowedGroupIds: Array.isArray(allowed) ? allowed.filter((id): id is number => Number.isInteger(id)) : d.allowedGroupIds,
    notify: bool(GROUP_MENTION_SETTING.notify, d.notify),
    notifyLimit: clampInt(stored.get(GROUP_MENTION_SETTING.notifyLimit), nl.min, nl.max) ?? d.notifyLimit,
    cooldownMinutes: clampInt(stored.get(GROUP_MENTION_SETTING.cooldownMinutes), cd.min, cd.max) ?? d.cooldownMinutes,
  };
}

/** Numele unui grup comparat cu textul scris după `@`: fără diacritice, litere mici, fără spații. */
export function normalizeGroupName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Cine poate menționa ce grup (specul 2026-10-10-mentiuni-v2 §3): setările citite o dată (cache invalidat de orice
 * schimbare a grupurilor, tag-ul `name-styles`), lista pentru editor și randare, pauza dintre mențiuni (Redis).
 */
export class GcsGroupMentionService {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; redis: Redis }) {}

  /** Toate grupurile, în ordinea din ACP, cu setările de mențiune efective. */
  async groups(): Promise<GcsMentionGroup[]> {
    const cached = await this.deps.cache.get<GcsMentionGroup[]>(CACHE_KEY);
    if (cached) return cached;
    const [groups, rows] = await Promise.all([
      this.deps.db.group.findMany({
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, key: true, name: true, color: true, icon: true, inLegend: true },
      }),
      this.deps.db.groupSetting.findMany({ where: { key: { in: [...GROUP_MENTION_KEYS] } }, select: { groupId: true, key: true, value: true } }),
    ]);
    const list = toMentionGroups(groups, rows);
    await this.deps.cache.set(CACHE_KEY, list, { ttlSec: CACHE_TTL_SEC, tags: ["name-styles"] });
    return list;
  }

  async group(id: number): Promise<GcsMentionGroup | null> {
    return (await this.groups()).find((g) => g.id === id) ?? null;
  }

  /** Grupurile pe care actorul le poate menționa: activ, cu unul dintre grupurile lui în lista permisă (Root Admin: toate). */
  async mentionableBy(actor: GcsActor): Promise<GcsMentionGroup[]> {
    if (!actor.userId || actor.isBanned) return [];
    const groups = await this.groups();
    const mine = new Set(groups.filter((g) => actor.groupIds.includes(g.id)).map((g) => g.key));
    if (mine.has(BANNED)) return [];
    const root = mine.has(ROOT_ADMIN);
    return groups.filter((g) => g.mentionable && (root || g.settings.allowedGroupIds.some((id) => actor.groupIds.includes(id))));
  }

  /**
   * Lista dată renderer-ului (`GcsRenderOptions.groups`): grupurile pe care autorul le poate menționa. La o editare,
   * `keep` (documentul vechi) păstrează și pastilele deja salvate, dacă grupul încă poate fi menționat (ex. un moderator
   * care corectează postarea altcuiva nu transformă mențiunea în text).
   */
  async renderMap(actor: GcsActor, keep?: unknown): Promise<Map<string, { name: string }>> {
    const map = new Map((await this.mentionableBy(actor)).map((g) => [String(g.id), { name: g.name }]));
    if (keep !== undefined) {
      const kept = new Set(contentRefs(keep).groups);
      for (const g of await this.groups()) if (g.mentionable && kept.has(g.id)) map.set(String(g.id), { name: g.name });
    }
    return map;
  }

  /** Pauza dintre mențiuni: o mențiune a aceluiași grup, de același membru, prea devreme → `GcsRateLimited`. */
  async assertCooldown(actor: GcsActor, groupIds: number[]): Promise<void> {
    if (!actor.userId || groupIds.length === 0) return;
    const groups = await this.groups();
    for (const id of new Set(groupIds)) {
      const group = groups.find((g) => g.id === id);
      if (!group || group.settings.cooldownMinutes <= 0) continue;
      const ttl = await this.deps.redis.pttl(cooldownKey(actor.userId, id));
      if (ttl > 0) throw new GcsRateLimited({ reason: "group_mention_cooldown", retryAfter: String(Math.ceil(ttl / 1000)), group: group.name });
    }
  }

  /** Pornește pauza pentru grupurile menționate (după ce postarea sau mesajul a fost salvat). */
  async markCooldown(actor: GcsActor, groupIds: number[]): Promise<void> {
    if (!actor.userId || groupIds.length === 0) return;
    const groups = await this.groups();
    for (const id of new Set(groupIds)) {
      const minutes = groups.find((g) => g.id === id)?.settings.cooldownMinutes ?? 0;
      if (minutes > 0) await this.deps.redis.set(cooldownKey(actor.userId, id), "1", "EX", minutes * 60);
    }
  }
}

const cooldownKey = (userId: string, groupId: number) => `gcs:group-mention:${userId}:${groupId}`;

/** Grupurile cu setările efective, din rândurile citite (folosit și de pagina ACP a grupului). */
export function toMentionGroups(groups: GroupRow[], rows: { groupId: number; key: string; value: unknown }[]): GcsMentionGroup[] {
  const staffIds = groups.filter((g) => GROUP_MENTION_STAFF.includes(g.key)).map((g) => g.id);
  return groups.map((g) => {
    const stored = new Map(rows.filter((r) => r.groupId === g.id).map((r) => [r.key, r.value]));
    const settings = mentionSettingsOf(g.key, stored, staffIds);
    return { ...g, settings, mentionable: settings.enabled && !GROUP_MENTION_NEVER.includes(g.key) };
  });
}

/** Datele SVG ale unei iconițe (Font Awesome, rezolvată de apelant din numele salvat pe grup). */
export type GcsSvgIcon = { width: number; height: number; path: string };

/** Doar comenzi și numere de cale SVG: nimic din afara lor nu ajunge în CSS. */
const SVG_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]{1,20000}$/;

function svgUrl(icon: GcsSvgIcon | null | undefined): string | null {
  if (!icon || !Number.isInteger(icon.width) || !Number.isInteger(icon.height) || !SVG_PATH.test(icon.path)) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}"><path d="${icon.path}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * CSS-ul pastilelor de grup (`.gcs-groupMention[data-group-id]`), servit cu stilurile de nume (`/gcs-names.css`):
 * culoarea grupului (`--gcs-gm-color`) și iconița lui ca mască SVG (`--gcs-gm-icon`), cu `defaultIcon` pentru grupurile
 * fără iconiță. Culorile sunt validate `#RRGGBB`, căile SVG au doar caractere de cale, id-urile sunt numere întregi.
 */
export function compileGroupMentionCss(groups: { id: number; color: string | null; icon: GcsSvgIcon | null }[], defaultIcon: GcsSvgIcon | null): string {
  const parts: string[] = [];
  const fallback = svgUrl(defaultIcon);
  if (fallback) parts.push(`.gcs-groupMention{--gcs-gm-icon:${fallback};--gcs-gm-before:""}`);
  for (const g of groups) {
    if (!Number.isInteger(g.id)) continue;
    const decls: string[] = [];
    if (isHexColor(g.color)) decls.push(`--gcs-gm-color:${g.color}`);
    const icon = svgUrl(g.icon);
    if (icon) decls.push(`--gcs-gm-icon:${icon}`, `--gcs-gm-before:""`);
    if (decls.length > 0) parts.push(`.gcs-groupMention[data-group-id="${g.id}"]{${decls.join(";")}}`);
  }
  return parts.join("\n");
}
