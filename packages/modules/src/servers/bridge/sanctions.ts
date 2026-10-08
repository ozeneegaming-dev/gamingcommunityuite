import { GcsForbidden, GcsNotFound, GcsValidationError, writeAudit, type GcsActor, type GcsAttachmentService, type GcsEventBus, type GcsPermissionService, type GcsSettingsService } from "@gcs/core";
import type { GamePlayerKind, GameSanctionScope, GameSanctionType, Prisma, PrismaClient } from "@gcs/db";
import type { GcsBridgeAdmins } from "./admins";
import { BRIDGE_PERMISSION, BRIDGE_SETTING, SANCTION_EVIDENCE } from "./config";
import { cleanIp, identityTrust, normalizePlayerName, parseTypedIdentity, type GcsPlayerRef } from "./identity";
import { authOf, plainText, unix, type GcsBridgeAuth, type GcsBridgeServer, type GcsPlayerRow } from "./types";

/** Lacătul scrierilor de sancțiuni: reviziile se dau în ordinea commit-urilor (sincronizarea incrementală e corectă). */
const REVISION_LOCK = 726_354_001;
export const SANCTION_REASON_MAX = 200;
export const SANCTION_PAGE = 1000;
const MAX_EVIDENCE = 10;
/** Durata maximă a unei sancțiuni temporare (10 ani); 0 = permanentă. */
const MAX_MINUTES = 5_256_000;
const PAGE_SIZE = 50;

const TYPES: GameSanctionType[] = ["BAN", "MUTE", "GAG"];
const SCOPES: GameSanctionScope[] = ["SERVER", "GLOBAL"];
/** Flag-ul AMXX cerut de fiecare tip (banul permanent cere `d`; `v` dă doar bannuri temporare). */
const FLAG_FOR: Record<GameSanctionType, string> = { BAN: "d", MUTE: "i", GAG: "i" };

export type GcsSanctionTargetInput = { playerId?: number | null; auth?: string | null; authKind?: "steam" | "nonsteam"; ip?: string | null; name?: string | null };

export type GcsSanctionInput = {
  type: GameSanctionType;
  scope: GameSanctionScope;
  serverId: number | null;
  target: GcsSanctionTargetInput;
  reason: string;
  /** 0 = permanentă. */
  minutes: number;
  evidence?: string[];
  attachmentIds?: string[];
};

export type GcsSanctionUpdate = { reason?: string; minutes?: number; scope?: GameSanctionScope; serverId?: number | null; evidence?: string[] };

/** O sancțiune în lista trimisă serverelor (§6.6); `active: false` = nu mai trebuie aplicată. */
export type GcsBridgeSanctionItem =
  | {
      id: number;
      type: "ban" | "mute" | "gag";
      active: true;
      auth: GcsBridgeAuth | null;
      ip: string | null;
      name: string | null;
      reason: string;
      createdAt: number;
      expiresAt: number | null;
      admin: string;
      scope: "server" | "global";
    }
  | { id: number; active: false };

export type GcsSanctionSyncPage = { cursor: number; full: boolean; more: boolean; sanctions: GcsBridgeSanctionItem[] };

/** O sancțiune pe site (lista publică, ACP, profilul jucătorului). IP-ul doar cu `servers.view_ips`. */
export type GcsSanctionView = {
  id: number;
  type: GameSanctionType;
  scope: GameSanctionScope;
  server: { id: number; name: string } | null;
  player: { id: number; name: string; kind: GamePlayerKind; value: string } | null;
  target: { kind: GamePlayerKind | null; value: string | null };
  ip: string | null;
  name: string | null;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
  status: "active" | "expired" | "lifted";
  admin: { name: string; userId: string | null };
  source: "SITE" | "GAME";
  lifted: { at: string; by: string; reason: string } | null;
  evidence: { url: string }[];
};

type Row = Prisma.GameSanctionGetPayload<{ include: { server: { select: { id: true; name: true } }; player: { select: { id: true; name: true; kind: true; value: true } } } }>;

/** Activă = neridicată și neexpirată. */
export function sanctionActive(s: { unbannedAt: Date | null; expiresAt: Date | null }, now: Date): boolean {
  return s.unbannedAt === null && (s.expiresAt === null || s.expiresAt > now);
}

/** Se aplică pe serverul S = globală sau a serverului S. */
const appliesTo = (s: { scope: GameSanctionScope; serverId: number | null }, serverId: number) => s.scope === "GLOBAL" || s.serverId === serverId;

/** Dovezile: adrese https, max 10, fără dubluri. */
function cleanEvidence(list: unknown, errors: Record<string, string>, room = MAX_EVIDENCE): { url: string }[] {
  const urls = [...new Set((Array.isArray(list) ? list : []).map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean))];
  if (urls.length > room) errors.evidence = "too_many";
  for (const u of urls) {
    if (u.length > 500 || !URL.canParse(u) || new URL(u).protocol !== "https:" || new URL(u).username || new URL(u).password) errors.evidence = "invalid_url";
  }
  return urls.slice(0, MAX_EVIDENCE).map((url) => ({ url }));
}

/**
 * Sancțiunile (specul 2026-10-08-servere-bridge §8): bannuri și comunicații (mute / gag) cu scop „acest server” sau
 * „toate serverele”, date de pe site (staff-ul cu `servers.sanction` sau adminii serverelor, după flag-uri) ori raportate
 * din joc. Fiecare scriere ia o revizie nouă (sincronizarea pluginurilor) și intră în jurnal.
 */
export class GcsBridgeSanctions {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      attachments: GcsAttachmentService;
      admins: GcsBridgeAdmins;
      now?: () => number;
    },
  ) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  private async lock(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REVISION_LOCK})`;
  }

  private async bumpRevision(tx: Prisma.TransactionClient, id: number): Promise<void> {
    await tx.$executeRaw`UPDATE game_sanctions SET revision = nextval('game_sync_revision') WHERE id = ${id}`;
  }

  /** Cea mai mare revizie (versiunea din heartbeat). */
  async maxRevision(): Promise<number> {
    const [row] = await this.deps.db.$queryRaw<{ max: bigint | null }[]>`SELECT max(revision) AS max FROM game_sanctions`;
    return Number(row?.max ?? 0n);
  }

  // ─── Drepturile de pe site ────────────────────────────────────────────────

  /**
   * Poate actorul da / modifica / ridica o sancțiune de acest fel? `servers.sanction` = orice server și scop; altfel un
   * admin de server (membru) pe serverele lui: ban cu `d` (oricât) sau `v` (doar temporar, ≤ `servers.tempban_max`),
   * mute / gag cu `i`; scopul global cere o intrare pe toate serverele.
   */
  async canSanction(actor: GcsActor, opts: { type: GameSanctionType; scope: GameSanctionScope; serverId: number | null; minutes: number }): Promise<boolean> {
    if (!actor.userId || actor.isBanned) return false;
    if (await this.deps.permissions.can(actor, BRIDGE_PERMISSION.sanction)) return true;
    if (opts.scope === "SERVER" && opts.serverId === null) return false;
    const flags = await this.deps.admins.userFlags(actor.userId, opts.scope === "GLOBAL" ? null : opts.serverId);
    if (opts.type !== "BAN") return flags.includes("i");
    if (flags.includes("d")) return true;
    if (!flags.includes("v") || opts.minutes <= 0) return false;
    return opts.minutes <= (await this.deps.settings.get<number>(BRIDGE_SETTING.tempbanMax));
  }

  /** Vede actorul sancțiunea (lista publică a bannurilor sau cine o poate modifica)? */
  async canView(actor: GcsActor, id: number): Promise<boolean> {
    if (actor.isBanned) return false;
    if (await this.deps.permissions.can(actor, BRIDGE_PERMISSION.bansView)) return true;
    const s = await this.deps.db.gameSanction.findUnique({ where: { id }, select: { type: true, scope: true, serverId: true } });
    return s !== null && (await this.canSanction(actor, { ...s, minutes: 1 }));
  }

  // ─── Scrierile de pe site ─────────────────────────────────────────────────

  async create(actor: GcsActor, input: GcsSanctionInput): Promise<{ id: number }> {
    const { db, attachments } = this.deps;
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.sanction });
    const errors: Record<string, string> = {};
    if (!TYPES.includes(input.type)) errors.type = "invalid";
    if (!SCOPES.includes(input.scope)) errors.scope = "invalid";
    const serverId = await this.checkServer(input.scope, input.serverId, errors);
    const minutes = input.minutes;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) errors.minutes = "invalid_range";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    // Dreptul se verifică înainte de orice scriere (ținta scrisă poate crea identitatea de joc).
    if (!(await this.canSanction(actor, { type: input.type, scope: input.scope, serverId, minutes }))) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.sanction });
    const target = await this.resolveTarget(input.target, errors);
    const reason = plainText(input.reason, SANCTION_REASON_MAX);
    if (!reason) errors.reason = "required";
    const files = [...new Set(Array.isArray(input.attachmentIds) ? input.attachmentIds.filter((a) => typeof a === "string") : [])];
    const evidence = cleanEvidence(input.evidence, errors, MAX_EVIDENCE - files.length);
    if (files.length > MAX_EVIDENCE) errors.evidence = "too_many";
    if (files.length > 0) {
      const own = await db.attachment.count({ where: { id: { in: files }, ownerId: actor.userId, contentType: null } });
      if (own !== files.length) errors.attachments = "invalid";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true } });
    const now = this.now();
    const row = await db.$transaction(async (tx) => {
      await this.lock(tx);
      const created = await tx.gameSanction.create({
        data: {
          type: input.type,
          scope: input.scope,
          serverId,
          playerId: target.playerId,
          targetKind: target.kind,
          targetValue: target.value,
          ip: target.ip,
          name: target.name,
          reason,
          createdAt: now,
          expiresAt: minutes > 0 ? new Date(now.getTime() + minutes * 60_000) : null,
          adminUserId: actor.userId,
          adminName: user.name,
          source: "SITE",
          evidence,
        },
      });
      if (files.length > 0) await attachments.attach(tx, files, { contentType: SANCTION_EVIDENCE, contentId: String(created.id), ownerId: actor.userId! });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.sanction.create", targetType: "game_sanction", targetId: String(created.id), after: { ...created, revision: String(created.revision) }, ip: actor.ip });
      return created;
    });
    await this.changed(row.id);
    return { id: row.id };
  }

  async update(actor: GcsActor, id: number, patch: GcsSanctionUpdate): Promise<void> {
    const { db } = this.deps;
    const before = await db.gameSanction.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    if (before.unbannedAt) throw new GcsValidationError({ sanction: "lifted" });
    const currentMinutes = before.expiresAt ? Math.round((before.expiresAt.getTime() - before.createdAt.getTime()) / 60_000) : 0;
    if (!(await this.canSanction(actor, { type: before.type, scope: before.scope, serverId: before.serverId, minutes: currentMinutes }))) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.sanction });
    const errors: Record<string, string> = {};
    const scope = patch.scope ?? before.scope;
    if (!SCOPES.includes(scope)) errors.scope = "invalid";
    const serverId = patch.scope !== undefined || patch.serverId !== undefined ? await this.checkServer(scope, patch.serverId !== undefined ? patch.serverId : before.serverId, errors) : before.serverId;
    const reason = patch.reason !== undefined ? plainText(patch.reason, SANCTION_REASON_MAX) : before.reason;
    if (!reason) errors.reason = "required";
    const minutes = patch.minutes ?? currentMinutes;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) errors.minutes = "invalid_range";
    const files = await db.attachment.count({ where: { contentType: SANCTION_EVIDENCE, contentId: String(id) } });
    const evidence = patch.evidence !== undefined ? cleanEvidence(patch.evidence, errors, MAX_EVIDENCE - files) : (before.evidence as { url: string }[]);
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    if (!(await this.canSanction(actor, { type: before.type, scope, serverId, minutes }))) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.sanction });
    await db.$transaction(async (tx) => {
      await this.lock(tx);
      // Durata se socotește de la data creării.
      const after = await tx.gameSanction.update({
        where: { id },
        data: { scope, serverId, reason, expiresAt: minutes > 0 ? new Date(before.createdAt.getTime() + minutes * 60_000) : null, evidence },
      });
      await this.bumpRevision(tx, id);
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "servers.sanction.update",
        targetType: "game_sanction",
        targetId: String(id),
        before: { ...before, revision: String(before.revision) },
        after: { ...after, revision: undefined },
        ip: actor.ip,
      });
    });
    await this.changed(id);
  }

  /** Ridicarea (unban / unmute / ungag) de pe site: motivul, cine, când. */
  async lift(actor: GcsActor, id: number, rawReason: string): Promise<void> {
    const { db } = this.deps;
    const before = await db.gameSanction.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    if (!(await this.canSanction(actor, { type: before.type, scope: before.scope, serverId: before.serverId, minutes: 1 }))) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.sanction });
    if (before.unbannedAt) throw new GcsValidationError({ sanction: "lifted" });
    const reason = plainText(rawReason, SANCTION_REASON_MAX);
    if (!reason) throw new GcsValidationError({ reason: "required" });
    const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId! }, select: { name: true } });
    await this.liftTx(id, { at: this.now(), byId: actor.userId, byName: user.name, reason }, async (tx) => {
      await writeAudit(tx, { actorId: actor.userId, action: "servers.sanction.lift", targetType: "game_sanction", targetId: String(id), before: { ...before, revision: String(before.revision) }, after: { reason }, ip: actor.ip });
    });
  }

  /** Ridicarea într-o tranzacție (site, joc, contestația acceptată). */
  async liftTx(id: number, by: { at: Date; byId: string | null; byName: string; reason: string }, extra?: (tx: Prisma.TransactionClient) => Promise<void>, outer?: Prisma.TransactionClient): Promise<void> {
    const run = async (tx: Prisma.TransactionClient) => {
      await this.lock(tx);
      const lifted = await tx.gameSanction.updateMany({ where: { id, unbannedAt: null }, data: { unbannedAt: by.at, unbannedById: by.byId, unbannedByName: by.byName.slice(0, 64), unbanReason: by.reason } });
      if (lifted.count === 0) return;
      await this.bumpRevision(tx, id);
      await extra?.(tx);
    };
    if (outer) await run(outer);
    else await this.deps.db.$transaction(run);
    if (!outer) await this.changed(id);
  }

  private async checkServer(scope: GameSanctionScope, serverId: number | null, errors: Record<string, string>): Promise<number | null> {
    if (serverId === null || serverId === undefined) {
      if (scope === "SERVER") errors.serverId = "required";
      return null;
    }
    const server = Number.isInteger(serverId) ? await this.deps.db.gameServer.findUnique({ where: { id: serverId }, select: { id: true } }) : null;
    if (!server) errors.serverId = "invalid";
    return server?.id ?? null;
  }

  /**
   * Ținta: o identitate (id-ul jucătorului sau un ID scris), un IP și / sau un nume — cel puțin unul. Numele singur
   * devine o identitate `NAME` (banul pe nume se aplică doar jucătorilor non-Steam).
   */
  private async resolveTarget(input: GcsSanctionTargetInput, errors: Record<string, string>): Promise<{ playerId: number | null; kind: GamePlayerKind | null; value: string | null; ip: string | null; name: string | null }> {
    const { db } = this.deps;
    const t = input ?? {};
    let player: { id: number; kind: GamePlayerKind; value: string; name: string } | null = null;
    if (Number.isInteger(t.playerId)) {
      player = await db.gamePlayer.findUnique({ where: { id: t.playerId! }, select: { id: true, kind: true, value: true, name: true } });
      if (!player) errors.target = "invalid";
    } else if (typeof t.auth === "string" && t.auth.trim() !== "") {
      const typed = parseTypedIdentity(t.auth, t.authKind);
      if (!typed) errors.target = "invalid_identity";
      else {
        player = await db.gamePlayer.upsert({
          where: { kind_value: { kind: typed.kind, value: typed.value } },
          create: { kind: typed.kind, value: typed.value, trust: identityTrust(typed.kind) },
          update: {},
          select: { id: true, kind: true, value: true, name: true },
        });
      }
    }
    let ip: string | null = null;
    if (typeof t.ip === "string" && t.ip.trim() !== "") {
      ip = cleanIp(t.ip.trim());
      if (!ip) errors.ip = "invalid";
    }
    const name = plainText(t.name, 32) || null;
    if (player) return { playerId: player.id, kind: player.kind, value: player.value, ip, name: name ?? (player.name || null) };
    if (name) {
      const normalized = normalizePlayerName(name);
      if (!normalized) errors.name = "invalid";
      const existing = normalized ? await db.gamePlayer.findUnique({ where: { kind_value: { kind: "NAME", value: normalized } }, select: { id: true } }) : null;
      return { playerId: existing?.id ?? null, kind: normalized ? "NAME" : null, value: normalized, ip, name };
    }
    if (!ip && !errors.target) errors.target = "required";
    return { playerId: null, kind: null, value: null, ip, name: null };
  }

  // ─── Din joc ──────────────────────────────────────────────────────────────

  /**
   * Evenimentul `sanction` (§8.2): pluginul a aplicat deja local; GCS creează sancțiunea (`source = GAME`) și intrarea
   * din jurnal, în tranzacția evenimentului. Scopul global se acceptă doar de la un admin cunoscut pe toate serverele;
   * altfel devine „acest server” (`scope_downgraded`).
   */
  async fromGame(
    tx: Prisma.TransactionClient,
    server: GcsBridgeServer,
    ev: { type: GameSanctionType; scope: GameSanctionScope; minutes: number; reason: string; at: Date; targetRef: GcsPlayerRef & { ip?: unknown; name?: unknown } },
    ctx: { target: GcsPlayerRow | null; admin: GcsPlayerRow | null; adminName: string; adminId: number | null },
  ): Promise<{ sanctionId: number; note?: string }> {
    let scope = ev.scope;
    let note: string | undefined;
    if (scope === "GLOBAL" && !(ctx.admin && (await this.deps.admins.isGlobalAdmin(ctx.admin, FLAG_FOR[ev.type])))) {
      scope = "SERVER";
      note = "scope_downgraded";
    }
    const ip = cleanIp(ev.targetRef.ip);
    const displayName = plainText(ev.targetRef.name, 32) || null;
    let kind: GamePlayerKind | null = ctx.target?.kind ?? null;
    let value: string | null = ctx.target?.value ?? null;
    if (!ctx.target && displayName && !ip) {
      // Doar numele: un ban pe nume (se aplică jucătorilor non-Steam).
      const normalized = normalizePlayerName(displayName);
      if (normalized) {
        kind = "NAME";
        value = normalized;
      }
    }
    await this.lock(tx);
    const created = await tx.gameSanction.create({
      data: {
        type: ev.type,
        scope,
        serverId: server.id,
        playerId: ctx.target?.id ?? null,
        targetKind: kind,
        targetValue: value,
        ip,
        name: displayName ?? (ctx.target?.name || null),
        reason: plainText(ev.reason, SANCTION_REASON_MAX) || "-",
        createdAt: ev.at,
        expiresAt: ev.minutes > 0 ? new Date(ev.at.getTime() + ev.minutes * 60_000) : null,
        adminUserId: ctx.admin?.userId ?? null,
        adminPlayerId: ctx.admin?.id ?? null,
        adminName: ctx.adminName,
        source: "GAME",
      },
    });
    await tx.gameAdminAction.create({
      data: {
        serverId: server.id,
        adminPlayerId: ctx.admin?.id ?? null,
        adminUserId: ctx.admin?.userId ?? null,
        adminId: ctx.adminId,
        adminName: ctx.adminName,
        action: ev.type.toLowerCase(),
        targetPlayerId: ctx.target?.id ?? null,
        targetName: created.name ?? "",
        reason: created.reason,
        details: { minutes: ev.minutes, scope: scope.toLowerCase(), ...(note ? { note } : {}) },
        sanctionId: created.id,
        at: ev.at,
      },
    });
    return note ? { sanctionId: created.id, note } : { sanctionId: created.id };
  }

  /**
   * Evenimentul `unsanction`: ridică sancțiunea activă de acest fel pe acest server (după id sau după țintă). O sancțiune
   * globală se ridică din joc doar de un admin cunoscut pe toate serverele (aceeași regulă ca la creare).
   */
  async liftFromGame(
    tx: Prisma.TransactionClient,
    server: GcsBridgeServer,
    ev: { type: GameSanctionType; sanctionId: number | null; reason: string; at: Date; targetRef: (GcsPlayerRef & { ip?: unknown }) | null },
    ctx: { target: GcsPlayerRow | null; admin: GcsPlayerRow | null; adminName: string; adminId: number | null },
  ): Promise<{ sanctionId: number } | { error: string }> {
    const now = ev.at;
    const where: Prisma.GameSanctionWhereInput = { type: ev.type, unbannedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], AND: [{ OR: [{ scope: "GLOBAL" }, { serverId: server.id }] }] };
    if (ev.sanctionId !== null) where.id = ev.sanctionId;
    else {
      const or: Prisma.GameSanctionWhereInput[] = [];
      if (ctx.target) or.push({ targetKind: ctx.target.kind, targetValue: ctx.target.value });
      const ip = cleanIp(ev.targetRef?.ip);
      if (ip) or.push({ ip });
      if (or.length === 0) return { error: "not_found" };
      (where.AND as Prisma.GameSanctionWhereInput[]).push({ OR: or });
    }
    const found = await tx.gameSanction.findFirst({ where, orderBy: { createdAt: "desc" } });
    if (!found) return { error: "not_found" };
    if (found.scope === "GLOBAL" && !(ctx.admin && (await this.deps.admins.isGlobalAdmin(ctx.admin, FLAG_FOR[found.type])))) return { error: "forbidden_scope" };
    const reason = plainText(ev.reason, SANCTION_REASON_MAX);
    await this.liftTx(found.id, { at: ev.at, byId: ctx.admin?.userId ?? null, byName: ctx.adminName, reason }, async (t) => {
      await t.gameAdminAction.create({
        data: {
          serverId: server.id,
          adminPlayerId: ctx.admin?.id ?? null,
          adminUserId: ctx.admin?.userId ?? null,
          adminId: ctx.adminId,
          adminName: ctx.adminName,
          action: `un${found.type.toLowerCase()}`,
          targetPlayerId: found.playerId,
          targetName: found.name ?? "",
          reason,
          sanctionId: found.id,
          at: ev.at,
        },
      });
    }, tx);
    return { sanctionId: found.id };
  }

  // ─── Pentru pluginuri ─────────────────────────────────────────────────────

  private item(s: { id: number; type: GameSanctionType; scope: GameSanctionScope; targetKind: GamePlayerKind | null; targetValue: string | null; ip: string | null; reason: string; createdAt: Date; expiresAt: Date | null; adminName: string }, game: string): GcsBridgeSanctionItem {
    const auth = s.targetKind && s.targetValue ? authOf(s.targetKind, s.targetValue, game) : null;
    return {
      id: s.id,
      type: s.type.toLowerCase() as "ban" | "mute" | "gag",
      active: true,
      auth,
      ip: s.ip,
      // Banul pe nume: numele normalizat (pluginul compară la fel), doar fără identitate.
      name: s.targetKind === "NAME" ? s.targetValue : null,
      reason: s.reason,
      createdAt: unix(s.createdAt)!,
      expiresAt: unix(s.expiresAt),
      admin: s.adminName,
      scope: s.scope === "GLOBAL" ? "global" : "server",
    };
  }

  /**
   * `GET /sanctions?since=N` (§6.6): `since = 0` → doar sancțiunile active care se aplică serverului (`full`); altfel
   * toate schimbările cu revizia > N (cele care nu se mai aplică vin cu `active: false`). Pagini de max 1000 (`limit`, ex.
   * pagini mai mici pentru runtime-urile cu memorie puțină, ca AMX Mod X), în ordinea reviziei; `more` = mai sunt pagini
   * (pluginul cere din nou cu `since = cursor`).
   */
  async syncPage(server: Pick<GcsBridgeServer, "id" | "game">, since: number, limit = SANCTION_PAGE): Promise<GcsSanctionSyncPage> {
    const { db } = this.deps;
    const now = this.now();
    const max = await this.maxRevision();
    // Un cursor din viitor (ex. baza restaurată dintr-o copie) cere o sincronizare completă.
    const full = since <= 0 || since > max;
    const from = full ? 0 : since;
    const where: Prisma.GameSanctionWhereInput = { revision: { gt: BigInt(from), lte: BigInt(max) } };
    if (full) Object.assign(where, { unbannedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], AND: [{ OR: [{ scope: "GLOBAL" }, { serverId: server.id }] }] });
    const size = Math.min(SANCTION_PAGE, Math.max(1, Math.floor(limit)));
    const rows = await db.gameSanction.findMany({ where, orderBy: { revision: "asc" }, take: size + 1 });
    const more = rows.length > size;
    const page = rows.slice(0, size);
    return {
      cursor: more ? Number(page.at(-1)!.revision) : max,
      full,
      more,
      sanctions: page.map((s) => (sanctionActive(s, now) && appliesTo(s, server.id) ? this.item(s, server.game) : { id: s.id, active: false as const })),
    };
  }

  /**
   * Sancțiunile active ale unui jucător pe server (`POST /check`): după identitate, IP și — doar pentru cei care nu sunt
   * Steam — numele. Pe fiecare tip, cea care durează cel mai mult.
   */
  async activeFor(
    server: Pick<GcsBridgeServer, "id" | "game">,
    who: { player: GcsPlayerRow | null; ip: string | null; name: string | null },
  ): Promise<Record<"ban" | "mute" | "gag", GcsBridgeSanctionItem | null>> {
    const now = this.now();
    const or: Prisma.GameSanctionWhereInput[] = [];
    if (who.player) or.push({ targetKind: who.player.kind, targetValue: who.player.value });
    if (who.ip) or.push({ ip: who.ip });
    const normalized = who.player?.kind === "STEAM" ? null : normalizePlayerName(who.name);
    if (normalized && who.player?.kind !== "NAME") or.push({ targetKind: "NAME", targetValue: normalized });
    const out: Record<"ban" | "mute" | "gag", GcsBridgeSanctionItem | null> = { ban: null, mute: null, gag: null };
    if (or.length === 0) return out;
    const rows = await this.deps.db.gameSanction.findMany({
      where: { unbannedAt: null, AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { OR: [{ scope: "GLOBAL" }, { serverId: server.id }] }, { OR: or }] },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    for (const s of rows) {
      const key = s.type.toLowerCase() as "ban" | "mute" | "gag";
      const current = out[key];
      const longer = !current || !current.active ? true : current.expiresAt !== null && (s.expiresAt === null || unix(s.expiresAt)! > current.expiresAt);
      if (longer) out[key] = this.item(s, server.game);
    }
    return out;
  }

  // ─── Citirile de pe site ──────────────────────────────────────────────────

  private view(s: Row, now: Date, showIp: boolean): GcsSanctionView {
    const active = sanctionActive(s, now);
    return {
      id: s.id,
      type: s.type,
      scope: s.scope,
      server: s.server,
      player: s.player,
      target: { kind: s.targetKind, value: s.targetValue },
      ip: showIp ? s.ip : null,
      name: s.name,
      reason: s.reason,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt?.toISOString() ?? null,
      active,
      status: s.unbannedAt ? "lifted" : active ? "active" : "expired",
      admin: { name: s.adminName, userId: s.adminUserId },
      source: s.source,
      lifted: s.unbannedAt ? { at: s.unbannedAt.toISOString(), by: s.unbannedByName ?? "", reason: s.unbanReason ?? "" } : null,
      evidence: (Array.isArray(s.evidence) ? s.evidence : []) as { url: string }[],
    };
  }

  async get(actor: GcsActor, id: number): Promise<GcsSanctionView | null> {
    if (!(await this.canView(actor, id))) return null;
    const s = await this.deps.db.gameSanction.findUnique({ where: { id }, include: { server: { select: { id: true, name: true } }, player: { select: { id: true, name: true, kind: true, value: true } } } });
    return s ? this.view(s, this.now(), await this.deps.permissions.can(actor, BRIDGE_PERMISSION.viewIps)) : null;
  }

  /** Lista bannurilor și comunicațiilor (`servers.bans_view`): filtre pe tip, stare, server, jucător și căutare. */
  async list(
    actor: GcsActor,
    filter: { type?: GameSanctionType; status?: "active" | "expired" | "lifted" | "all"; serverId?: number; playerId?: number; q?: string; page?: number } = {},
  ): Promise<{ items: GcsSanctionView[]; total: number; page: number; pages: number }> {
    const { db, permissions } = this.deps;
    if (actor.isBanned || !(await permissions.can(actor, BRIDGE_PERMISSION.bansView))) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.bansView });
    const showIp = await permissions.can(actor, BRIDGE_PERMISSION.viewIps);
    const now = this.now();
    const and: Prisma.GameSanctionWhereInput[] = [];
    if (filter.type && TYPES.includes(filter.type)) and.push({ type: filter.type });
    if (filter.status === "active") and.push({ unbannedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
    else if (filter.status === "expired") and.push({ unbannedAt: null, expiresAt: { lte: now } });
    else if (filter.status === "lifted") and.push({ unbannedAt: { not: null } });
    if (typeof filter.serverId === "number") and.push({ OR: [{ scope: "GLOBAL" }, { serverId: filter.serverId }] });
    if (typeof filter.playerId === "number") and.push({ playerId: filter.playerId });
    const q = filter.q?.trim().slice(0, 64);
    if (q) {
      const typed = [parseTypedIdentity(q, "steam"), parseTypedIdentity(q, "nonsteam")].filter((x) => x !== null);
      const ip = showIp ? cleanIp(q) : null;
      and.push({
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { player: { name: { contains: q, mode: "insensitive" } } },
          { reason: { contains: q, mode: "insensitive" } },
          ...typed.map((t) => ({ targetKind: t.kind, targetValue: t.value })),
          ...(ip ? [{ ip }] : []),
        ],
      });
    }
    const where: Prisma.GameSanctionWhereInput = and.length > 0 ? { AND: and } : {};
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const [total, rows] = await Promise.all([
      db.gameSanction.count({ where }),
      db.gameSanction.findMany({ where, include: { server: { select: { id: true, name: true } }, player: { select: { id: true, name: true, kind: true, value: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ]);
    return { items: rows.map((s) => this.view(s, now, showIp)), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  }

  private async changed(id: number): Promise<void> {
    await this.deps.bus.emit({ name: "servers.sanction.changed", payload: { id }, tags: ["servers:sanctions"] });
  }
}
