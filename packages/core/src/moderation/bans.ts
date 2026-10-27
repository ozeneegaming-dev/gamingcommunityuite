import { BlockList, isIP } from "node:net";
import type { Ban, BanType, Prisma, PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import { normalizeEmail } from "../auth/usernames";
import type { GcsCache } from "../cache";
import { GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import { assertCanManageUser } from "../groups/rootGuard";
import type { GcsActor } from "../permissions/types";

export type GcsBanInput = {
  type: BanType;
  value: string;
  userId?: string;
  reason: string;
  expiresAt?: Date | null;
};

/** Secțiunea ACP care dă dreptul de a bana. */
const ACP_SECTION = "members.members";
/** Cheia de cache care marchează token-ul unei sesiuni șterse la ban (vezi `GcsActorResolver`). */
export const bannedSessionKey = (token: string) => `banned-session:${token}`;

/** Un interval IP (`203.0.113.0/24`, `2001:db8::/32`): adresa și prefixul, sau `null` dacă textul nu e unul valid. */
export function parseCidr(value: string): { address: string; prefix: number; family: "ipv4" | "ipv6" } | null {
  const m = /^([^/\s]+)\/(\d{1,3})$/.exec(value.trim());
  if (!m) return null;
  const family = isIP(m[1]!);
  const prefix = Number(m[2]);
  if (family === 4 && prefix <= 32) return { address: m[1]!, prefix, family: "ipv4" };
  if (family === 6 && prefix <= 128) return { address: m[1]!, prefix, family: "ipv6" };
  return null;
}

/** Adresele care nu se banează automat: locale, private, link-local (un proxy greșit ar bloca tot site-ul). */
const LOCAL_RANGES = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "0.0.0.0/8", "::1/128", "::/128", "fc00::/7", "fe80::/10"];

/** Dacă IP-ul e local / privat (vezi `LOCAL_RANGES`); un text care nu e IP contează ca local. */
export function isLocalIp(ip: string): boolean {
  if (isIP(ip) === 0) return true;
  return LOCAL_RANGES.some((r) => ipInRange(ip, r));
}

/** Domeniul unui email (`ana@Mail.ro` → `mail.ro`), pentru banurile pe domeniu (`@mail.ro`). */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 && at < email.length - 1 ? email.slice(at + 1).trim().toLowerCase() : null;
}

/** Intervalele IP banate, din cache (30 s, pe client): cererile verifică IP-ul la fiecare acces. */
const RANGES_TTL_MS = 30_000;
/**
 * Cache-ul intervalelor, comun în proces: Next încarcă pachetul în mai multe bundle-uri (acțiunile ACP, rutele de
 * autentificare), iar golirea după un ban trebuie să ajungă la toate.
 */
type RangesState = { gen: number; byDb: WeakMap<object, { at: number; gen: number; list: Ban[] }> };
const ranges = ((globalThis as { [k: symbol]: unknown })[Symbol.for("gcs.ipRanges")] ??= { gen: 0, byDb: new WeakMap() }) as RangesState;

async function activeIpRanges(db: Pick<PrismaClient, "ban">, now: Date): Promise<Ban[]> {
  const cached = ranges.byDb.get(db);
  if (cached && cached.gen === ranges.gen && now.getTime() - cached.at < RANGES_TTL_MS) return cached.list.filter((b) => !b.expiresAt || b.expiresAt > now);
  const list = await db.ban.findMany({
    where: { type: "IP", value: { contains: "/" }, liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
  });
  ranges.byDb.set(db, { at: now.getTime(), gen: ranges.gen, list });
  return list;
}

/** Golește cache-ul intervalelor (după un ban sau o ridicare), pentru orice conexiune din proces. */
export function clearIpRangeCache(_db?: object): void {
  ranges.gen++;
}

/** Dacă IP-ul e într-un interval (`BlockList`; IPv4 mapat în IPv6 se verifică și ca IPv4). */
export function ipInRange(ip: string, cidr: string): boolean {
  const range = parseCidr(cidr);
  const family = isIP(ip);
  if (!range || family === 0) return false;
  const list = new BlockList();
  list.addSubnet(range.address, range.prefix, range.family);
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return list.check(mapped[1]!, "ipv4");
  }
  return list.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Bannul activ care se potrivește cu userul, IP-ul (exact sau dintr-un interval) sau emailul (exact sau domeniul lui,
 * `@domeniu`); `null` dacă nu există.
 */
export async function findActiveBan(
  db: Pick<PrismaClient, "ban">,
  q: { userId?: string; ip?: string; email?: string },
  now = new Date(),
): Promise<Ban | null> {
  const match: Prisma.BanWhereInput[] = [];
  if (q.userId) match.push({ type: "ACCOUNT", userId: q.userId });
  if (q.ip) match.push({ type: "IP", value: q.ip });
  if (q.email) {
    const email = normalizeEmail(q.email);
    match.push({ type: "EMAIL", value: email });
    const domain = emailDomain(email);
    if (domain) match.push({ type: "EMAIL", value: `@${domain}` });
  }
  if (match.length === 0) return null;
  const exact = await db.ban.findFirst({
    where: { OR: match, liftedAt: null, AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
    orderBy: { createdAt: "desc" },
  });
  if (exact || !q.ip) return exact;
  return (await activeIpRanges(db, now)).find((b) => ipInRange(q.ip!, b.value)) ?? null;
}

export type GcsBanListFilter = { state?: "active" | "all"; type?: BanType; q?: string; page?: number };
export type GcsBanListRow = Ban & { user: { id: string; name: string } | null; createdBy: { id: string; name: string } | null };
const BANS_PER_PAGE = 50;

/**
 * Bannuri pe cont, IP sau email (spec §6.5). Un ban de cont (sau pe emailul unui cont) șterge sesiunile
 * userului și emite `user.banned`; token-urile șterse rămân marcate în cache, ca userul să vadă că e banat.
 */
export class GcsBanService {
  constructor(
    private readonly deps: { db: PrismaClient; cache: GcsCache; bus: GcsEventBus; acp: GcsAcpRoleService },
  ) {}

  activeFor(q: { userId?: string; ip?: string; email?: string }, now = new Date()): Promise<Ban | null> {
    return findActiveBan(this.deps.db, q, now);
  }

  async ban(input: GcsBanInput, actor: GcsActor): Promise<Ban> {
    await this.deps.acp.assert(actor, ACP_SECTION, "edit");
    return this.applyBan(input, actor);
  }

  /** Lista banurilor (ACP › Membri › Banuri): active sau toate, pe tip, căutare în valoare / motiv, 50 pe pagină. */
  async list(filter: GcsBanListFilter = {}, now = new Date()): Promise<{ rows: GcsBanListRow[]; total: number; page: number; pages: number }> {
    const { db } = this.deps;
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const q = filter.q?.trim();
    const where: Prisma.BanWhereInput = {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.state === "all" ? {} : { liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
      ...(q ? { AND: [{ OR: [{ value: { contains: q } }, { reason: { contains: q } }] }] } : {}),
    };
    const [total, bans] = await Promise.all([
      db.ban.count({ where }),
      db.ban.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * BANS_PER_PAGE, take: BANS_PER_PAGE }),
    ]);
    const ids = [...new Set(bans.flatMap((b) => [b.userId, b.createdById]).filter((id): id is string => id !== null))];
    const users = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u]));
    return {
      rows: bans.map((b) => ({ ...b, user: b.userId ? (users.get(b.userId) ?? null) : null, createdBy: b.createdById ? (users.get(b.createdById) ?? null) : null })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / BANS_PER_PAGE)),
    };
  }

  /**
   * Aplică un ban fără verificarea dreptului ACP (o face apelantul, ex. pragurile de avertisment).
   * Protecția Root Admin se aplică oricum.
   */
  async applyBan(input: GcsBanInput, actor: GcsActor): Promise<Ban> {
    const { db } = this.deps;
    const data = this.validate(input);

    // Userul afectat: cel banat pe cont sau cel care are emailul banat.
    const target =
      data.type === "ACCOUNT"
        ? await db.user.findUnique({ where: { id: data.userId! }, select: { id: true } })
        : data.type === "EMAIL"
          ? await db.user.findUnique({ where: { email: data.value }, select: { id: true } })
          : null;
    if (data.type === "ACCOUNT" && !target) throw new GcsNotFound({ entity: "user" });
    if (target) await assertCanManageUser(db, actor, target.id, { removesRoot: true });

    const { ban, sessions } = await db.$transaction(async (tx) => {
      const ban = await tx.ban.create({
        data: {
          type: data.type,
          value: data.value,
          userId: target?.id ?? null,
          reason: data.reason,
          expiresAt: data.expiresAt ?? null,
          createdById: actor.userId,
        },
      });
      const sessions = target
        ? await tx.session.findMany({ where: { userId: target.id }, select: { token: true, expiresAt: true } })
        : [];
      if (target) await tx.session.deleteMany({ where: { userId: target.id } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.ban",
        targetType: data.type === "ACCOUNT" ? "user" : "ban",
        targetId: target?.id ?? ban.id,
        after: { type: ban.type, value: ban.value, reason: ban.reason, expiresAt: ban.expiresAt?.toISOString() ?? null },
        ip: actor.ip,
      });
      return { ban, sessions };
    });

    if (ban.type === "IP") clearIpRangeCache(db);
    const now = Date.now();
    for (const s of sessions) {
      const ttlSec = Math.max(1, Math.ceil((s.expiresAt.getTime() - now) / 1000));
      await this.deps.cache.set(bannedSessionKey(s.token), true, { ttlSec, tags: [] });
    }
    await this.deps.bus.emit({
      name: "user.banned",
      payload: { banId: ban.id, type: ban.type, userId: target?.id ?? null },
      tags: target ? [`user:${target.id}`] : [],
    });
    return ban;
  }

  /** Ridică un ban; `section` = secțiunea ACP de unde vine cererea (pagina membrului sau lista Banuri). */
  async lift(banId: string, actor: GcsActor, section = ACP_SECTION): Promise<void> {
    await this.deps.acp.assert(actor, section, "edit");
    const ban = await this.deps.db.$transaction(async (tx) => {
      const ban = await tx.ban.findUnique({ where: { id: banId } });
      if (!ban) throw new GcsNotFound({ entity: "ban" });
      if (ban.liftedAt) return ban;
      const lifted = await tx.ban.update({ where: { id: banId }, data: { liftedAt: new Date() } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.unban",
        targetType: ban.userId ? "user" : "ban",
        targetId: ban.userId ?? ban.id,
        before: { liftedAt: null },
        after: { liftedAt: lifted.liftedAt?.toISOString() ?? null },
        ip: actor.ip,
      });
      return lifted;
    });
    if (ban.type === "IP") clearIpRangeCache(this.deps.db);
    await this.deps.bus.emit({
      name: "user.unbanned",
      payload: { banId: ban.id, userId: ban.userId },
      tags: ban.userId ? [`user:${ban.userId}`] : [],
    });
  }

  private validate(input: GcsBanInput): GcsBanInput {
    const errors: Record<string, string> = {};
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > 500) errors.reason = "invalid_length";
    let value = input.value.trim();

    if (input.type === "ACCOUNT") {
      if (!input.userId) errors.userId = "required";
      value = input.userId ?? value;
    } else if (input.type === "IP") {
      // O adresă sau un interval (CIDR), ex. `203.0.113.0/24`.
      const range = parseCidr(value);
      if (range) value = `${range.address}/${range.prefix}`;
      else if (isIP(value) === 0) errors.value = "invalid_ip";
    } else {
      // Un email sau un domeniu întreg: `@domeniu.ro` (și `*@domeniu.ro`).
      value = normalizeEmail(value.replace(/^\*@/, "@"));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/^@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) errors.value = "invalid_email";
    }
    if (input.expiresAt && Number.isNaN(input.expiresAt.getTime())) errors.expiresAt = "invalid_date";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    const result: GcsBanInput = { type: input.type, value, reason, expiresAt: input.expiresAt ?? null };
    if (input.type === "ACCOUNT") result.userId = input.userId!;
    return result;
  }
}
