import {
  GCS_RICH_FIELDS,
  GcsConflict,
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  normalizeUsername,
  renderRichField,
  richValueToDoc,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsActorResolver,
  type GcsAppService,
  type GcsAttachmentInfo,
  type GcsAttachmentService,
  type GcsCache,
  type GcsEventBus,
  type GcsJobQueue,
  type GcsPermissionService,
  type GcsRateLimiter,
  type GcsSettingsService,
  type GcsUploadedFile,
  gcsTxLock,
} from "@gcs/core";
import { Prisma, type Clan, type ClanJoinMode, type ClanRole, type PrismaClient, jsonStrings, sql } from "@gcs/db";
import { clanForumParent, createClanForum, renameClanForum, retireClanForum } from "./forum";
import { CLAN_OFFICER_RIGHTS, readClanOptions, type GcsClanOptions, type GcsClanRight } from "./options";
import type { GcsClanGameStatsSource } from "./gameStats";
import { recomputeClanRanking, rescoreClan } from "./ranking";
import { CLAN_MESSAGE_MAX, clanSlug, cleanLine, cleanText, isHexColor, nameError, normalizeClanName, normalizeLinks, normalizeTag, tagError } from "./text";

export const CLANS_ACP_SECTION = "gaming.clans";
export const CLANS_SETTINGS_ACP_SECTION = "system.settings_clans";
/** Atașamentele logo-ului și bannerului (legate de id-ul clanului). */
export const CLAN_LOGO = "clans.logo";
export const CLAN_BANNER = "clans.banner";
/** Tag-ul cache-ului cu listele clanurilor (director, widget) și tag-ul plăcii de statistici. */
export const CLANS_CACHE_TAG = "clans";
export const CLANS_STATS_TAG = "stats:clans";
export const CLAN_RANK_JOB = "clans.rank";
export const CLAN_DAILY_JOB = "clans.daily";

export const CLAN_LIMITS = { pendingInvites: 50, message: CLAN_MESSAGE_MAX, rejectReason: 500, lockReason: 300 } as const;
/** Mărimile imaginilor după recodare: logo-ul decupat pătrat, bannerul încadrat. */
export const CLAN_IMAGES = {
  logo: { width: 256, height: 256, fit: "cover" },
  banner: { width: 1600, height: 400, fit: "inside" },
} as const;
const REQUEST_LIMIT = { window: 3600, max: 10 };
const INVITE_LIMIT = { window: 3600, max: 30 };
/** Momentul ultimei ieșiri (sau excluderi) a unui membru, pentru pauza din opțiuni (max 720 h). */
const cooldownKey = (userId: string) => `clans:left:${userId}`;
const COOLDOWN_TTL_SEC = 720 * 3600;
const JOIN_MODES: readonly ClanJoinMode[] = ["OPEN", "REQUEST", "INVITE"];
/** Drepturile implicite ale ofițerilor unui clan nou (din cele permise de staff). */
const DEFAULT_OFFICER_RIGHTS: readonly GcsClanRight[] = ["invite", "requests"];
const TX = { timeout: 20_000, maxWait: 10_000 };

type Tx = Prisma.TransactionClient;
type ImageKind = keyof typeof CLAN_IMAGES;

/**
 * Ce trimite formularul clanului (creare sau setări). `logoId` / `bannerId`: atașamentul încărcat acum, `null` = scoate
 * imaginea, lipsă = neschimbat. `officerRights` și `wantForum` sunt opționale.
 */
export type GcsClanInput = {
  tag: string;
  name: string;
  description: unknown;
  color: string;
  color2: string;
  links: Record<string, unknown>;
  joinMode: string;
  logoId?: string | null;
  bannerId?: string | null;
  officerRights?: string[];
  wantForum?: boolean;
};

/** Ce poate face viewer-ul într-un clan (pagina clanului, administrarea, verificările serviciului). */
export type GcsClanAccess = {
  role: ClanRole | null;
  /** Staff pe site (`clans.moderate`) sau în ACP (`gaming.clans`). */
  staff: boolean;
  /** Liderul (într-un clan neblocat și nearhivat) sau staff-ul: tagul, numele, ofițerii, transferul, desființarea. */
  leader: boolean;
  can: Record<GcsClanRight, boolean>;
  /** Blocat sau arhivat: membrii nu mai schimbă nimic (staff-ul da). */
  frozen: boolean;
};

type Normalized = {
  tag: string;
  tagNormalized: string;
  name: string;
  nameNormalized: string;
  slug: string;
  descriptionJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
  descriptionHtml: string;
  color: string;
  color2: string;
  links: Prisma.InputJsonValue;
  joinMode: ClanJoinMode;
};

/**
 * Clanurile (specul 2026-10-08-clanuri §4): crearea și aprobarea, intrarea (liberă, cu cerere, cu invitație), rolurile,
 * ieșirea și excluderea, transferul, desființarea, blocarea și arhivarea, forumul privat, imaginile și joburile.
 * Fiecare scriere verifică pe server aplicația, permisiunile, rolul în clan și starea lui și intră în jurnal.
 */
export class GcsClanService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      bus: GcsEventBus;
      settings: GcsSettingsService;
      permissions: GcsPermissionService;
      acp: GcsAcpRoleService;
      apps: GcsAppService;
      actors: GcsActorResolver;
      attachments: GcsAttachmentService;
      rateLimiter: GcsRateLimiter;
      /** Statisticile de joc din aplicația Servere (opționale, doar citire), pentru ponderile de joc ale clasamentului. */
      gameStats?: GcsClanGameStatsSource | null;
    },
  ) {}

  options(): Promise<GcsClanOptions> {
    return readClanOptions(this.deps.settings);
  }

  private async assertApp(): Promise<void> {
    if (!(await this.deps.apps.enabled("clans"))) throw new GcsNotFound();
  }

  /** Staff pe site (`clans.moderate`) sau cu dreptul de editare pe secțiunea ACP. */
  async isStaff(actor: GcsActor): Promise<boolean> {
    if (!actor.userId || actor.isBanned) return false;
    return (await this.deps.permissions.can(actor, "clans.moderate")) || (await this.deps.acp.can(actor, CLANS_ACP_SECTION, "edit"));
  }

  /** Drepturile viewer-ului în clan (rolul, drepturile ofițerilor permise de staff, starea clanului). */
  async access(actor: GcsActor, clan: Pick<Clan, "id" | "locked" | "status" | "officerRights">, options?: GcsClanOptions): Promise<GcsClanAccess> {
    const [member, staff, opts] = await Promise.all([
      actor.userId && !actor.isBanned
        ? this.deps.db.clanMember.findUnique({ where: { clanId_userId: { clanId: clan.id, userId: actor.userId } }, select: { role: true } })
        : Promise.resolve(null),
      this.isStaff(actor),
      options ? Promise.resolve(options) : this.options(),
    ]);
    const role = member?.role ?? null;
    const frozen = clan.locked || clan.status === "ARCHIVED";
    const allowed = new Set<string>(opts.officerRights);
    const can = Object.fromEntries(
      CLAN_OFFICER_RIGHTS.map((r) => [r, staff || (!frozen && (role === "LEADER" || (role === "OFFICER" && jsonStrings(clan.officerRights).includes(r) && allowed.has(r))))]),
    ) as Record<GcsClanRight, boolean>;
    return { role, staff, leader: staff || (!frozen && role === "LEADER"), can, frozen };
  }

  private async load(clanId: number): Promise<Clan> {
    const clan = Number.isInteger(clanId) ? await this.deps.db.clan.findUnique({ where: { id: clanId } }) : null;
    if (!clan) throw new GcsNotFound();
    return clan;
  }

  /** Clanul și drepturile actorului; aruncă dacă actorul nu are dreptul cerut. */
  private async withRight(actor: GcsActor, clanId: number, right: GcsClanRight | "leader"): Promise<{ clan: Clan; access: GcsClanAccess; options: GcsClanOptions }> {
    await this.assertApp();
    const [clan, options] = await Promise.all([this.load(clanId), this.options()]);
    const access = await this.access(actor, clan, options);
    // Un clan în așteptare se vede doar de fondator și staff; pentru alții nu există.
    if (clan.status === "PENDING" && !access.staff && access.role === null) throw new GcsNotFound();
    const ok = right === "leader" ? access.leader : access.can[right];
    if (!ok) throw new GcsForbidden({ permission: `clans.${right}` });
    return { clan, access, options };
  }

  // ─── Validare ──────────────────────────────────────────────────────────────────────────────────────────────

  private validate(input: GcsClanInput, options: GcsClanOptions, required: { logo: boolean; banner: boolean }): Normalized {
    const errors: Record<string, string> = {};
    const tag = cleanLine(input.tag);
    const tagIssue = tagError(tag, { min: options.tagMin, max: options.tagMax, charset: options.tagCharset });
    if (tagIssue) errors.tag = tagIssue;
    const name = cleanLine(input.name);
    const nameIssue = nameError(name);
    if (nameIssue) errors.name = nameIssue;

    let descriptionJson: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    let descriptionHtml = "";
    if (richValueToDoc(input.description) !== null) {
      try {
        const rendered = renderRichField(input.description, GCS_RICH_FIELDS.clanDescription, { field: "description" });
        descriptionJson = rendered.json as Prisma.InputJsonValue;
        descriptionHtml = rendered.html;
      } catch (error) {
        if (error instanceof GcsValidationError) Object.assign(errors, error.fields);
        else throw error;
      }
    }
    if (options.requiredFields.includes("description") && !descriptionHtml && !errors.description) errors.description = "required";
    if (options.requiredFields.includes("logo") && !required.logo) errors.logo = "required";
    if (options.requiredFields.includes("banner") && !required.banner) errors.banner = "required";

    if (!isHexColor(input.color)) errors.color = "invalid_color";
    if (!isHexColor(input.color2)) errors.color2 = "invalid_color";
    const { links, errors: linkErrors } = normalizeLinks(input.links);
    Object.assign(errors, linkErrors);
    const joinMode = JOIN_MODES.includes(input.joinMode as ClanJoinMode) ? (input.joinMode as ClanJoinMode) : null;
    if (!joinMode) errors.joinMode = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return {
      tag,
      tagNormalized: normalizeTag(tag),
      name,
      nameNormalized: normalizeClanName(name),
      slug: clanSlug(name),
      descriptionJson,
      descriptionHtml,
      color: input.color.toUpperCase(),
      color2: input.color2.toUpperCase(),
      links: links as Prisma.InputJsonValue,
      joinMode: joinMode!,
    };
  }

  /** Drepturile ofițerilor: doar din cele permise de staff. */
  private officerRights(raw: unknown, options: GcsClanOptions): GcsClanRight[] {
    if (!Array.isArray(raw) || raw.some((r) => !(CLAN_OFFICER_RIGHTS as readonly unknown[]).includes(r))) throw new GcsValidationError({ officerRights: "invalid_choice" });
    const allowed = new Set<string>(options.officerRights);
    return CLAN_OFFICER_RIGHTS.filter((r) => raw.includes(r) && allowed.has(r));
  }

  /** Atașamentul ales: încărcat de actor (încă nelegat) sau imaginea curentă a aceluiași clan; doar imagini. */
  private async checkImage(actor: GcsActor, kind: ImageKind, id: string, clanId: number | null): Promise<void> {
    const att = await this.deps.db.attachment.findUnique({ where: { id } });
    const contentType = kind === "logo" ? CLAN_LOGO : CLAN_BANNER;
    const own = att && (att.contentType === null ? att.ownerId === actor.userId : att.contentType === contentType && clanId !== null && att.contentId === String(clanId));
    if (!att || !own || !att.mime.startsWith("image/")) throw new GcsValidationError({ [kind]: "invalid_image" });
  }

  /** Imaginile noi se leagă de clan, cele vechi se șterg (cu fișierele lor). */
  private async bindImages(clanId: number, before: { logoId: string | null; bannerId: string | null } | null, input: GcsClanInput): Promise<void> {
    const { db, attachments } = this.deps;
    for (const kind of ["logo", "banner"] as const) {
      const next = kind === "logo" ? input.logoId : input.bannerId;
      const current = before ? (kind === "logo" ? before.logoId : before.bannerId) : null;
      if (next === undefined || next === current) continue;
      const contentType = kind === "logo" ? CLAN_LOGO : CLAN_BANNER;
      await attachments.deleteFor(contentType, [String(clanId)]);
      if (next) await db.attachment.update({ where: { id: next }, data: { contentType, contentId: String(clanId) } });
      await db.clan.update({ where: { id: clanId }, data: kind === "logo" ? { logoId: next } : { bannerId: next } });
    }
  }

  /** Logo-ul sau bannerul încărcat din formular (pipeline-ul atașamentelor), încă nelegat. */
  async uploadImage(actor: GcsActor, kind: ImageKind, file: GcsUploadedFile, clanId: number | null): Promise<GcsAttachmentInfo> {
    await this.assertApp();
    if (clanId === null) await this.deps.permissions.assert(actor, "clans.create");
    else await this.withRight(actor, clanId, "edit");
    const options = await this.options();
    const maxKb = kind === "logo" ? options.logoMaxKb : options.bannerMaxKb;
    return this.deps.attachments.uploadImage(actor, file, { maxBytes: maxKb * 1024, ...CLAN_IMAGES[kind] });
  }

  // ─── Limite ────────────────────────────────────────────────────────────────────────────────────────────────

  /** Pauza rămasă după ultima ieșire a membrului (ms). */
  private async cooldownLeft(userId: string, options: GcsClanOptions, now = Date.now()): Promise<number> {
    if (options.leaveCooldownHours <= 0) return 0;
    const at = await this.deps.cache.get<string>(cooldownKey(userId));
    if (!at) return 0;
    return Math.max(0, new Date(at).getTime() + options.leaveCooldownHours * 3_600_000 - now);
  }

  private async assertNoCooldown(userId: string, options: GcsClanOptions): Promise<void> {
    const left = await this.cooldownLeft(userId, options);
    if (left > 0) throw new GcsConflict({ reason: "clan_cooldown", hours: String(Math.ceil(left / 3_600_000)) });
  }

  private startCooldown(userId: string): Promise<void> {
    return this.deps.cache.set(cooldownKey(userId), new Date().toISOString(), { ttlSec: COOLDOWN_TTL_SEC, tags: [] });
  }

  /** Limita de membri: cea pusă de staff sau `clans.max_members` al liderului (`null` = nelimitat). */
  async memberLimit(clan: Pick<Clan, "id" | "memberLimit">, db: Pick<PrismaClient, "clanMember"> = this.deps.db): Promise<number | null> {
    if (clan.memberLimit !== null) return clan.memberLimit;
    const leader = await db.clanMember.findFirst({ where: { clanId: clan.id, role: "LEADER" }, select: { userId: true } });
    if (!leader) return null;
    const value = await this.deps.permissions.groupValue<number | boolean>(await this.deps.actors.forUser(leader.userId, ""), "clans.max_members");
    if (value === -1) return null;
    return typeof value === "number" && value >= 1 ? value : 1;
  }

  /** Poate membrul să intre în clanuri (`clans.join`, fără ban)? */
  private async canJoin(userId: string): Promise<boolean> {
    const actor = await this.deps.actors.forUser(userId, "");
    return actor.userId !== null && (await this.deps.permissions.can(actor, "clans.join"));
  }

  /**
   * Intrarea unui membru, în tranzacția apelantului: lacătul membrului (clanurile lui) și al rândului clanului (limita),
   * apoi toate verificările din §4.2. Cererile și invitațiile rămase ale membrului pentru acest clan se închid.
   */
  private async addMember(tx: Tx, clanId: number, userId: string, options: GcsClanOptions, keepRequestId: number | null): Promise<void> {
    await gcsTxLock(tx, `clan-member:${userId}`);
    const rows = await tx.$queryRaw<{ id: number; status: string; locked: boolean; membersCount: number; memberLimit: number | null }[]>(sql`
      SELECT id, status::text AS status, locked, "membersCount", "memberLimit" FROM clans WHERE id = ${clanId} FOR UPDATE`);
    const clan = rows[0];
    if (!clan) throw new GcsNotFound();
    if (clan.status !== "ACTIVE" || clan.locked) throw new GcsConflict({ reason: "clan_closed" });
    if (await tx.clanMember.findUnique({ where: { clanId_userId: { clanId, userId } } })) throw new GcsConflict({ reason: "clan_already_member" });
    if ((await tx.clanMember.count({ where: { userId } })) >= options.maxPerMember) throw new GcsConflict({ reason: "clan_max_clans", max: String(options.maxPerMember) });
    const limit = await this.memberLimit({ id: clanId, memberLimit: clan.memberLimit }, tx);
    if (limit !== null && clan.membersCount >= limit) throw new GcsConflict({ reason: "clan_full" });
    const now = new Date();
    await tx.clanMember.create({ data: { clanId, userId, role: "MEMBER", joinedAt: now } });
    await tx.clan.update({ where: { id: clanId }, data: { membersCount: { increment: 1 }, lastActivityAt: now } });
    await tx.clanRequest.updateMany({
      where: { clanId, userId, status: "PENDING", ...(keepRequestId !== null ? { id: { not: keepRequestId } } : {}) },
      data: { status: "CANCELLED", decidedAt: now },
    });
  }

  /** Scoate un membru (ieșire, excludere): rândul, contorul și pauza. */
  private async removeMember(tx: Tx, clanId: number, userId: string): Promise<void> {
    await tx.clanMember.delete({ where: { clanId_userId: { clanId, userId } } });
    await tx.clan.update({ where: { id: clanId }, data: { membersCount: { decrement: 1 }, lastActivityAt: new Date() } });
  }

  // ─── Crearea, editarea, forumul ────────────────────────────────────────────────────────────────────────────

  async create(actor: GcsActor, input: GcsClanInput): Promise<{ id: number; slug: string; status: Clan["status"] }> {
    const { db, permissions } = this.deps;
    await this.assertApp();
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    await permissions.assert(actor, "clans.create");
    const options = await this.options();
    const data = this.validate(input, options, { logo: Boolean(input.logoId), banner: Boolean(input.bannerId) });
    if (input.logoId) await this.checkImage(actor, "logo", input.logoId, null);
    if (input.bannerId) await this.checkImage(actor, "banner", input.bannerId, null);
    await this.assertNoCooldown(actor.userId, options);
    const officerRights = DEFAULT_OFFICER_RIGHTS.filter((r) => options.officerRights.includes(r));
    const status = options.requireApproval ? "PENDING" : "ACTIVE";
    const userId = actor.userId;

    let created: Clan;
    try {
      created = await db.$transaction(async (tx) => {
        await gcsTxLock(tx, `clan-member:${userId}`);
        if ((await tx.clanMember.count({ where: { userId } })) >= options.maxPerMember) throw new GcsConflict({ reason: "clan_max_clans", max: String(options.maxPerMember) });
        const now = new Date();
        const clan = await tx.clan.create({
          data: {
            ...data,
            status,
            officerRights,
            membersCount: 1,
            createdById: userId,
            lastActivityAt: now,
            forumRequested: options.forumMode === "optional" && input.wantForum === true,
            ...(status === "ACTIVE" ? { approvedAt: now } : {}),
          },
        });
        await tx.clanMember.create({ data: { clanId: clan.id, userId, role: "LEADER", joinedAt: now } });
        if (status === "ACTIVE") await this.maybeCreateForum(tx, clan, options, input.wantForum === true);
        await writeAudit(tx, { actorId: userId, action: "clans.create", targetType: "clan", targetId: String(clan.id), after: { ...data, status }, ip: actor.ip });
        return clan;
      }, TX);
    } catch (error) {
      throw uniqueError(error);
    }
    await this.bindImages(created.id, null, input);
    // Un clan creat cu forum: drepturile fondatorului se recalculează.
    await this.deps.permissions.invalidateMemberGrants([userId]);
    await this.changed(created.id, { forum: status === "ACTIVE" });
    // Un clan activ intră imediat în clasament (locurile se refac).
    if (status === "ACTIVE") await this.rerank(options);
    return { id: created.id, slug: created.slug, status: created.status };
  }

  /**
   * Forumul privat la activare: `auto` îl creează mereu, `optional` doar dacă liderul l-a cerut; fără o categorie
   * validă în opțiuni, clanul rămâne fără forum (îl poate crea mai târziu). Întoarce id-ul forumului sau `null`.
   */
  private async maybeCreateForum(tx: Tx, clan: Pick<Clan, "id" | "tag" | "name" | "forumId">, options: GcsClanOptions, wanted: boolean): Promise<number | null> {
    if (clan.forumId !== null || options.forumMode === "off" || (options.forumMode === "optional" && !wanted)) return null;
    const parentId = await clanForumParent(tx, options.forumParent);
    if (parentId === null) return null;
    return createClanForum(tx, clan, { parentId, staffGroups: options.forumStaffGroups });
  }

  /** Setările clanului (formularul din administrare). Tagul, numele și drepturile ofițerilor: doar liderul sau staff-ul. */
  async update(actor: GcsActor, clanId: number, input: GcsClanInput): Promise<{ slug: string }> {
    const { db } = this.deps;
    const { clan, access, options } = await this.withRight(actor, clanId, "edit");
    const nextLogo = input.logoId === undefined ? clan.logoId : input.logoId;
    const nextBanner = input.bannerId === undefined ? clan.bannerId : input.bannerId;
    const data = this.validate(input, options, { logo: Boolean(nextLogo), banner: Boolean(nextBanner) });
    if (!access.leader && (data.tagNormalized !== clan.tagNormalized || data.tag !== clan.tag || data.name !== clan.name)) throw new GcsForbidden({ permission: "clans.leader" });
    if (input.logoId) await this.checkImage(actor, "logo", input.logoId, clan.id);
    if (input.bannerId) await this.checkImage(actor, "banner", input.bannerId, clan.id);
    const officerRights = input.officerRights === undefined ? jsonStrings(clan.officerRights) : this.officerRights(input.officerRights, options);
    if (input.officerRights !== undefined && !access.leader && officerRights.join() !== jsonStrings(clan.officerRights).join()) throw new GcsForbidden({ permission: "clans.leader" });
    try {
      await db.$transaction(async (tx) => {
        await tx.clan.update({ where: { id: clan.id }, data: { ...data, officerRights, lastActivityAt: new Date() } });
        if (clan.forumId !== null && (data.tag !== clan.tag || data.name !== clan.name)) await renameClanForum(tx, clan.forumId, data);
        await writeAudit(tx, {
          actorId: actor.userId,
          action: "clans.update",
          targetType: "clan",
          targetId: String(clan.id),
          before: pick(clan, ["tag", "name", "joinMode", "color", "color2", "links", "officerRights", "descriptionHtml"]),
          after: { tag: data.tag, name: data.name, joinMode: data.joinMode, color: data.color, color2: data.color2, links: data.links, officerRights, descriptionHtml: data.descriptionHtml },
          ip: actor.ip,
        });
      }, TX);
    } catch (error) {
      throw uniqueError(error);
    }
    await this.bindImages(clan.id, clan, input);
    // Drepturile ofițerilor pe forum se schimbă odată cu `officerRights`.
    if (officerRights.join() !== jsonStrings(clan.officerRights).join()) await this.invalidateMembers(clan.id);
    await this.changed(clan.id, { forum: data.name !== clan.name || data.tag !== clan.tag });
    return { slug: data.slug };
  }

  /** „Creează forumul clanului” (liderul sau staff-ul), când opțiunile o permit și clanul nu are încă forum. */
  async createForum(actor: GcsActor, clanId: number): Promise<number> {
    const { clan, options } = await this.withRight(actor, clanId, "leader");
    if (clan.status !== "ACTIVE") throw new GcsConflict({ reason: "clan_closed" });
    if (clan.forumId !== null) throw new GcsConflict({ reason: "clan_forum_exists" });
    if (options.forumMode === "off") throw new GcsForbidden({ permission: "clans.forum" });
    const forumId = await this.deps.db.$transaction(async (tx) => {
      const parentId = await clanForumParent(tx, options.forumParent);
      if (parentId === null) throw new GcsConflict({ reason: "clan_no_forum_parent" });
      const id = await createClanForum(tx, clan, { parentId, staffGroups: options.forumStaffGroups });
      await writeAudit(tx, { actorId: actor.userId, action: "clans.forum", targetType: "clan", targetId: String(clan.id), after: { forumId: id }, ip: actor.ip });
      return id;
    }, TX);
    await this.invalidateMembers(clan.id);
    await this.changed(clan.id, { forum: true });
    return forumId;
  }

  // ─── Intrarea: liberă, cereri, invitații ───────────────────────────────────────────────────────────────────

  /**
   * „Intră în clan”: liber la `OPEN`; la orice mod, cu o invitație în așteptare (o acceptă). Altfel cererea trece prin
   * `request`.
   */
  async join(actor: GcsActor, clanId: number): Promise<void> {
    await this.assertApp();
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const clan = await this.load(clanId);
    const invite = await this.pendingFor(clanId, actor.userId, "INVITE");
    if (invite) return this.answerInvite(actor, clanId, true);
    if (clan.joinMode !== "OPEN") throw new GcsConflict({ reason: "clan_closed" });
    await this.assertJoiner(actor);
    const options = await this.options();
    await this.assertNoCooldown(actor.userId, options);
    const userId = actor.userId;
    await this.deps.db.$transaction(async (tx) => {
      await this.addMember(tx, clan.id, userId, options, null);
      await writeAudit(tx, { actorId: userId, action: "clans.join", targetType: "clan", targetId: String(clan.id), after: { userId }, ip: actor.ip });
    }, TX);
    await this.afterMembership(clan.id, [userId], options);
  }

  private async assertJoiner(actor: GcsActor): Promise<void> {
    if (!actor.userId || !(await this.deps.permissions.can(actor, "clans.join"))) throw new GcsForbidden({ permission: "clans.join" });
  }

  private pendingFor(clanId: number, userId: string, kind: "REQUEST" | "INVITE") {
    return this.deps.db.clanRequest.findFirst({ where: { clanId, userId, kind, status: "PENDING", expiresAt: { gt: new Date() } } });
  }

  /** „Cere intrarea” (`REQUEST`), cu un mesaj opțional. Cu o invitație în așteptare, intră direct. */
  async request(actor: GcsActor, clanId: number, message: string): Promise<{ joined: boolean }> {
    const { db, rateLimiter } = this.deps;
    await this.assertApp();
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const clan = await this.load(clanId);
    if (await this.pendingFor(clanId, actor.userId, "INVITE")) {
      await this.answerInvite(actor, clanId, true);
      return { joined: true };
    }
    if (clan.status !== "ACTIVE" || clan.locked || clan.joinMode !== "REQUEST") throw new GcsConflict({ reason: "clan_closed" });
    await this.assertJoiner(actor);
    const options = await this.options();
    await this.assertNoCooldown(actor.userId, options);
    const text = cleanText(message);
    if ([...text].length > CLAN_LIMITS.message) throw new GcsValidationError({ message: "too_long" });
    if (await db.clanMember.findUnique({ where: { clanId_userId: { clanId, userId: actor.userId } } })) throw new GcsConflict({ reason: "clan_already_member" });
    if ((await db.clanMember.count({ where: { userId: actor.userId } })) >= options.maxPerMember) throw new GcsConflict({ reason: "clan_max_clans", max: String(options.maxPerMember) });
    const limit = await rateLimiter.consume(`clan-request:${actor.userId}`, REQUEST_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const userId = actor.userId;
    let requestId: number;
    try {
      requestId = await db.$transaction(async (tx) => {
        // O cerere veche, expirată dar încă marcată „în așteptare”, nu blochează una nouă.
        await tx.clanRequest.updateMany({ where: { clanId, userId, kind: "REQUEST", status: "PENDING", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
        const row = await tx.clanRequest.create({
          data: { clanId, userId, kind: "REQUEST", message: text, expiresAt: new Date(Date.now() + options.requestDays * 86_400_000) },
        });
        await writeAudit(tx, { actorId: userId, action: "clans.request", targetType: "clan", targetId: String(clanId), after: { requestId: row.id, userId }, ip: actor.ip });
        return row.id;
      }, TX);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new GcsConflict({ reason: "clan_pending_exists" });
      throw error;
    }
    const recipients = await this.rightHolders(clan, "requests", options);
    await this.deps.bus.emit({ name: "clan.requested", payload: { clanId, requestId, userId, recipients }, tags: [] });
    return { joined: false };
  }

  /** Candidatul își retrage cererea. */
  async cancelRequest(actor: GcsActor, clanId: number): Promise<void> {
    await this.assertApp();
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const pending = await this.pendingFor(clanId, actor.userId, "REQUEST");
    if (!pending) throw new GcsNotFound();
    await this.deps.db.$transaction(async (tx) => {
      await tx.clanRequest.update({ where: { id: pending.id }, data: { status: "CANCELLED", decidedAt: new Date(), decidedById: actor.userId } });
      await writeAudit(tx, { actorId: actor.userId, action: "clans.request.cancel", targetType: "clan", targetId: String(clanId), after: { requestId: pending.id }, ip: actor.ip });
    });
    await this.changed(clanId);
  }

  /** Liderul sau un ofițer cu `requests` acceptă sau refuză o cerere. */
  async decideRequest(actor: GcsActor, requestId: number, accept: boolean): Promise<void> {
    const { db } = this.deps;
    const req = Number.isInteger(requestId) ? await db.clanRequest.findUnique({ where: { id: requestId } }) : null;
    if (!req || req.kind !== "REQUEST") throw new GcsNotFound();
    const { clan, options } = await this.withRight(actor, req.clanId, "requests");
    if (req.status !== "PENDING" || req.expiresAt <= new Date()) throw new GcsConflict({ reason: "clan_request_closed" });
    if (accept) {
      if (!(await this.canJoin(req.userId))) throw new GcsConflict({ reason: "clan_cannot_join" });
      await this.assertNoCooldown(req.userId, options);
    }
    await db.$transaction(async (tx) => {
      const now = new Date();
      // Doar o decizie: rândul trebuie să fie încă în așteptare (două clickuri simultane nu dau două intrări).
      const closed = await tx.clanRequest.updateMany({
        where: { id: req.id, status: "PENDING" },
        data: { status: accept ? "ACCEPTED" : "REJECTED", decidedAt: now, decidedById: actor.userId },
      });
      if (closed.count === 0) throw new GcsConflict({ reason: "clan_request_closed" });
      if (accept) await this.addMember(tx, clan.id, req.userId, options, req.id);
      await writeAudit(tx, {
        actorId: actor.userId,
        action: accept ? "clans.request.accept" : "clans.request.reject",
        targetType: "clan",
        targetId: String(clan.id),
        after: { requestId: req.id, userId: req.userId },
        ip: actor.ip,
      });
    }, TX);
    await this.membershipNotice(clan.id, req.userId, actor.userId, accept ? "accepted" : "rejected");
    if (accept) await this.afterMembership(clan.id, [req.userId], options);
    else await this.changed(clan.id);
  }

  /** Invitația (liderul, ofițerii cu `invite`, staff-ul), după numele membrului. Un candidat cu cerere intră direct. */
  async invite(actor: GcsActor, clanId: number, userName: string): Promise<{ joined: boolean }> {
    const { db, rateLimiter } = this.deps;
    const { clan, access, options } = await this.withRight(actor, clanId, "invite");
    if (clan.status !== "ACTIVE") throw new GcsConflict({ reason: "clan_closed" });
    const name = cleanLine(userName);
    const target = name ? await db.user.findUnique({ where: { nameNormalized: normalizeUsername(name) }, select: { id: true } }) : null;
    if (!target) throw new GcsValidationError({ user: "unknown_user" });
    if (target.id === actor.userId) throw new GcsValidationError({ user: "self" });
    if (await db.clanMember.findUnique({ where: { clanId_userId: { clanId, userId: target.id } } })) throw new GcsConflict({ reason: "clan_already_member" });
    if (!(await this.canJoin(target.id))) throw new GcsConflict({ reason: "clan_cannot_join" });
    // Candidatul a cerut deja intrarea: invitația o acceptă.
    const request = await this.pendingFor(clanId, target.id, "REQUEST");
    if (request) {
      if (!access.can.requests) throw new GcsConflict({ reason: "clan_request_waiting" });
      await this.decideRequest(actor, request.id, true);
      return { joined: true };
    }
    if ((await db.clanRequest.count({ where: { clanId, kind: "INVITE", status: "PENDING", expiresAt: { gt: new Date() } } })) >= CLAN_LIMITS.pendingInvites) {
      throw new GcsConflict({ reason: "clan_invites_full" });
    }
    const limit = await rateLimiter.consume(`clan-invite:${clanId}`, INVITE_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    let inviteId: number;
    try {
      inviteId = await db.$transaction(async (tx) => {
        await tx.clanRequest.updateMany({ where: { clanId, userId: target.id, kind: "INVITE", status: "PENDING", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
        const row = await tx.clanRequest.create({
          data: { clanId, userId: target.id, kind: "INVITE", invitedById: actor.userId, expiresAt: new Date(Date.now() + options.inviteDays * 86_400_000) },
        });
        await writeAudit(tx, { actorId: actor.userId, action: "clans.invite", targetType: "clan", targetId: String(clanId), after: { inviteId: row.id, userId: target.id }, ip: actor.ip });
        return row.id;
      }, TX);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new GcsConflict({ reason: "clan_pending_exists" });
      throw error;
    }
    await this.deps.bus.emit({ name: "clan.invited", payload: { clanId, inviteId, userId: target.id, actorId: actor.userId }, tags: [] });
    await this.changed(clanId);
    return { joined: false };
  }

  /** Anularea unei invitații trimise (cine poate invita). */
  async cancelInvite(actor: GcsActor, inviteId: number): Promise<void> {
    const { db } = this.deps;
    const inv = Number.isInteger(inviteId) ? await db.clanRequest.findUnique({ where: { id: inviteId } }) : null;
    if (!inv || inv.kind !== "INVITE") throw new GcsNotFound();
    await this.withRight(actor, inv.clanId, "invite");
    if (inv.status !== "PENDING") throw new GcsConflict({ reason: "clan_request_closed" });
    await db.$transaction(async (tx) => {
      await tx.clanRequest.update({ where: { id: inv.id }, data: { status: "CANCELLED", decidedAt: new Date(), decidedById: actor.userId } });
      await writeAudit(tx, { actorId: actor.userId, action: "clans.invite.cancel", targetType: "clan", targetId: String(inv.clanId), after: { inviteId: inv.id, userId: inv.userId }, ip: actor.ip });
    });
    await this.changed(inv.clanId);
  }

  /** Invitatul acceptă (intră, cu toate verificările) sau refuză invitația. */
  async answerInvite(actor: GcsActor, clanId: number, accept: boolean): Promise<void> {
    await this.assertApp();
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const invite = await this.pendingFor(clanId, actor.userId, "INVITE");
    if (!invite) throw new GcsNotFound();
    const options = await this.options();
    if (accept) {
      await this.assertJoiner(actor);
      await this.assertNoCooldown(actor.userId, options);
    }
    const userId = actor.userId;
    await this.deps.db.$transaction(async (tx) => {
      const closed = await tx.clanRequest.updateMany({
        where: { id: invite.id, status: "PENDING" },
        data: { status: accept ? "ACCEPTED" : "REJECTED", decidedAt: new Date(), decidedById: userId },
      });
      if (closed.count === 0) throw new GcsConflict({ reason: "clan_request_closed" });
      if (accept) await this.addMember(tx, clanId, userId, options, invite.id);
      await writeAudit(tx, {
        actorId: userId,
        action: accept ? "clans.invite.accept" : "clans.invite.decline",
        targetType: "clan",
        targetId: String(clanId),
        after: { inviteId: invite.id, userId },
        ip: actor.ip,
      });
    }, TX);
    if (accept) await this.afterMembership(clanId, [userId], options);
    else await this.changed(clanId);
  }

  // ─── Rolurile, ieșirea, excluderea, transferul ─────────────────────────────────────────────────────────────

  /** Numirea (`OFFICER`) sau retrogradarea (`MEMBER`) unui membru: liderul sau staff-ul. */
  async setRole(actor: GcsActor, clanId: number, userId: string, role: "OFFICER" | "MEMBER"): Promise<void> {
    const { db } = this.deps;
    const { clan } = await this.withRight(actor, clanId, "leader");
    if (role !== "OFFICER" && role !== "MEMBER") throw new GcsValidationError({ role: "invalid_choice" });
    const member = await db.clanMember.findUnique({ where: { clanId_userId: { clanId, userId } } });
    if (!member) throw new GcsNotFound();
    if (member.role === "LEADER") throw new GcsConflict({ reason: "clan_leader_role" });
    if (member.role === role) return;
    await db.$transaction(async (tx) => {
      await tx.clanMember.update({ where: { clanId_userId: { clanId, userId } }, data: { role } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: role === "OFFICER" ? "clans.promote" : "clans.demote",
        targetType: "clan",
        targetId: String(clanId),
        before: { userId, role: member.role },
        after: { userId, role },
        ip: actor.ip,
      });
    });
    await this.deps.permissions.invalidateMemberGrants([userId]);
    await this.membershipNotice(clan.id, userId, actor.userId, role === "OFFICER" ? "promoted" : "demoted");
    await this.changed(clan.id);
  }

  /** Ieșirea din clan (orice membru, în afară de lider). Pornește pauza din opțiuni. */
  async leave(actor: GcsActor, clanId: number): Promise<void> {
    const { db } = this.deps;
    await this.assertApp();
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const member = await db.clanMember.findUnique({ where: { clanId_userId: { clanId, userId: actor.userId } } });
    if (!member) throw new GcsNotFound();
    if (member.role === "LEADER") throw new GcsConflict({ reason: "clan_leader_must_transfer" });
    const userId = actor.userId;
    await db.$transaction(async (tx) => {
      await this.removeMember(tx, clanId, userId);
      await writeAudit(tx, { actorId: userId, action: "clans.leave", targetType: "clan", targetId: String(clanId), before: { userId, role: member.role }, ip: actor.ip });
    }, TX);
    await this.startCooldown(userId);
    await this.afterMembership(clanId, [userId], await this.options());
  }

  /**
   * Excluderea: liderul scoate pe oricine; un ofițer cu `members` doar membri simpli; staff-ul pe oricine în afară de
   * lider (liderul se schimbă prin transfer). Pornește pauza membrului scos.
   */
  async kick(actor: GcsActor, clanId: number, userId: string): Promise<void> {
    const { db } = this.deps;
    const { clan, access, options } = await this.withRight(actor, clanId, "members");
    const member = await db.clanMember.findUnique({ where: { clanId_userId: { clanId, userId } } });
    if (!member) throw new GcsNotFound();
    if (member.role === "LEADER") throw new GcsConflict({ reason: "clan_leader_role" });
    if (!access.leader && member.role !== "MEMBER") throw new GcsForbidden({ permission: "clans.leader" });
    await db.$transaction(async (tx) => {
      await this.removeMember(tx, clanId, userId);
      await writeAudit(tx, { actorId: actor.userId, action: "clans.kick", targetType: "clan", targetId: String(clanId), before: { userId, role: member.role }, ip: actor.ip });
    }, TX);
    await this.startCooldown(userId);
    await this.membershipNotice(clan.id, userId, actor.userId, "kicked");
    await this.afterMembership(clan.id, [userId], options);
  }

  /** Transferul conducerii (liderul sau staff-ul): noul lider dintre membri, vechiul lider devine ofițer. */
  async transfer(actor: GcsActor, clanId: number, userId: string): Promise<void> {
    const { db } = this.deps;
    const { clan } = await this.withRight(actor, clanId, "leader");
    const target = await db.clanMember.findUnique({ where: { clanId_userId: { clanId, userId } } });
    if (!target) throw new GcsValidationError({ user: "not_member" });
    if (target.role === "LEADER") return;
    const leader = await db.clanMember.findFirst({ where: { clanId, role: "LEADER" } });
    await db.$transaction(async (tx) => {
      // Întâi vechiul lider coboară (indexul unic parțial: un singur lider pe clan).
      if (leader) await tx.clanMember.update({ where: { clanId_userId: { clanId, userId: leader.userId } }, data: { role: "OFFICER" } });
      await tx.clanMember.update({ where: { clanId_userId: { clanId, userId } }, data: { role: "LEADER" } });
      await tx.clan.update({ where: { id: clanId }, data: { lastActivityAt: new Date() } });
      await writeAudit(tx, { actorId: actor.userId, action: "clans.transfer", targetType: "clan", targetId: String(clanId), before: { leaderId: leader?.userId ?? null }, after: { leaderId: userId }, ip: actor.ip });
    }, TX);
    await this.deps.permissions.invalidateMemberGrants([userId, ...(leader ? [leader.userId] : [])]);
    await this.membershipNotice(clan.id, userId, actor.userId, "leader");
    await this.changed(clan.id);
  }

  /**
   * Desființarea (liderul, confirmând tagul, sau staff-ul): membrii sunt anunțați, clanul se șterge cu membrii, cererile
   * și imaginile lui; forumul privat se șterge dacă e gol, altfel rămâne doar pentru staff. Jurnalul păstrează datele.
   */
  async disband(actor: GcsActor, clanId: number, confirmTag: string): Promise<void> {
    const { db, attachments } = this.deps;
    await this.assertApp();
    const clan = await this.load(clanId);
    const access = await this.access(actor, clan);
    // Liderul poate desființa și un clan arhivat (nu și unul blocat de staff).
    if (!(access.staff || (access.role === "LEADER" && !clan.locked))) throw new GcsForbidden({ permission: "clans.leader" });
    if (!access.staff && normalizeTag(confirmTag) !== clan.tagNormalized) throw new GcsValidationError({ confirm: "mismatch" });
    const members = await db.clanMember.findMany({ where: { clanId }, select: { userId: true, role: true } });
    await db.$transaction(async (tx) => {
      if (clan.forumId !== null) await retireClanForum(tx, clan.forumId);
      await tx.clan.delete({ where: { id: clanId } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "clans.disband",
        targetType: "clan",
        targetId: String(clanId),
        before: { ...pick(clan, ["tag", "name", "status", "forumId", "membersCount", "createdById"]), members },
        ip: actor.ip,
      });
    }, TX);
    await attachments.deleteFor(CLAN_LOGO, [String(clanId)]);
    await attachments.deleteFor(CLAN_BANNER, [String(clanId)]);
    const userIds = members.map((m) => m.userId);
    await this.deps.permissions.invalidateMemberGrants(userIds);
    await this.deps.bus.emit({
      name: "clan.disbanded",
      payload: { clanId, tag: clan.tag, name: clan.name, userIds: userIds.filter((id) => id !== actor.userId), actorId: actor.userId },
      tags: [],
    });
    await this.rerank(await this.options());
    await this.changed(clanId, { forum: clan.forumId !== null });
  }

  /** Reactivarea unui clan arhivat (liderul, din administrare, sau staff-ul). */
  async reactivate(actor: GcsActor, clanId: number): Promise<void> {
    await this.assertApp();
    const clan = await this.load(clanId);
    const access = await this.access(actor, clan);
    if (!(access.staff || (access.role === "LEADER" && !clan.locked))) throw new GcsForbidden({ permission: "clans.leader" });
    if (clan.status !== "ARCHIVED") throw new GcsConflict({ reason: "clan_not_archived" });
    await this.setStatus(actor, clan, "ACTIVE", "clans.reactivate");
  }

  private async setStatus(actor: GcsActor | null, clan: Clan, status: Clan["status"], action: string): Promise<void> {
    await this.deps.db.$transaction(async (tx) => {
      const now = new Date();
      await tx.clan.update({
        where: { id: clan.id },
        data: { status, archivedAt: status === "ARCHIVED" ? now : null, lastActivityAt: now, ...(status === "ARCHIVED" ? { rank: null } : {}) },
      });
      await writeAudit(tx, { actorId: actor?.userId ?? null, action, targetType: "clan", targetId: String(clan.id), before: { status: clan.status }, after: { status }, ip: actor?.ip ?? null });
    });
    await this.invalidateMembers(clan.id);
    await this.rerank(await this.options());
    await this.changed(clan.id);
  }

  // ─── Staff ─────────────────────────────────────────────────────────────────────────────────────────────────

  private async assertStaff(actor: GcsActor): Promise<void> {
    if (!(await this.isStaff(actor))) throw new GcsForbidden({ permission: "clans.moderate" });
  }

  /** Aprobarea unui clan în așteptare: devine activ, primește forumul (după opțiuni), fondatorul e anunțat. */
  async approve(actor: GcsActor, clanId: number): Promise<void> {
    await this.assertStaff(actor);
    const clan = await this.load(clanId);
    if (clan.status !== "PENDING") throw new GcsConflict({ reason: "clan_not_pending" });
    const options = await this.options();
    await this.deps.db.$transaction(async (tx) => {
      const now = new Date();
      await tx.clan.update({ where: { id: clan.id }, data: { status: "ACTIVE", approvedById: actor.userId, approvedAt: now, lastActivityAt: now } });
      // Forumul: mereu cu `auto`; cu `optional`, dacă liderul l-a cerut la creare.
      await this.maybeCreateForum(tx, clan, options, clan.forumRequested);
      await writeAudit(tx, { actorId: actor.userId, action: "clans.approve", targetType: "clan", targetId: String(clan.id), before: { status: "PENDING" }, after: { status: "ACTIVE" }, ip: actor.ip });
    }, TX);
    await this.invalidateMembers(clan.id);
    if (clan.createdById) {
      await this.deps.bus.emit({ name: "clan.reviewed", payload: { clanId: clan.id, userId: clan.createdById, actorId: actor.userId, kind: "approved", name: clan.name }, tags: [] });
    }
    await this.rerank(options);
    await this.changed(clan.id, { forum: true });
  }

  /** Respingerea unui clan în așteptare (cu motiv): clanul se șterge, fondatorul e anunțat cu motivul. */
  async reject(actor: GcsActor, clanId: number, reason: string): Promise<void> {
    const { db, attachments } = this.deps;
    await this.assertStaff(actor);
    const clan = await this.load(clanId);
    if (clan.status !== "PENDING") throw new GcsConflict({ reason: "clan_not_pending" });
    const text = cleanText(reason);
    if ([...text].length > CLAN_LIMITS.rejectReason) throw new GcsValidationError({ reason: "too_long" });
    await db.$transaction(async (tx) => {
      await tx.clan.delete({ where: { id: clan.id } });
      await writeAudit(tx, { actorId: actor.userId, action: "clans.reject", targetType: "clan", targetId: String(clan.id), before: pick(clan, ["tag", "name", "createdById"]), after: { reason: text }, ip: actor.ip });
    });
    await attachments.deleteFor(CLAN_LOGO, [String(clan.id)]);
    await attachments.deleteFor(CLAN_BANNER, [String(clan.id)]);
    if (clan.createdById) {
      await this.deps.bus.emit({
        name: "clan.reviewed",
        payload: { clanId: clan.id, userId: clan.createdById, actorId: actor.userId, kind: "rejected", name: clan.name, reason: text },
        tags: [],
      });
    }
    await this.changed(clan.id);
  }

  /** Blocarea (cu motiv) sau deblocarea unui clan. */
  async setLocked(actor: GcsActor, clanId: number, locked: boolean, reason = ""): Promise<void> {
    await this.assertStaff(actor);
    const clan = await this.load(clanId);
    const text = cleanLine(reason);
    if ([...text].length > CLAN_LIMITS.lockReason) throw new GcsValidationError({ lockReason: "too_long" });
    await this.deps.db.$transaction(async (tx) => {
      await tx.clan.update({ where: { id: clan.id }, data: { locked, lockReason: locked ? text || null : null } });
      await writeAudit(tx, { actorId: actor.userId, action: locked ? "clans.lock" : "clans.unlock", targetType: "clan", targetId: String(clan.id), before: { locked: clan.locked }, after: { locked, reason: text }, ip: actor.ip });
    });
    await this.invalidateMembers(clan.id);
    await this.changed(clan.id);
  }

  /** Arhivarea de către staff (clanul rămâne, cu forumul doar citire). */
  async archive(actor: GcsActor, clanId: number): Promise<void> {
    await this.assertStaff(actor);
    const clan = await this.load(clanId);
    if (clan.status !== "ACTIVE") throw new GcsConflict({ reason: "clan_closed" });
    await this.setStatus(actor, clan, "ARCHIVED", "clans.archive");
  }

  /** Limita de membri pusă de staff pe un clan (`null` = după grupurile liderului). */
  async setMemberLimit(actor: GcsActor, clanId: number, limit: number | null): Promise<void> {
    await this.assertStaff(actor);
    const clan = await this.load(clanId);
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 10_000)) throw new GcsValidationError({ memberLimit: "invalid_range" });
    await this.deps.db.$transaction(async (tx) => {
      await tx.clan.update({ where: { id: clan.id }, data: { memberLimit: limit } });
      await writeAudit(tx, { actorId: actor.userId, action: "clans.update", targetType: "clan", targetId: String(clan.id), before: { memberLimit: clan.memberLimit }, after: { memberLimit: limit }, ip: actor.ip });
    });
    await this.changed(clan.id);
  }

  /** „Recalculează clasamentul” din ACP. */
  async recompute(actor: GcsActor | null): Promise<number> {
    if (actor) await this.assertStaff(actor);
    const options = await this.options();
    const ranked = await recomputeClanRanking(this.deps.db, options.weights, new Date(), this.deps.gameStats ?? null);
    if (actor) await writeAudit(this.deps.db, { actorId: actor.userId, action: "clans.rank", targetType: "clan", targetId: "ranking", after: { ranked }, ip: actor.ip });
    await this.deps.bus.emit({ name: "clans.updated", payload: { clanId: null }, tags: [CLANS_CACHE_TAG, CLANS_STATS_TAG] });
    return ranked;
  }

  // ─── Turneele (doar interfața, specul §13) ─────────────────────────────────────────────────────────────────

  /** Poate actorul înscrie clanul la evenimente / turnee (liderul, ofițerii cu `events`, staff-ul)? */
  async canRegisterForEvents(actor: GcsActor, clanId: number): Promise<boolean> {
    const clan = await this.deps.db.clan.findUnique({ where: { id: clanId } });
    if (!clan || clan.status !== "ACTIVE") return false;
    return (await this.access(actor, clan)).can.events;
  }

  /** Lista clanului pentru un eveniment: clanul și membrii (cu rolul), dacă actorul poate înscrie clanul. */
  async eventRoster(actor: GcsActor, clanId: number): Promise<{ clan: { id: number; tag: string; name: string }; members: { userId: string; name: string; role: ClanRole }[] }> {
    const { clan } = await this.withRight(actor, clanId, "events");
    if (clan.status !== "ACTIVE") throw new GcsConflict({ reason: "clan_closed" });
    const members = await this.deps.db.clanMember.findMany({
      where: { clanId },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      select: { userId: true, role: true, user: { select: { name: true } } },
    });
    return { clan: { id: clan.id, tag: clan.tag, name: clan.name }, members: members.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role })) };
  }

  // ─── Joburi ────────────────────────────────────────────────────────────────────────────────────────────────

  /** Cererile și invitațiile expirate; arhivarea clanurilor fără activitate (după opțiuni). */
  async daily(now = new Date()): Promise<{ expired: number; archived: number }> {
    const { db } = this.deps;
    if (!(await this.deps.apps.enabled("clans"))) return { expired: 0, archived: 0 };
    const expired = await db.clanRequest.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", decidedAt: now } });
    const options = await this.options();
    let archived = 0;
    if (options.archiveInactiveDays > 0) {
      const before = new Date(now.getTime() - options.archiveInactiveDays * 86_400_000);
      // Fără activitate = nici clanul (membri, schimbări), nici vreun membru nu a fost activ pe site de atunci.
      const stale = await db.$queryRaw<{ id: number }[]>(sql`
        SELECT c.id FROM clans c
        WHERE c.status = 'ACTIVE' AND c."lastActivityAt" < ${before}
          AND NOT EXISTS (
            SELECT 1 FROM clan_members m JOIN users u ON u.id = m."userId"
            WHERE m."clanId" = c.id AND u."lastActiveAt" >= ${before}
          )`);
      for (const { id } of stale) {
        const clan = await db.clan.findUnique({ where: { id } });
        if (clan) await this.setStatus(null, clan, "ARCHIVED", "clans.archive");
      }
      archived = stale.length;
    }
    if (expired.count > 0 || archived > 0) await this.deps.bus.emit({ name: "clans.updated", payload: { clanId: null }, tags: [CLANS_CACHE_TAG, CLANS_STATS_TAG] });
    return { expired: expired.count, archived };
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({
      name: CLAN_RANK_JOB,
      everyMs: 3_600_000,
      handler: async () => {
        if (await this.deps.apps.enabled("clans")) await this.recompute(null);
      },
    });
    jobs.register({ name: CLAN_DAILY_JOB, everyMs: 24 * 3_600_000, handler: async () => void (await this.daily()) });
  }

  // ─── Ștergerea și unirea conturilor (specul 2026-10-09-stergere-unire-membri) ────────────────────────────────

  /**
   * Cine preia fiecare clan condus de membru când acesta iese (ștergerea contului, sursa unei uniri): `prefer` (ținta unirii,
   * dacă e în același clan), altfel cel mai vechi ofițer, altfel cel mai vechi membru; `null` = clanul rămâne fără membri și
   * se arhivează.
   */
  async successions(userId: string, prefer: string | null = null): Promise<{ clanId: number; tag: string; name: string; successor: { id: string; name: string } | null }[]> {
    const { db } = this.deps;
    const led = await db.clanMember.findMany({ where: { userId, role: "LEADER" }, select: { clan: { select: { id: true, tag: true, name: true } } } });
    const out = [];
    for (const { clan } of led) {
      const successor = await this.successorOf(db, clan.id, userId, prefer);
      out.push({ clanId: clan.id, tag: clan.tag, name: clan.name, successor });
    }
    return out;
  }

  private async successorOf(db: Tx | PrismaClient, clanId: number, userId: string, prefer: string | null): Promise<{ id: string; name: string } | null> {
    const select = { user: { select: { id: true, name: true } } } as const;
    const preferred = prefer ? await db.clanMember.findUnique({ where: { clanId_userId: { clanId, userId: prefer } }, select }) : null;
    if (preferred) return preferred.user;
    const officer = await db.clanMember.findFirst({ where: { clanId, role: "OFFICER", userId: { not: userId } }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }], select });
    if (officer) return officer.user;
    const member = await db.clanMember.findFirst({ where: { clanId, userId: { not: userId } }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }], select });
    return member?.user ?? null;
  }

  /**
   * Membrul iese din toate clanurile (ștergerea contului): conducerea trece la succesor (`successions`), iar un clan rămas
   * fără membri se arhivează. Cererile și invitațiile lui se șterg. Întoarce câte rânduri s-au schimbat (0 = gata).
   */
  async accountLeave(userId: string, prefer: string | null = null): Promise<number> {
    const { db } = this.deps;
    const memberships = await db.clanMember.findMany({ where: { userId }, select: { clanId: true, role: true } });
    const options = await this.options();
    let archived = false;
    for (const m of memberships) {
      const result = await db.$transaction(async (tx) => {
        let successor: { id: string; name: string } | null = null;
        let archive = false;
        if (m.role === "LEADER") {
          successor = await this.successorOf(tx, m.clanId, userId, prefer);
          // Întâi liderul coboară (indexul unic parțial: un singur lider pe clan).
          await tx.clanMember.update({ where: { clanId_userId: { clanId: m.clanId, userId } }, data: { role: "MEMBER" } });
          if (successor) await tx.clanMember.update({ where: { clanId_userId: { clanId: m.clanId, userId: successor.id } }, data: { role: "LEADER" } });
          else archive = true;
        }
        await this.removeMember(tx, m.clanId, userId);
        if (archive) await tx.clan.update({ where: { id: m.clanId }, data: { status: "ARCHIVED", archivedAt: new Date(), rank: null } });
        await writeAudit(tx, {
          actorId: null,
          action: "clans.account_leave",
          targetType: "clan",
          targetId: String(m.clanId),
          before: { userId, role: m.role },
          after: { leaderId: successor?.id ?? null, archived: archive },
          ip: null,
        });
        return { successor, archive };
      }, TX);
      archived ||= result.archive;
      await this.afterMembership(m.clanId, [userId, ...(result.successor ? [result.successor.id] : [])], options);
      if (result.successor) await this.membershipNotice(m.clanId, result.successor.id, null, "leader");
    }
    if (archived) await this.rerank(options);
    const requests = await db.clanRequest.deleteMany({ where: { userId } });
    const invites = await db.clanRequest.updateMany({ where: { invitedById: userId }, data: { invitedById: null } });
    return memberships.length + requests.count + invites.count;
  }

  /**
   * Unirea (specul §4): dacă ținta e în vreun clan, rămân clanurile ei (sursa iese ca la ștergere, iar conducerea unui clan
   * comun trece la țintă); altfel apartenențele sursei (cu rolurile) trec la țintă. Întoarce câte rânduri s-au schimbat.
   */
  async accountMerge(sourceId: string, targetId: string): Promise<number> {
    const { db } = this.deps;
    let n = 0;
    if ((await db.clanMember.count({ where: { userId: sourceId } })) > 0) {
      if ((await db.clanMember.count({ where: { userId: targetId } })) > 0) {
        n += await this.accountLeave(sourceId, targetId);
      } else {
        const clans = await db.clanMember.findMany({ where: { userId: sourceId }, select: { clanId: true } });
        n += (await db.clanMember.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        await this.deps.permissions.invalidateMemberGrants([sourceId, targetId]);
        for (const c of clans) await this.changed(c.clanId);
      }
    }
    n += (await db.clanRequest.updateMany({ where: { userId: sourceId, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } })).count;
    n += (await db.clanRequest.updateMany({ where: { invitedById: sourceId }, data: { invitedById: targetId } })).count;
    n += (await db.clan.updateMany({ where: { createdById: sourceId }, data: { createdById: targetId } })).count;
    return n;
  }

  // ─── Ajutoare ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Membrii care au un drept în clan: liderul și ofițerii cărora liderul (și staff-ul) le-au dat dreptul. */
  private async rightHolders(clan: Pick<Clan, "id" | "officerRights">, right: GcsClanRight, options: GcsClanOptions): Promise<string[]> {
    const officers = jsonStrings(clan.officerRights).includes(right) && options.officerRights.includes(right);
    const rows = await this.deps.db.clanMember.findMany({ where: { clanId: clan.id, role: { in: officers ? ["LEADER", "OFFICER"] : ["LEADER"] } }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  private membershipNotice(clanId: number, userId: string, actorId: string | null, kind: "accepted" | "rejected" | "promoted" | "demoted" | "leader" | "kicked"): Promise<void> {
    return this.deps.bus.emit({ name: "clan.membership", payload: { clanId, userId, actorId, kind }, tags: [] });
  }

  /** Drepturile tuturor membrilor clanului pe forum se recalculează (stare, forum, drepturile ofițerilor). */
  private async invalidateMembers(clanId: number): Promise<void> {
    const rows = await this.deps.db.clanMember.findMany({ where: { clanId }, select: { userId: true } });
    await this.deps.permissions.invalidateMemberGrants(rows.map((r) => r.userId));
  }

  /** După o intrare sau o ieșire: drepturile pe forum, scorul clanului și cache-ul listelor. */
  private async afterMembership(clanId: number, userIds: string[], options: GcsClanOptions): Promise<void> {
    await this.deps.permissions.invalidateMemberGrants(userIds);
    await this.rescore(clanId, options);
    await this.changed(clanId);
  }

  /** Locurile tuturor clanurilor active (după aprobare, creare activă, arhivare, reactivare, desființare). */
  private async rerank(options: GcsClanOptions): Promise<void> {
    await recomputeClanRanking(this.deps.db, options.weights, new Date(), this.deps.gameStats ?? null);
  }

  private async rescore(clanId: number, options: GcsClanOptions): Promise<void> {
    await rescoreClan(this.deps.db, clanId, options.weights, new Date(), this.deps.gameStats ?? null);
  }

  /** Listele (director, widget, placa) se reîmprospătează; `forum` = s-a schimbat și arborele forumului. */
  private async changed(clanId: number, opts: { forum?: boolean } = {}): Promise<void> {
    if (opts.forum) {
      await this.deps.permissions.bumpVersion();
      await this.deps.bus.emit({ name: "forum.updated", payload: { forumIds: [] }, tags: ["forums-tree"] });
    }
    await this.deps.bus.emit({ name: "clans.updated", payload: { clanId }, tags: [CLANS_CACHE_TAG, CLANS_STATS_TAG] });
  }
}

/** O cheie unică încălcată (tag sau nume) → eroarea pe câmp. */
function uniqueError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = String((error.meta as { target?: unknown } | undefined)?.target ?? "");
    return new GcsValidationError(target.includes("name") ? { name: "clan_name_taken" } : { tag: "clan_tag_taken" });
  }
  return error;
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K>;
}
