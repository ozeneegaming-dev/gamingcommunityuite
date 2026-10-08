import { createHash, randomBytes, randomInt } from "node:crypto";
import { GcsNotFound, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor } from "@gcs/core";
import type { GameAdminSubject, Prisma, PrismaClient } from "@gcs/db";
import { SERVER_ADMINS_ACP_SECTION } from "./config";
import { cssPermissions, effectiveImmunity, mergeGrants, normalizeFlags, type GcsFlagGrant } from "./flags";
import { identityTrust, normalizePlayerName, parseTypedIdentity } from "./identity";
import type { GcsBridgeStore } from "./store";
import { authOf, identityKey, plainText, unix, type GcsBridgeAuth, type GcsBridgeServer } from "./types";

export const ADMIN_PASSWORD_MIN = 8;
const ADMIN_PASSWORD_MAX = 64;
const NOTE_MAX = 500;
const PRESET_NAME_MAX = 40;
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_NAMES = new Set(["player", "unnamed", "unconnected"]);

/** Presetările create la instalare (§4.7), editabile din ACP. */
export const DEFAULT_ADMIN_PRESETS = [
  { name: "Moderator", flags: "bceiju", immunity: 10 },
  { name: "Admin", flags: "bcdefgijmnouv", immunity: 50 },
  { name: "Head admin", flags: "abcdefghijklmnopqrstuv", immunity: 90 },
] as const;

export type GcsAdminPresetView = { id: number; name: string; flags: string; immunity: number; position: number; admins: number };
export type GcsAdminPresetInput = { name: string; flags: string; immunity: number };

export type GcsServerAdminInput = {
  subject: GameAdminSubject;
  userId?: string | null;
  /** Subiectul `PLAYER`: o identitate existentă sau un ID scris (`identity` + `identityKind`). */
  playerId?: number | null;
  identity?: string | null;
  identityKind?: "steam" | "nonsteam";
  /** Subiectul `NAME`: numele și parola (obligatorie la creare; la editare, goală = neschimbată). */
  name?: string | null;
  password?: string | null;
  serverId: number | null;
  presetId: number | null;
  flags: string | null;
  immunity: number | null;
  allowNonSteam: boolean;
  note: string;
  expiresAt: string | null;
};

/** Un admin în lista din ACP. */
export type GcsServerAdminRow = {
  id: number;
  subject: GameAdminSubject;
  label: string;
  user: { id: string; name: string } | null;
  player: { id: number; kind: string; value: string; name: string } | null;
  name: string | null;
  /** Câte identități primesc drepturile (membru: Steam + non-Steam permise). */
  identities: number;
  server: { id: number; name: string } | null;
  preset: { id: number; name: string } | null;
  flags: string;
  customFlags: boolean;
  immunity: number;
  allowNonSteam: boolean;
  note: string;
  expiresAt: string | null;
  expired: boolean;
  warnings: string[];
};

/** O intrare din lista `/admins` (§6.5). */
export type GcsBridgeAdminEntry = {
  id: number;
  auth: GcsBridgeAuth | { kind: "name"; name: string; salt: string; verifier: string };
  flags: string;
  immunity: number;
  permissions: string[];
  expiresAt: number | null;
  label: string | null;
};

/** Indexul adminilor unui server: jucătorul → intrarea, numele (subiect `NAME`) → intrarea. */
export type GcsAdminIndex = { players: Record<string, number>; names: Record<string, number> };

const ENTRY_INCLUDE = {
  preset: true,
  user: { select: { id: true, name: true, gamePlayers: { select: { id: true, kind: true, value: true } } } },
  player: { select: { id: true, kind: true, value: true, name: true } },
  server: { select: { id: true, name: true } },
} as const;
type Entry = Prisma.GameAdminGetPayload<{ include: typeof ENTRY_INCLUDE }>;

/** Verificatorul parolei unui admin pe nume: `hex(SHA-256(salt + ":" + parolă))`. */
export function passwordVerifier(salt: string, password: string): string {
  return createHash("sha256").update(`${salt}:${password}`, "utf8").digest("hex");
}

/** O parolă aleatorie de 12 caractere (butonul „Generează”). */
export function generateAdminPassword(): string {
  return Array.from({ length: 12 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join("");
}

/** Flag-urile și imunitatea efective ale unei intrări (ale ei, altfel ale presetului). */
function grantOf(e: Pick<Entry, "flags" | "immunity" | "expiresAt" | "preset">): GcsFlagGrant {
  const flags = normalizeFlags(e.flags ?? e.preset?.flags ?? "");
  return { flags, immunity: effectiveImmunity({ immunity: e.immunity, presetImmunity: e.preset?.immunity ?? null, flags }), expiresAt: e.expiresAt };
}

/** Identitățile care primesc drepturile unei intrări: membru → Steam (+ non-Steam permise), identitate → ea. */
function playersOf(e: Entry): { id: number; kind: string; value: string }[] {
  if (e.subject === "USER") return (e.user?.gamePlayers ?? []).filter((p) => p.kind === "STEAM" || (p.kind === "NONSTEAM" && e.allowNonSteam));
  if (e.subject === "PLAYER" && e.player && e.player.kind !== "NAME") return [e.player];
  return [];
}

/**
 * Adminii serverelor (specul 2026-10-08-servere-bridge §7): presetările, intrările (membru, identitate, nume + parolă),
 * lista trimisă pluginurilor (reuniunea intrărilor pe identitate), recunoașterea adminilor în joc și expirarea. Orice
 * schimbare crește versiunea listelor (ETag-ul nou face pluginul să tragă lista).
 */
export class GcsBridgeAdmins {
  constructor(private readonly deps: { db: PrismaClient; acp: GcsAcpRoleService; store: GcsBridgeStore; now?: () => number }) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  private active(now = this.now()): Prisma.GameAdminWhereInput {
    return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  }

  // ─── Presetările ───────────────────────────────────────────────────────────

  async presets(): Promise<GcsAdminPresetView[]> {
    const rows = await this.deps.db.gameAdminPreset.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], include: { _count: { select: { admins: true } } } });
    return rows.map((p) => ({ id: p.id, name: p.name, flags: p.flags, immunity: p.immunity, position: p.position, admins: p._count.admins }));
  }

  async savePreset(actor: GcsActor, id: number | null, input: GcsAdminPresetInput): Promise<{ id: number }> {
    const { db, acp, store } = this.deps;
    await acp.assert(actor, SERVER_ADMINS_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    const name = plainText(input.name, PRESET_NAME_MAX);
    if (!name) errors.name = "required";
    const flags = normalizeFlags(input.flags);
    if (!flags) errors.flags = "required";
    if (!Number.isInteger(input.immunity) || input.immunity < 0 || input.immunity > 100) errors.immunity = "invalid_range";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const before = id === null ? null : await db.gameAdminPreset.findUnique({ where: { id } });
    if (id !== null && !before) throw new GcsNotFound();
    const row = await db.$transaction(async (tx) => {
      const position = id === null ? ((await tx.gameAdminPreset.aggregate({ _max: { position: true } }))._max.position ?? -1) + 1 : undefined;
      const saved = id === null ? await tx.gameAdminPreset.create({ data: { name, flags, immunity: input.immunity, position: position! } }) : await tx.gameAdminPreset.update({ where: { id }, data: { name, flags, immunity: input.immunity } });
      await writeAudit(tx, { actorId: actor.userId, action: id === null ? "servers.preset.create" : "servers.preset.update", targetType: "game_admin_preset", targetId: String(saved.id), before: before ?? undefined, after: { name, flags, immunity: input.immunity }, ip: actor.ip });
      return saved;
    });
    await store.bumpVersion();
    return { id: row.id };
  }

  /** Ștergerea unei presetări: adminii care o folosesc fără flag-uri proprii primesc flag-urile ei (nu rămân fără drepturi). */
  async removePreset(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, store } = this.deps;
    await acp.assert(actor, SERVER_ADMINS_ACP_SECTION, "delete");
    const preset = await db.gameAdminPreset.findUnique({ where: { id } });
    if (!preset) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.gameAdmin.updateMany({ where: { presetId: id, flags: null }, data: { flags: preset.flags } });
      await tx.gameAdmin.updateMany({ where: { presetId: id, immunity: null }, data: { immunity: preset.immunity } });
      await tx.gameAdminPreset.delete({ where: { id } });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.preset.delete", targetType: "game_admin_preset", targetId: String(id), before: preset, ip: actor.ip });
    });
    await store.bumpVersion();
  }

  /** Presetările implicite, o singură dată (seed-ul modulului, marcajul `servers:presets`). */
  static async seedPresets(tx: Prisma.TransactionClient): Promise<void> {
    const state = await tx.systemState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    if (state.seedMarks.includes("servers:presets")) return;
    if ((await tx.gameAdminPreset.count()) === 0) {
      await tx.gameAdminPreset.createMany({ data: DEFAULT_ADMIN_PRESETS.map((p, position) => ({ ...p, position })) });
    }
    await tx.systemState.update({ where: { id: 1 }, data: { seedMarks: { push: "servers:presets" } } });
  }

  // ─── Intrările ─────────────────────────────────────────────────────────────

  async list(actor: GcsActor, filter: { serverId?: number | null; q?: string } = {}): Promise<GcsServerAdminRow[]> {
    await this.deps.acp.assert(actor, SERVER_ADMINS_ACP_SECTION, "view");
    const where: Prisma.GameAdminWhereInput = {};
    if (typeof filter.serverId === "number") where.OR = [{ serverId: filter.serverId }, { serverId: null }];
    const q = filter.q?.trim();
    if (q) {
      where.AND = [
        {
          OR: [
            { user: { name: { contains: q, mode: "insensitive" } } },
            { player: { name: { contains: q, mode: "insensitive" } } },
            { player: { value: { contains: q } } },
            { name: { contains: q, mode: "insensitive" } },
            { note: { contains: q, mode: "insensitive" } },
          ],
        },
      ];
    }
    const rows = await this.deps.db.gameAdmin.findMany({ where, include: ENTRY_INCLUDE, orderBy: [{ serverId: { sort: "asc", nulls: "first" } }, { id: "asc" }], take: 500 });
    const now = this.now();
    return rows.map((e) => this.row(e, now));
  }

  async get(actor: GcsActor, id: number): Promise<GcsServerAdminRow | null> {
    await this.deps.acp.assert(actor, SERVER_ADMINS_ACP_SECTION, "view");
    const e = await this.deps.db.gameAdmin.findUnique({ where: { id }, include: ENTRY_INCLUDE });
    return e ? this.row(e, this.now()) : null;
  }

  private row(e: Entry, now: Date): GcsServerAdminRow {
    const grant = grantOf(e);
    const identities = playersOf(e).length;
    const warnings: string[] = [];
    if (e.subject === "USER" && identities === 0) warnings.push("no_identity");
    if ((e.subject === "USER" && e.allowNonSteam) || (e.subject === "PLAYER" && e.player?.kind === "NONSTEAM")) warnings.push("non_steam");
    const label = e.subject === "USER" ? (e.user?.name ?? "") : e.subject === "PLAYER" ? e.player?.name || e.player?.value || "" : (e.name ?? "");
    return {
      id: e.id,
      subject: e.subject,
      label,
      user: e.user ? { id: e.user.id, name: e.user.name } : null,
      player: e.player,
      name: e.name,
      identities: e.subject === "NAME" ? 1 : identities,
      server: e.server,
      preset: e.preset ? { id: e.preset.id, name: e.preset.name } : null,
      flags: grant.flags,
      customFlags: e.flags !== null,
      immunity: grant.immunity,
      allowNonSteam: e.allowNonSteam,
      note: e.note,
      expiresAt: e.expiresAt?.toISOString() ?? null,
      expired: e.expiresAt !== null && e.expiresAt <= now,
      warnings,
    };
  }

  async save(actor: GcsActor, id: number | null, input: GcsServerAdminInput): Promise<{ id: number }> {
    const { db, acp, store } = this.deps;
    await acp.assert(actor, SERVER_ADMINS_ACP_SECTION, "edit");
    const before = id === null ? null : await db.gameAdmin.findUnique({ where: { id } });
    if (id !== null && !before) throw new GcsNotFound();
    const data = await this.validate(input, before);
    const row = await db.$transaction(async (tx) => {
      const saved = id === null ? await tx.gameAdmin.create({ data: { ...data, createdById: actor.userId } }) : await tx.gameAdmin.update({ where: { id }, data: { ...data, expiredLoggedAt: null } });
      const { passwordSalt: _s, passwordVerifier: _v, ...visible } = data;
      await writeAudit(tx, {
        actorId: actor.userId,
        action: id === null ? "servers.admin.create" : "servers.admin.update",
        targetType: "game_admin",
        targetId: String(saved.id),
        before: before ? { ...before, passwordSalt: undefined, passwordVerifier: undefined } : undefined,
        after: { ...visible, passwordChanged: data.passwordVerifier !== undefined },
        ip: actor.ip,
      });
      return saved;
    });
    await store.bumpVersion();
    return { id: row.id };
  }

  private async validate(input: GcsServerAdminInput, before: { id: number; subject: GameAdminSubject; passwordVerifier: string | null } | null): Promise<Prisma.GameAdminUncheckedCreateInput> {
    const { db } = this.deps;
    const errors: Record<string, string> = {};
    const subject = input.subject;
    if (!["USER", "PLAYER", "NAME"].includes(subject)) throw new GcsValidationError({ subject: "invalid" });
    const data: Prisma.GameAdminUncheckedCreateInput = { subject, userId: null, playerId: null, name: null, nameNormalized: null, allowNonSteam: false };

    if (subject === "USER") {
      const user = typeof input.userId === "string" ? await db.user.findUnique({ where: { id: input.userId }, select: { id: true } }) : null;
      if (!user) errors.userId = "invalid";
      else data.userId = user.id;
      data.allowNonSteam = input.allowNonSteam === true;
    } else if (subject === "PLAYER") {
      let playerId: number | null = null;
      if (Number.isInteger(input.playerId)) {
        const p = await db.gamePlayer.findUnique({ where: { id: input.playerId! }, select: { id: true, kind: true } });
        if (p && p.kind !== "NAME") playerId = p.id;
      } else {
        const typed = parseTypedIdentity(input.identity, input.identityKind);
        if (typed) {
          const p = await db.gamePlayer.upsert({
            where: { kind_value: { kind: typed.kind, value: typed.value } },
            create: { kind: typed.kind, value: typed.value, trust: identityTrust(typed.kind) },
            update: {},
            select: { id: true },
          });
          playerId = p.id;
        }
      }
      if (playerId === null) errors.identity = "invalid";
      else data.playerId = playerId;
    } else {
      const display = plainText(input.name, 32);
      const normalized = normalizePlayerName(display);
      if (!normalized || DEFAULT_NAMES.has(normalized)) errors.name = "invalid";
      else {
        const taken = await db.gameAdmin.findFirst({ where: { subject: "NAME", nameNormalized: normalized, ...(before ? { NOT: { id: before.id } } : {}) }, select: { id: true } });
        if (taken) errors.name = "duplicate";
        data.name = display;
        data.nameNormalized = normalized;
      }
      const password = typeof input.password === "string" ? input.password : "";
      const keepPassword = before?.subject === "NAME" && before.passwordVerifier !== null && password === "";
      if (!keepPassword) {
        if (password.length < ADMIN_PASSWORD_MIN || password.length > ADMIN_PASSWORD_MAX || /[\u0000-\u001F\u007F]/.test(password)) errors.password = "weak_password";
        else {
          // Sare nouă la fiecare schimbare: o parolă nouă = verificator nou.
          data.passwordSalt = randomBytes(16).toString("hex");
          data.passwordVerifier = passwordVerifier(data.passwordSalt, password);
        }
      }
    }

    if (input.serverId !== null) {
      const server = Number.isInteger(input.serverId) ? await db.gameServer.findUnique({ where: { id: input.serverId }, select: { id: true } }) : null;
      if (!server) errors.serverId = "invalid";
    }
    data.serverId = input.serverId;
    if (input.presetId !== null) {
      const preset = Number.isInteger(input.presetId) ? await db.gameAdminPreset.findUnique({ where: { id: input.presetId }, select: { id: true } }) : null;
      if (!preset) errors.presetId = "invalid";
    }
    data.presetId = input.presetId;
    const flags = input.flags === null ? "" : normalizeFlags(input.flags);
    data.flags = flags === "" ? null : flags;
    if (data.flags === null && input.presetId === null) errors.flags = "required";
    if (input.immunity !== null && (!Number.isInteger(input.immunity) || input.immunity < 0 || input.immunity > 100)) errors.immunity = "invalid_range";
    data.immunity = input.immunity;
    data.note = plainText(input.note, NOTE_MAX);
    data.expiresAt = null;
    if (input.expiresAt) {
      const at = new Date(input.expiresAt);
      if (Number.isNaN(at.getTime()) || at <= this.now()) errors.expiresAt = "invalid";
      else data.expiresAt = at;
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return data;
  }

  async remove(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, store } = this.deps;
    await acp.assert(actor, SERVER_ADMINS_ACP_SECTION, "delete");
    const before = await db.gameAdmin.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.gameAdmin.delete({ where: { id } });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.admin.delete", targetType: "game_admin", targetId: String(id), before: { ...before, passwordSalt: undefined, passwordVerifier: undefined }, ip: actor.ip });
    });
    await store.bumpVersion();
  }

  // ─── Lista serverului și recunoașterea în joc ─────────────────────────────

  /** Intrările active care se aplică pe server (ale serverului și cele „toate serverele”). */
  private async entriesFor(serverId: number): Promise<Entry[]> {
    return this.deps.db.gameAdmin.findMany({ where: { AND: [{ OR: [{ serverId }, { serverId: null }] }, this.active()] }, include: ENTRY_INCLUDE, orderBy: { id: "asc" } });
  }

  /**
   * Lista `/admins` a serverului (§6.5): o intrare pe identitate; mai multe intrări pe aceeași identitate → reuniunea
   * flag-urilor, imunitatea maximă, expirarea cea mai târzie. Adminii pe nume poartă doar sarea și verificatorul.
   */
  async serverList(server: Pick<GcsBridgeServer, "id" | "game">): Promise<GcsBridgeAdminEntry[]> {
    return this.deps.store.cachedList("admins", server.id, async () => {
      const groups = new Map<string, { id: number; auth: GcsBridgeAdminEntry["auth"]; grants: GcsFlagGrant[]; label: { name: string; immunity: number } | null }>();
      for (const e of await this.entriesFor(server.id)) {
        const grant = grantOf(e);
        if (!grant.flags) continue;
        const label = e.preset ? { name: e.preset.name, immunity: grant.immunity } : null;
        const targets: { key: string; auth: GcsBridgeAdminEntry["auth"] }[] =
          e.subject === "NAME"
            ? e.nameNormalized && e.passwordSalt && e.passwordVerifier
              ? [{ key: `name:${e.nameNormalized}`, auth: { kind: "name", name: e.nameNormalized, salt: e.passwordSalt, verifier: e.passwordVerifier } }]
              : []
            : playersOf(e).flatMap((p) => {
                const auth = authOf(p.kind, p.value, server.game);
                return auth ? [{ key: identityKey(p.kind, p.value), auth }] : [];
              });
        for (const t of targets) {
          const g = groups.get(t.key);
          if (!g) groups.set(t.key, { id: e.id, auth: t.auth, grants: [grant], label });
          else {
            g.grants.push(grant);
            if (label && (!g.label || label.immunity > g.label.immunity)) g.label = label;
          }
        }
      }
      return [...groups.values()]
        .map((g) => {
          const merged = mergeGrants(g.grants);
          return { id: g.id, auth: g.auth, flags: merged.flags, immunity: merged.immunity, permissions: cssPermissions(merged.flags), expiresAt: unix(merged.expiresAt), label: g.label?.name ?? null };
        })
        .sort((a, b) => a.id - b.id);
    });
  }

  /** Indexul de recunoaștere al serverului (jucător → intrare, nume → intrare), din cache-ul listelor. */
  async index(serverId: number): Promise<GcsAdminIndex> {
    return this.deps.store.cachedList("adminidx", serverId, async () => {
      const players: Record<string, number> = {};
      const names: Record<string, number> = {};
      for (const e of await this.entriesFor(serverId)) {
        if (!grantOf(e).flags) continue;
        for (const p of playersOf(e)) players[p.id] ??= e.id;
        if (e.subject === "NAME" && e.nameNormalized) names[e.nameNormalized] ??= e.id;
      }
      return { players, names };
    });
  }

  /** Intrarea de admin a unui jucător pe server (după identitate), sau `null`. */
  async adminFor(serverId: number, playerId: number): Promise<number | null> {
    return (await this.index(serverId)).players[playerId] ?? null;
  }

  /** O intrare `NAME` activă pe server, cu acest id (evenimentul `admin_login`). */
  async nameAdminOn(serverId: number, adminId: number): Promise<boolean> {
    const e = await this.deps.db.gameAdmin.findFirst({ where: { AND: [{ id: adminId, subject: "NAME" }, { OR: [{ serverId }, { serverId: null }] }, this.active()] }, select: { id: true } });
    return e !== null;
  }

  /** Jucătorul e admin pe toate serverele, cu flag-ul dat (bannurile / comunicațiile globale din joc, §8.3). */
  async isGlobalAdmin(player: { id: number; kind: string; userId: string | null }, flag: string): Promise<boolean> {
    const or: Prisma.GameAdminWhereInput[] = [{ subject: "PLAYER", playerId: player.id }];
    if (player.userId && (player.kind === "STEAM" || player.kind === "NONSTEAM")) {
      or.push(player.kind === "STEAM" ? { subject: "USER", userId: player.userId } : { subject: "USER", userId: player.userId, allowNonSteam: true });
    }
    const entries = await this.deps.db.gameAdmin.findMany({ where: { AND: [{ serverId: null, OR: or }, this.active()] }, include: { preset: true } });
    return entries.some((e) => grantOf(e).flags.includes(flag));
  }

  /**
   * Flag-urile membrului ca admin de server (sancțiunile de pe site, §8.1): pe serverul dat (intrările lui și cele
   * „toate serverele”) sau, cu `serverId = null`, doar din intrările pe toate serverele.
   */
  async userFlags(userId: string, serverId: number | null): Promise<string> {
    const entries = await this.deps.db.gameAdmin.findMany({
      where: { AND: [{ subject: "USER", userId }, serverId === null ? { serverId: null } : { OR: [{ serverId }, { serverId: null }] }, this.active()] },
      include: { preset: true },
    });
    return normalizeFlags(entries.map((e) => grantOf(e).flags).join(""));
  }

  /** Serverele pe care membrul are flag-ul dat (`null` în listă = toate serverele). */
  async userServers(userId: string, flag: string): Promise<(number | null)[]> {
    const entries = await this.deps.db.gameAdmin.findMany({ where: { AND: [{ subject: "USER", userId }, this.active()] }, include: { preset: true } });
    return [...new Set(entries.filter((e) => grantOf(e).flags.includes(flag)).map((e) => e.serverId))];
  }

  /** Jobul de curățenie: adminii expirați intră o dată în jurnal (`servers.admin.expire`), iar listele primesc ETag nou. */
  async expireSweep(): Promise<number> {
    const { db, store } = this.deps;
    const now = this.now();
    const expired = await db.gameAdmin.findMany({ where: { expiresAt: { lte: now }, expiredLoggedAt: null }, select: { id: true, subject: true, userId: true, serverId: true, expiresAt: true } });
    if (expired.length === 0) return 0;
    await db.$transaction(async (tx) => {
      for (const e of expired) {
        await tx.gameAdmin.update({ where: { id: e.id }, data: { expiredLoggedAt: now } });
        await writeAudit(tx, { actorId: null, action: "servers.admin.expire", targetType: "game_admin", targetId: String(e.id), before: e });
      }
    });
    await store.bumpVersion();
    return expired.length;
  }
}
