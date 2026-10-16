import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import { hashPassword } from "../auth/passwords";
import { normalizeEmail, normalizeUsername, validateUsername } from "../auth/usernames";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import { assertCanManageUser } from "../groups/rootGuard";
import type { GcsBanService } from "../moderation/bans";
import type { GcsActor } from "../permissions/types";

/** Secțiunea ACP a acțiunilor pe cont (lista și fișa membrului). */
export const MEMBERS_ACP_SECTION = "members.members";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
/** Câte rânduri primește cel mult un import CSV. */
export const CSV_IMPORT_MAX = 1000;
/** Coloanele exportului CSV, în ordine. */
export const MEMBER_CSV_COLUMNS = ["id", "name", "email", "primary_group", "secondary_groups", "joined", "last_visit", "posts", "reputation", "email_verified", "two_factor", "ip"] as const;

export type GcsCreateMemberInput = { name: string; email: string; password: string; groupId: number; emailVerified?: boolean };
export type GcsCsvImportResult = { created: number; errors: { line: number; code: string }[] };

/** O valoare CSV: între ghilimele dacă are separator, ghilimele sau linie nouă; formulele (`=`, `+`, `-`, `@`) neutralizate. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Parsează un CSV simplu (virgulă sau punct și virgulă, ghilimele duble). Întoarce rândurile ca liste de celule. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/**
 * Acțiunile pe cont din ACP → Membri (Membri v2): crearea unui membru, importul / exportul CSV, validarea, marcarea ca
 * spammer, deblocarea 2FA, resetarea forțată a parolei și dezactivarea 2FA (doar Root Admin). Fiecare scriere verifică
 * dreptul ACP și protecția Root Admin și intră în jurnal.
 */
export class GcsMemberAdmin {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService; bans: GcsBanService }) {}

  private async authorize(actor: GcsActor): Promise<void> {
    await this.deps.acp.assert(actor, MEMBERS_ACP_SECTION, "edit");
  }

  private async isRoot(actor: GcsActor): Promise<boolean> {
    const root = await this.deps.db.group.findUnique({ where: { key: "root_admin" }, select: { id: true } });
    return !!root && actor.groupIds.includes(root.id) && !actor.isBanned;
  }

  // ─── Crearea și importul ─────────────────────────────────────────────────────────────────────────────────

  private async validateNew(input: GcsCreateMemberInput): Promise<{ name: string; nameNormalized: string; email: string }> {
    const errors: Record<string, string> = {};
    const name = input.name.trim();
    const email = normalizeEmail(input.email);
    const nameError = validateUsername(name);
    if (nameError) errors.name = nameError;
    if (!EMAIL.test(email)) errors.email = "email_invalid";
    if (input.password.length < MIN_PASSWORD || input.password.length > 128) errors.password = "password_too_short";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const nameNormalized = normalizeUsername(name);
    const [nameTaken, emailTaken] = await Promise.all([
      this.deps.db.user.findUnique({ where: { nameNormalized }, select: { id: true } }),
      this.deps.db.user.findUnique({ where: { email }, select: { id: true } }),
    ]);
    if (nameTaken) errors.name = "username_taken";
    if (emailTaken) errors.email = "email_taken";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return { name, nameNormalized, email };
  }

  private async assignableGroup(actor: GcsActor, groupId: number): Promise<number> {
    const group = await this.deps.db.group.findUnique({ where: { id: groupId }, select: { id: true, key: true } });
    if (!group || group.key === "guest") throw new GcsValidationError({ groupId: "invalid_choice" });
    if (group.key === "root_admin" && !(await this.isRoot(actor))) throw new GcsForbidden({ reason: "root_protected" });
    return group.id;
  }

  /** Creează un membru cu parolă (contul „credential” al autentificării), în grupul ales; emailul e confirmat implicit. */
  async create(actor: GcsActor, input: GcsCreateMemberInput): Promise<{ id: string; name: string }> {
    await this.authorize(actor);
    return this.createOne(actor, input);
  }

  private async createOne(actor: GcsActor, input: GcsCreateMemberInput): Promise<{ id: string; name: string }> {
    const data = await this.validateNew(input);
    const groupId = await this.assignableGroup(actor, input.groupId);
    const hash = await hashPassword(input.password);
    const user = await this.deps.db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { ...data, primaryGroupId: groupId, emailVerified: input.emailVerified ?? true } });
      await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
      await writeAudit(tx, { actorId: actor.userId, action: "member.create", targetType: "user", targetId: user.id, after: { name: user.name, email: user.email, groupId }, ip: actor.ip });
      return user;
    });
    await this.deps.bus.emit({ name: "user.registered", payload: { userId: user.id }, tags: [] });
    return { id: user.id, name: user.name };
  }

  /**
   * Importul CSV: antetul are `name`, `email`, `password` și opțional `group` (cheia sau numele grupului; implicit
   * Membru). Rândurile valide se creează, celelalte apar în `errors` cu linia și motivul.
   */
  async importCsv(actor: GcsActor, text: string): Promise<GcsCsvImportResult> {
    await this.authorize(actor);
    const rows = parseCsv(text);
    const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    if (col("name") < 0 || col("email") < 0 || col("password") < 0) throw new GcsValidationError({ file: "csv_header" });
    if (rows.length > CSV_IMPORT_MAX) throw new GcsValidationError({ file: "too_many" }, { max: String(CSV_IMPORT_MAX) });
    const groups = await this.deps.db.group.findMany({ select: { id: true, key: true, name: true } });
    const member = groups.find((g) => g.key === "member")!;
    const groupOf = (raw: string | undefined) => {
      const v = (raw ?? "").trim().toLowerCase();
      if (!v) return member.id;
      return groups.find((g) => g.key === v || g.name.toLowerCase() === v)?.id ?? null;
    };
    const result: GcsCsvImportResult = { created: 0, errors: [] };
    for (const [i, row] of rows.entries()) {
      const line = i + 2;
      const groupId = groupOf(col("group") >= 0 ? row[col("group")] : undefined);
      if (groupId === null) {
        result.errors.push({ line, code: "group_unknown" });
        continue;
      }
      try {
        await this.createOne(actor, { name: row[col("name")] ?? "", email: row[col("email")] ?? "", password: row[col("password")] ?? "", groupId });
        result.created++;
      } catch (error) {
        if (error instanceof GcsValidationError) result.errors.push({ line, code: Object.values(error.fields)[0] ?? "validation" });
        else if (error instanceof GcsForbidden) result.errors.push({ line, code: "forbidden" });
        else throw error;
      }
    }
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "member.import_csv", targetType: "settings", targetId: "members", after: { created: result.created, errors: result.errors.length }, ip: actor.ip });
    return result;
  }

  /** Exportul CSV al membrilor care se potrivesc (`where` din căutarea listei), cel mult 50 000 de rânduri. */
  async exportCsv(actor: GcsActor, where: Prisma.UserWhereInput): Promise<string> {
    await this.deps.acp.assert(actor, MEMBERS_ACP_SECTION, "view");
    const rows = await this.deps.db.user.findMany({
      where,
      orderBy: { nameNormalized: "asc" },
      take: 50_000,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        lastActiveAt: true,
        postsCount: true,
        reputation: true,
        emailVerified: true,
        twoFactorEnabled: true,
        lastIp: true,
        registrationIp: true,
        primaryGroup: { select: { name: true } },
        groups: { select: { group: { select: { name: true } } } },
      },
    });
    const lines = [MEMBER_CSV_COLUMNS.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.name,
          r.email,
          r.primaryGroup.name,
          r.groups.map((g) => g.group.name).join("|"),
          r.createdAt,
          r.lastActiveAt,
          r.postsCount,
          r.reputation,
          r.emailVerified ? 1 : 0,
          r.twoFactorEnabled ? 1 : 0,
          r.lastIp ?? r.registrationIp,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "member.export_csv", targetType: "settings", targetId: "members", after: { rows: rows.length }, ip: actor.ip });
    return `﻿${lines.join("\r\n")}\r\n`;
  }

  // ─── Acțiunile contului ──────────────────────────────────────────────────────────────────────────────────

  /** Validează conturile (emailul confirmat de staff). Întoarce câte s-au schimbat. */
  async validate(actor: GcsActor, userIds: string[]): Promise<number> {
    await this.authorize(actor);
    let changed = 0;
    for (const userId of new Set(userIds)) {
      const { count } = await this.deps.db.user.updateMany({ where: { id: userId, emailVerified: false }, data: { emailVerified: true } });
      if (count === 0) continue;
      changed++;
      await writeAudit(this.deps.db, { actorId: actor.userId, action: "member.validate", targetType: "user", targetId: userId, ip: actor.ip });
      await this.deps.bus.emit({ name: "user.validated", payload: { userId }, tags: [`user:${userId}`] });
    }
    return changed;
  }

  /**
   * Marchează / demarchează un spammer. Marcat: și ban permanent pe cont (motivul „spam”), dacă nu are deja unul activ.
   * Demarcarea nu ridică banul (se ridică separat, din istoricul bannurilor).
   */
  async setSpammer(actor: GcsActor, userId: string, flag: boolean, reason = "spam"): Promise<void> {
    await this.authorize(actor);
    const { db, bans } = this.deps;
    await assertCanManageUser(db, actor, userId, { removesRoot: flag });
    if (actor.userId === userId && flag) throw new GcsConflict({ reason: "self" });
    const user = await db.user.findUnique({ where: { id: userId }, select: { isSpammer: true } });
    if (!user) throw new GcsNotFound({ entity: "user" });
    if (user.isSpammer === flag) return;
    await db.user.update({ where: { id: userId }, data: { isSpammer: flag } });
    await writeAudit(db, { actorId: actor.userId, action: flag ? "member.spammer" : "member.not_spammer", targetType: "user", targetId: userId, ip: actor.ip });
    if (flag) {
      const now = new Date();
      const active = await db.ban.count({ where: { userId, type: "ACCOUNT", liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
      if (active === 0) await bans.applyBan({ type: "ACCOUNT", value: userId, userId, reason: reason.trim().slice(0, 500) || "spam", expiresAt: null }, actor);
    }
    await this.deps.bus.emit({ name: "user.spammer_changed", payload: { userId, flag }, tags: [`user:${userId}`] });
  }

  /** Deblochează 2FA (prea multe coduri greșite). Întoarce `false` dacă nu era blocat. */
  async unlock(actor: GcsActor, userId: string): Promise<boolean> {
    await this.authorize(actor);
    await assertCanManageUser(this.deps.db, actor, userId);
    const { count } = await this.deps.db.twoFactor.updateMany({ where: { userId, OR: [{ lockedUntil: { not: null } }, { failedVerificationCount: { gt: 0 } }] }, data: { lockedUntil: null, failedVerificationCount: 0 } });
    if (count > 0) await writeAudit(this.deps.db, { actorId: actor.userId, action: "member.unlock", targetType: "user", targetId: userId, ip: actor.ip });
    return count > 0;
  }

  /**
   * Resetarea forțată a parolei: sesiunile se închid, iar la următoarea autentificare membrul e trimis la Setări → Cont
   * până își schimbă parola. Doar pentru conturile cu parolă.
   */
  async requestPasswordReset(actor: GcsActor, userId: string, now = new Date()): Promise<void> {
    await this.authorize(actor);
    const { db } = this.deps;
    await assertCanManageUser(db, actor, userId);
    const account = await db.account.findFirst({ where: { userId, providerId: "credential", password: { not: null } }, select: { id: true } });
    if (!account) throw new GcsConflict({ reason: "no_password" });
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordResetRequestedAt: now } });
      if (userId !== actor.userId) await tx.session.deleteMany({ where: { userId } });
      await writeAudit(tx, { actorId: actor.userId, action: "member.password_reset", targetType: "user", targetId: userId, ip: actor.ip });
    });
  }

  /** Mai are de schimbat parola cerută de staff? (contul cu parolă nu a fost actualizat după cerere) */
  async passwordResetPending(userId: string): Promise<boolean> {
    const user = await this.deps.db.user.findUnique({ where: { id: userId }, select: { passwordResetRequestedAt: true, accounts: { where: { providerId: "credential" }, select: { updatedAt: true } } } });
    const at = user?.passwordResetRequestedAt;
    if (!at) return false;
    const changed = user.accounts.some((a) => a.updatedAt.getTime() > at.getTime());
    if (changed) await this.deps.db.user.update({ where: { id: userId }, data: { passwordResetRequestedAt: null } });
    return !changed;
  }

  /** Dezactivează 2FA unui membru care nu mai are acces la aplicație. Doar un Root Admin. */
  async disableTwoFactor(actor: GcsActor, userId: string): Promise<void> {
    await this.authorize(actor);
    if (!(await this.isRoot(actor))) throw new GcsForbidden({ reason: "root_only" });
    const { db } = this.deps;
    const user = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
    if (!user) throw new GcsNotFound({ entity: "user" });
    await db.$transaction(async (tx) => {
      await tx.twoFactor.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
      await writeAudit(tx, { actorId: actor.userId, action: "member.disable_2fa", targetType: "user", targetId: userId, before: { twoFactorEnabled: user.twoFactorEnabled }, ip: actor.ip });
    });
  }
}
