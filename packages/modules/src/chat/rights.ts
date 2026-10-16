import { displaySettingsOf, GcsForbidden, GcsNotFound, GcsValidationError, type GcsActor, type GcsPermissionService } from "@gcs/core";
import type { ChatSanction, PrismaClient } from "@gcs/db";

/**
 * Drepturile de moderare ale chat-ului (permisiunile de grup `chat.<drept>`), pe care le poate primi și un membru prin
 * accesul de moderator în chat (`ChatModeratorGrant`, din ACP sau cu `/acces`).
 */
export const CHAT_MOD_RIGHTS = ["edit_any", "pin", "hide", "delete_any", "purge_user", "warn", "mute", "kick", "ban", "slow_user"] as const;
export type GcsChatRight = (typeof CHAT_MOD_RIGHTS)[number];

/** Seturile gata făcute din ACP: „Complet” și „Doar mute + kick”; `/acces` fără drepturi dă setul `command`. */
export const CHAT_MOD_PRESETS = {
  full: [...CHAT_MOD_RIGHTS],
  mute_kick: ["mute", "kick"],
  command: ["mute", "kick", "warn"],
} as const satisfies Record<string, readonly GcsChatRight[]>;

export const isChatRight = (v: unknown): v is GcsChatRight => typeof v === "string" && (CHAT_MOD_RIGHTS as readonly string[]).includes(v);

/** Numele drepturilor în `/acces` (cheia, cuvântul scurt sau cel românesc, fără diacritice). */
const RIGHT_ALIASES: Record<string, GcsChatRight | "all"> = {
  edit: "edit_any",
  edit_any: "edit_any",
  editeaza: "edit_any",
  pin: "pin",
  fixeaza: "pin",
  hide: "hide",
  ascunde: "hide",
  delete: "delete_any",
  delete_any: "delete_any",
  sterge: "delete_any",
  purge: "purge_user",
  purge_user: "purge_user",
  warn: "warn",
  avertisment: "warn",
  mute: "mute",
  kick: "kick",
  ban: "ban",
  slow: "slow_user",
  slow_user: "slow_user",
  all: "all",
  toate: "all",
  complet: "all",
};

const MAX_GRANT_MS = 365 * 86_400_000;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, z: 86_400_000 };
const strip = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export type GcsAccessCommand =
  | { command: "acces"; name: string | null; rights: GcsChatRight[] | null; ms: number | null; room: string | null; errors: string[] }
  | { command: "revoca"; name: string | null; errors: string[] };

/**
 * `/acces @nume [drepturi] [7d|12h|30m] [#cameră]` (în orice ordine), `/revoca @nume`, `/acces` singur (lista).
 * Întoarce `null` dacă textul nu e una dintre aceste comenzi. Tokenii necunoscuți ajung în `errors`.
 */
export function parseAccessCommand(text: string): GcsAccessCommand | null {
  const m = /^\/(acces|access|revoca|revoke)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const revoke = /^revo/i.test(m[1]!);
  const tokens = (m[2] ?? "").split(/\s+/).filter(Boolean);
  let name: string | null = null;
  let rights: GcsChatRight[] | null = null;
  let ms: number | null = null;
  let room: string | null = null;
  const errors: string[] = [];
  for (const tok of tokens) {
    if (tok.startsWith("@") && tok.length > 1 && name === null) {
      name = tok.slice(1);
      continue;
    }
    if (revoke) {
      errors.push(tok);
      continue;
    }
    const dur = /^(\d{1,4})([mhdz])$/i.exec(tok);
    if (dur && ms === null) {
      ms = Math.min(MAX_GRANT_MS, Number(dur[1]) * UNIT_MS[dur[2]!.toLowerCase()]!);
      if (ms <= 0) errors.push(tok);
      continue;
    }
    if (tok.startsWith("#") && room === null && /^#[a-z0-9][a-z0-9-]{1,39}$/i.test(tok)) {
      room = tok.slice(1).toLowerCase();
      continue;
    }
    const parts = strip(tok).split(",").filter(Boolean);
    const mapped = parts.map((p) => RIGHT_ALIASES[p]);
    if (parts.length > 0 && rights === null && mapped.every((r) => r !== undefined)) {
      rights = mapped.includes("all") ? [...CHAT_MOD_RIGHTS] : [...new Set(mapped as GcsChatRight[])];
      continue;
    }
    errors.push(tok);
  }
  return revoke ? { command: "revoca", name, errors } : { command: "acces", name, rights, ms, room, errors };
}

/** Sancțiunea care oprește un membru să intre în chat (kick dintr-o cameră / din tot chat-ul sau ban din chat). */
export type GcsChatBlock = { kind: "kick" | "ban"; channel: string | null; until: string | null; reason: string };

type Rank = { priority: number; root: boolean };

/**
 * Drepturile efective de moderare din chat: permisiunea grupurilor (`chat.<drept>`, Root Admin are tot) SAU un acces de
 * moderator activ, pe camera dată (accesul cu camere se aplică doar acolo; o acțiune pe tot chat-ul, ex. banul, cere un
 * acces pe toate camerele). Tot aici: sancțiunile active (kick, ban, slow mode personal) și protecția membrilor de rang
 * mai mare (Root Admin și „Prioritate afișare” mai mare).
 */
export class GcsChatRights {
  constructor(private readonly deps: { db: PrismaClient; permissions: GcsPermissionService }) {}

  /** Accesul de moderator activ al membrului (sau `null`). */
  async grantOf(userId: string | null, now = new Date()) {
    if (!userId) return null;
    const g = await this.deps.db.chatModeratorGrant.findUnique({ where: { userId } });
    return g && (g.expiresAt === null || g.expiresAt > now) ? g : null;
  }

  /** Drepturile actorului pe cameră (`null` = acțiune pe tot chat-ul), în ordinea din `CHAT_MOD_RIGHTS`. */
  async rights(actor: GcsActor, channelKey: string | null): Promise<GcsChatRight[]> {
    if (!actor.userId || actor.isBanned) return [];
    const grant = await this.grantOf(actor.userId);
    const granted = new Set(grant && (grant.rooms.length === 0 || (channelKey !== null && grant.rooms.includes(channelKey))) ? grant.rights.filter(isChatRight) : []);
    const out: GcsChatRight[] = [];
    for (const r of CHAT_MOD_RIGHTS) if (granted.has(r) || (await this.deps.permissions.can(actor, `chat.${r}`))) out.push(r);
    return out;
  }

  async has(actor: GcsActor, right: GcsChatRight, channelKey: string | null): Promise<boolean> {
    if (!actor.userId || actor.isBanned) return false;
    if (await this.deps.permissions.can(actor, `chat.${right}`)) return true;
    const grant = await this.grantOf(actor.userId);
    return grant !== null && grant.rights.includes(right) && (grant.rooms.length === 0 || (channelKey !== null && grant.rooms.includes(channelKey)));
  }

  async assert(actor: GcsActor, right: GcsChatRight, channelKey: string | null): Promise<void> {
    if (!(await this.has(actor, right, channelKey))) throw new GcsForbidden({ permission: `chat.${right}` });
  }

  /** Poate da acces de moderator în chat (`chat.grant_access`; Root și adminii, implicit). */
  canGrant(actor: GcsActor): Promise<boolean> {
    return actor.userId !== null && !actor.isBanned ? this.deps.permissions.can(actor, "chat.grant_access") : Promise.resolve(false);
  }

  /** Kick-ul sau banul activ din chat al membrului, pentru camera dată (`channelId`). */
  async block(userId: string | null, channelId: number | null, now = new Date()): Promise<GcsChatBlock | null> {
    if (!userId) return null;
    const rows = await this.deps.db.chatSanction.findMany({
      where: {
        userId,
        kind: { in: ["KICK", "BAN"] },
        liftedAt: null,
        OR: [{ until: null }, { until: { gt: now } }],
        AND: [{ OR: [{ channelId: null }, ...(channelId !== null ? [{ channelId }] : [])] }],
      },
      include: { channel: { select: { key: true } } },
      orderBy: { id: "desc" },
    });
    // Banul are prioritate; apoi sancțiunea care ține cel mai mult.
    const best = rows.sort((a, b) => Number(b.kind === "BAN") - Number(a.kind === "BAN") || (a.until === null ? -1 : b.until === null ? 1 : b.until.getTime() - a.until.getTime()))[0];
    return best ? { kind: best.kind === "BAN" ? "ban" : "kick", channel: best.channel?.key ?? null, until: best.until?.toISOString() ?? null, reason: best.reason } : null;
  }

  /** Slow mode-ul personal activ (secundele dintre două mesaje), sau `null`. */
  async slow(userId: string, now = new Date()): Promise<ChatSanction | null> {
    return this.deps.db.chatSanction.findFirst({
      where: { userId, kind: "SLOW", liftedAt: null, OR: [{ until: null }, { until: { gt: now } }] },
      orderBy: { seconds: "desc" },
    });
  }

  /** Rangul unui membru: cea mai mare „Prioritate afișare” dintre grupurile lui și dacă e Root Admin. */
  async rank(userId: string): Promise<Rank | null> {
    const { db } = this.deps;
    const user = await db.user.findUnique({ where: { id: userId }, select: { primaryGroupId: true, groups: { select: { groupId: true } } } });
    if (!user) return null;
    const ids = [...new Set([user.primaryGroupId, ...user.groups.map((g) => g.groupId)])];
    const groups = await db.group.findMany({ where: { id: { in: ids } }, select: { key: true, isVip: true, settings: { where: { key: "display.priority" }, select: { key: true, value: true } } } });
    return {
      priority: Math.max(0, ...groups.map((g) => displaySettingsOf(g, new Map(g.settings.map((s) => [s.key, s.value]))).priority)),
      root: groups.some((g) => g.key === "root_admin"),
    };
  }

  /**
   * Actorul poate acționa asupra membrului: nu pe sine, nu pe un Root Admin (decât un alt Root) și nu pe cineva cu
   * „Prioritate afișare” mai mare; la egalitate, nu pe un alt membru al staff-ului (`chat.moderate`).
   */
  async assertCanTarget(actor: GcsActor, targetId: string): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (targetId === actor.userId) throw new GcsValidationError({ userId: "self" });
    const [mine, theirs] = await Promise.all([this.rank(actor.userId), this.rank(targetId)]);
    if (!theirs) throw new GcsNotFound({ entity: "user" });
    if (mine?.root) return;
    if (theirs.root) throw new GcsForbidden({ reason: "root_protected" });
    const my = mine?.priority ?? 0;
    if (theirs.priority > my) throw new GcsForbidden({ reason: "target_outranks" });
    if (theirs.priority === my) {
      const target = await this.deps.db.user.findUniqueOrThrow({ where: { id: targetId }, select: { primaryGroupId: true, groups: { select: { groupId: true } } } });
      const targetActor: GcsActor = { userId: targetId, groupIds: [target.primaryGroupId, ...target.groups.map((g) => g.groupId)], primaryGroupId: target.primaryGroupId, isBanned: false, ip: "" };
      if (await this.deps.permissions.can(targetActor, "chat.moderate")) throw new GcsForbidden({ reason: "target_is_staff" });
    }
  }
}
