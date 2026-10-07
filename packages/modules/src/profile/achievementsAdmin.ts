import {
  GcsNotFound,
  GcsValidationError,
  isHexColor,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAttachmentService,
  type GcsEventBus,
  type GcsJobQueue,
} from "@gcs/core";
import type { AchievementRule, AchievementTrigger, Badge, PrismaClient, Rank } from "@gcs/db";
import { isBadgeShape, isBadgeText, isBadgeTier } from "@gcs/ui/badge-art";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { BADGES_ACP_SECTION, RANKS_RECOMPUTE_JOB, type GcsAchievementService } from "./achievements";

export const RANKS_ACP_SECTION = "members.ranks";
export const RULES_ACP_SECTION = "members.achievement_rules";

const TRIGGERS: AchievementTrigger[] = ["POSTS_COUNT", "REPUTATION", "POINTS", "MEMBER_DAYS", "SOLUTIONS_COUNT", "IS_VIP", "EACH_POST", "EACH_REACTION_RECEIVED", "EACH_SOLUTION"];
const MAX = 10_000_000;

export type GcsRankInput = { name: string; icon: string | null; minPosts: number | null; minPoints: number | null; minReputation: number | null };
/**
 * Un badge din ACP. Insigna (specul 2026-10-07-insigne-grafice): `artShape`, `artTier`, `artIcon` (null = implicite),
 * `symbol` = textul insignei (gol = fără text). `imageAttachmentId`: `undefined` păstrează imaginea proprie, `null` o
 * scoate, un id o înlocuiește (un atașament de tip imagine, încărcat prin serviciul de atașamente).
 */
export type GcsBadgeInput = {
  key: string;
  name: string;
  description: string;
  symbol: string;
  color: string;
  manual: boolean;
  points: number;
  artShape?: string | null;
  artTier?: string | null;
  artIcon?: string | null;
  imageAttachmentId?: string | null;
};

/** Imaginea proprie a unui badge e publică (o vede oricine vede badge-ul). */
export const BADGE_IMAGE_CONTENT_TYPE = "badges.image";
export type GcsRuleInput = { name: string; trigger: AchievementTrigger; threshold: number; points: number; badgeId: number | null; enabled: boolean };

const graphemes = (s: string) => [...new Intl.Segmenter().segment(s)].length;
const optionalCount = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v <= MAX);

/** ACP → Membri → Realizări: rangurile, badge-urile și regulile (specul etapei 3, §9). Totul intră în jurnal. */
export class GcsAchievementAdmin {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      acp: GcsAcpRoleService;
      achievements: GcsAchievementService;
      jobs: GcsJobQueue | null;
      attachments?: GcsAttachmentService;
    },
  ) {
    deps.attachments?.registerAccess(BADGE_IMAGE_CONTENT_TYPE, async () => true);
  }

  private async audit(actor: GcsActor, action: string, targetType: string, targetId: string, before?: unknown, after?: unknown): Promise<void> {
    await writeAudit(this.deps.db, { actorId: actor.userId, action, targetType, targetId, before, after, ip: actor.ip });
  }

  /** Rangurile s-au schimbat: afișarea se invalidează, iar rangurile tuturor se recalculează în worker (sau pe loc, fără coadă). */
  private async ranksChanged(): Promise<void> {
    await this.deps.bus.emit({ name: "ranks.updated", payload: {}, tags: ["ranks"] });
    if (this.deps.jobs) await this.deps.jobs.enqueue(RANKS_RECOMPUTE_JOB, {}, { jobId: `ranks-${Date.now()}` });
    else await this.deps.achievements.recomputeAllRanks();
  }

  private async badgesChanged(): Promise<void> {
    await this.deps.bus.emit({ name: "badges.updated", payload: {}, tags: ["badges"] });
  }

  // ─── Ranguri ─────────────────────────────────────────────────────────────

  ranks(): Promise<Rank[]> {
    return this.deps.db.rank.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  }

  async saveRank(actor: GcsActor, id: number | null, input: GcsRankInput): Promise<Rank> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RANKS_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    const name = input.name.trim();
    if (name.length < 1 || name.length > 40) errors.name = "required";
    if (input.icon !== null && (input.icon.trim() === "" || graphemes(input.icon.trim()) > 3)) errors.icon = "invalid";
    for (const [k, v] of Object.entries({ minPosts: input.minPosts, minPoints: input.minPoints, minReputation: input.minReputation })) {
      if (!optionalCount(v)) errors[k] = "invalid_range";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = { name, icon: input.icon?.trim() || null, minPosts: input.minPosts, minPoints: input.minPoints, minReputation: input.minReputation };
    const before = id === null ? null : await db.rank.findUnique({ where: { id } });
    if (id !== null && !before) throw new GcsNotFound();
    const row = id === null ? await db.rank.create({ data: { ...data, position: await db.rank.count() } }) : await db.rank.update({ where: { id }, data });
    await this.audit(actor, id === null ? "rank.create" : "rank.update", "rank", String(row.id), before, row);
    await this.ranksChanged();
    return row;
  }

  async deleteRank(actor: GcsActor, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RANKS_ACP_SECTION, "delete");
    const before = await db.rank.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.rank.delete({ where: { id } });
    await this.audit(actor, "rank.delete", "rank", String(id), before);
    await this.ranksChanged();
  }

  /** Ordinea rangurilor = ierarhia (ultimul e cel mai înalt). `order` conține toate id-urile. */
  async reorderRanks(actor: GcsActor, order: number[]): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RANKS_ACP_SECTION, "edit");
    const all = await db.rank.findMany({ select: { id: true } });
    if (order.length !== all.length || !all.every((r) => order.includes(r.id))) throw new GcsValidationError({ order: "invalid" });
    await db.$transaction(order.map((id, position) => db.rank.update({ where: { id }, data: { position } })));
    await this.audit(actor, "rank.reorder", "rank", "*", undefined, order);
    await this.ranksChanged();
  }

  // ─── Badge-uri ───────────────────────────────────────────────────────────

  badges(): Promise<Badge[]> {
    return this.deps.db.badge.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  }

  async saveBadge(actor: GcsActor, id: number | null, input: GcsBadgeInput): Promise<Badge> {
    const { db, acp } = this.deps;
    await acp.assert(actor, BADGES_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    if (!/^[a-z0-9_]{2,40}$/.test(input.key)) errors.key = "invalid";
    const name = input.name.trim();
    if (name.length < 1 || name.length > 40) errors.name = "required";
    // Textul insignei e opțional (fără el și fără iconiță, insigna arată prima literă a numelui).
    const symbol = input.symbol.trim();
    if (symbol !== "" && !isBadgeText(symbol)) errors.symbol = "invalid";
    if (!isHexColor(input.color)) errors.color = "invalid_color";
    if (!Number.isInteger(input.points) || input.points < -1000 || input.points > 1000) errors.points = "invalid_range";
    if (input.description.length > 200) errors.description = "too_long";
    const artShape = input.artShape || null;
    const artTier = input.artTier || null;
    const artIcon = input.artIcon || null;
    if (artShape !== null && !isBadgeShape(artShape)) errors.artShape = "invalid_choice";
    if (artTier !== null && !isBadgeTier(artTier)) errors.artTier = "invalid_choice";
    if (artIcon !== null && !isGcsIcon(artIcon)) errors.artIcon = "invalid_choice";
    if (input.imageAttachmentId) {
      const att = await db.attachment.findUnique({ where: { id: input.imageAttachmentId } });
      // Doar un fișier proaspăt încărcat de acest admin (nelegat încă) sau imaginea actuală a badge-ului.
      const own = att && (att.contentType === null ? att.ownerId === actor.userId : att.contentType === BADGE_IMAGE_CONTENT_TYPE && att.contentId === String(id));
      if (!att || !own || !att.mime.startsWith("image/")) errors.image = "invalid_image";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = {
      key: input.key,
      name,
      description: input.description.trim(),
      symbol: symbol || null,
      color: input.color.toUpperCase(),
      manual: input.manual,
      points: input.points,
      artShape,
      artTier,
      artIcon,
      ...(input.imageAttachmentId !== undefined ? { imageAttachmentId: input.imageAttachmentId } : {}),
    };
    const before = id === null ? null : await db.badge.findUnique({ where: { id } });
    if (id !== null && !before) throw new GcsNotFound();
    const row = await (id === null ? db.badge.create({ data: { ...data, position: await db.badge.count() } }) : db.badge.update({ where: { id }, data })).catch((error: unknown) => {
      if ((error as { code?: string }).code === "P2002") throw new GcsValidationError({ key: "taken" });
      throw error;
    });
    if (input.imageAttachmentId !== undefined && input.imageAttachmentId !== before?.imageAttachmentId) {
      // Imaginea veche dispare (din store și din baza de date); cea nouă se leagă de badge și devine publică.
      if (before?.imageAttachmentId) await this.deps.attachments?.deleteFor(BADGE_IMAGE_CONTENT_TYPE, [String(row.id)]);
      if (input.imageAttachmentId) {
        await db.attachment.update({ where: { id: input.imageAttachmentId }, data: { contentType: BADGE_IMAGE_CONTENT_TYPE, contentId: String(row.id) } });
      }
    }
    await this.audit(actor, id === null ? "badge.create" : "badge.update", "badge", String(row.id), before, row);
    await this.badgesChanged();
    return row;
  }

  async deleteBadge(actor: GcsActor, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, BADGES_ACP_SECTION, "delete");
    const before = await db.badge.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.badge.delete({ where: { id } });
    await this.deps.attachments?.deleteFor(BADGE_IMAGE_CONTENT_TYPE, [String(id)]);
    await this.audit(actor, "badge.delete", "badge", String(id), before);
    await this.badgesChanged();
  }

  // ─── Reguli ──────────────────────────────────────────────────────────────

  rules() {
    return this.deps.db.achievementRule.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], include: { badge: { select: { id: true, name: true, symbol: true, color: true } } } });
  }

  async saveRule(actor: GcsActor, id: number | null, input: GcsRuleInput): Promise<AchievementRule> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RULES_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) errors.name = "required";
    if (!TRIGGERS.includes(input.trigger)) errors.trigger = "invalid_choice";
    const each = input.trigger.startsWith("EACH_");
    if (!Number.isInteger(input.threshold) || input.threshold < 0 || input.threshold > MAX) errors.threshold = "invalid_range";
    if (!Number.isInteger(input.points) || input.points < -1000 || input.points > 1000) errors.points = "invalid_range";
    // Regulile pe acțiune dau doar puncte (la fiecare eveniment); un badge se acordă o singură dată, deci doar la praguri.
    if (each && input.badgeId !== null) errors.badgeId = "each_no_badge";
    if (input.badgeId === null && input.points === 0) errors.points = "rule_empty";
    if (input.badgeId !== null && !(await db.badge.findUnique({ where: { id: input.badgeId } }))) errors.badgeId = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = { name, trigger: input.trigger, threshold: each ? 0 : input.threshold, points: input.points, badgeId: input.badgeId, enabled: input.enabled };
    const before = id === null ? null : await db.achievementRule.findUnique({ where: { id } });
    if (id !== null && !before) throw new GcsNotFound();
    const row = id === null ? await db.achievementRule.create({ data: { ...data, position: await db.achievementRule.count() } }) : await db.achievementRule.update({ where: { id }, data });
    await this.audit(actor, id === null ? "rule.create" : "rule.update", "achievement_rule", String(row.id), before, row);
    return row;
  }

  async deleteRule(actor: GcsActor, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RULES_ACP_SECTION, "delete");
    const before = await db.achievementRule.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.achievementRule.delete({ where: { id } });
    await this.audit(actor, "rule.delete", "achievement_rule", String(id), before);
  }
}
