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
import { GAMING_PACK, RANKS_EXPORT_KIND, RULES_EXPORT_KIND, type GcsPortableReward, type GcsPortableRule, type GcsRulesPack } from "./achievementPresets";
import { EMPTY_REWARD, normalizeConditions, normalizeRewards, rewardEmpty, type GcsAchievementRules, type GcsRuleReward } from "./achievementRules";
import { isRankTier, normalizeCriteria, RANK_PRESETS } from "./rankLadder";
import type { Prisma } from "@gcs/db";

export const RANKS_ACP_SECTION = "members.ranks";
export const RULES_ACP_SECTION = "members.achievement_rules";

const TRIGGERS: AchievementTrigger[] = ["POSTS_COUNT", "REPUTATION", "POINTS", "MEMBER_DAYS", "SOLUTIONS_COUNT", "IS_VIP", "EACH_POST", "EACH_REACTION_RECEIVED", "EACH_SOLUTION"];
const MAX = 10_000_000;

/**
 * Un rang din ACP. Câmpurile rangurilor moderne (Realizări v2) sunt opționale: lipsă = neschimbate (la creare,
 * implicite): emblema (treapta, forma, iconița, culoarea, animația), criteriile aplicațiilor, `match` și avantajele.
 */
export type GcsRankInput = {
  name: string;
  icon: string | null;
  minPosts: number | null;
  minPoints: number | null;
  minReputation: number | null;
  emblemTier?: string | null;
  emblemShape?: string | null;
  emblemIcon?: string | null;
  color?: string | null;
  animated?: boolean;
  match?: string;
  criteria?: unknown;
  perkGroupId?: number | null;
  perkBadgeId?: number | null;
  perkNameStyleId?: number | null;
  imageAttachmentId?: string | null;
};

export const RANK_IMAGE_CONTENT_TYPE = "ranks.image";

/** O regulă din constructor (Realizări v2): evenimentul, condițiile și recompensele (normalizate în serviciu). */
export type GcsEventRuleInput = { name: string; event: string; enabled: boolean; conditions: unknown; rewards: unknown };
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
      /** Realizări v2: motorul regulilor pe evenimente (catalogul evenimentelor, recalcularea). */
      rules?: GcsAchievementRules;
      attachments?: GcsAttachmentService;
    },
  ) {
    deps.attachments?.registerAccess(BADGE_IMAGE_CONTENT_TYPE, async () => true);
    deps.attachments?.registerAccess(RANK_IMAGE_CONTENT_TYPE, async () => true);
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
    const modern = await this.rankModernFields(input, errors, actor, id);
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = { name, icon: input.icon?.trim() || null, minPosts: input.minPosts, minPoints: input.minPoints, minReputation: input.minReputation, ...modern };
    const before = id === null ? null : await db.rank.findUnique({ where: { id } });
    if (id !== null && !before) throw new GcsNotFound();
    const row = id === null ? await db.rank.create({ data: { ...data, position: await db.rank.count() } }) : await db.rank.update({ where: { id }, data });
    if (input.imageAttachmentId !== undefined && input.imageAttachmentId !== before?.imageAttachmentId) {
      if (before?.imageAttachmentId) await this.deps.attachments?.deleteFor(RANK_IMAGE_CONTENT_TYPE, [String(row.id)]);
      if (input.imageAttachmentId) await db.attachment.update({ where: { id: input.imageAttachmentId }, data: { contentType: RANK_IMAGE_CONTENT_TYPE, contentId: String(row.id) } });
    }
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

  // ─── Ranguri moderne (Realizări v2) ──────────────────────────────────────

  /** Câmpurile noi ale unui rang (validate; lipsă = neschimbate la editare). */
  private async rankModernFields(input: GcsRankInput, errors: Record<string, string>, actor: GcsActor, id: number | null): Promise<Partial<Prisma.RankUncheckedCreateInput>> {
    const { db } = this.deps;
    const out: Partial<Prisma.RankUncheckedCreateInput> = {};
    if (input.emblemTier !== undefined) {
      if (input.emblemTier !== null && input.emblemTier !== "" && !isRankTier(input.emblemTier)) errors.emblemTier = "invalid_choice";
      else out.emblemTier = input.emblemTier || null;
    }
    if (input.emblemShape !== undefined) {
      if (input.emblemShape && !isBadgeShape(input.emblemShape)) errors.emblemShape = "invalid_choice";
      else out.emblemShape = input.emblemShape || null;
    }
    if (input.emblemIcon !== undefined) {
      if (input.emblemIcon && !isGcsIcon(input.emblemIcon)) errors.emblemIcon = "invalid_choice";
      else out.emblemIcon = input.emblemIcon || null;
    }
    if (input.color !== undefined) {
      if (input.color && !isHexColor(input.color)) errors.color = "invalid_color";
      else out.color = input.color ? input.color.toUpperCase() : null;
    }
    if (input.animated !== undefined) out.animated = input.animated;
    if (input.match !== undefined) {
      if (input.match !== "all" && input.match !== "any") errors.match = "invalid_choice";
      else out.match = input.match;
    }
    if (input.criteria !== undefined) {
      const criteria = normalizeCriteria(input.criteria);
      const known = new Set(this.rankMetricKeys());
      if (criteria.some((c) => !known.has(c.metric))) errors.criteria = "invalid_choice";
      else out.criteria = criteria;
    }
    const exists = async (kind: "group" | "badge" | "nameStyle", v: number | null | undefined, field: string) => {
      if (v === undefined) return;
      if (v === null) return void (out[field as "perkGroupId"] = null);
      const row = kind === "group" ? await db.group.findUnique({ where: { id: v } }) : kind === "badge" ? await db.badge.findUnique({ where: { id: v } }) : await db.nameStyle.findUnique({ where: { id: v } });
      if (!row) errors[field] = "invalid_choice";
      else out[field as "perkGroupId"] = v;
    };
    await exists("group", input.perkGroupId, "perkGroupId");
    await exists("badge", input.perkBadgeId, "perkBadgeId");
    await exists("nameStyle", input.perkNameStyleId, "perkNameStyleId");
    if (input.imageAttachmentId) {
      const att = await db.attachment.findUnique({ where: { id: input.imageAttachmentId } });
      const own = att && (att.contentType === null ? att.ownerId === actor.userId : att.contentType === RANK_IMAGE_CONTENT_TYPE && att.contentId === String(id));
      if (!att || !own || !att.mime.startsWith("image/")) errors.image = "invalid_image";
      else out.imageAttachmentId = input.imageAttachmentId;
    } else if (input.imageAttachmentId === null) out.imageAttachmentId = null;
    return out;
  }

  /** Metricile care pot fi criterii de rang (evenimentele „valoare” cu `rankMetric`, toate aplicațiile instalate). */
  private rankMetricKeys(): string[] {
    const reg = this.deps.rules?.registry;
    return reg ? reg.achievementEvents().filter((e) => e.def.rankMetric && e.def.current).map((e) => e.def.key) : [];
  }

  /** Câți membri are fiecare rang (`null` = fără rang). */
  async rankDistribution(): Promise<Map<number | null, number>> {
    const rows = await this.deps.db.user.groupBy({ by: ["rankId"], _count: { _all: true } });
    return new Map(rows.map((r) => [r.rankId, r._count._all]));
  }

  async duplicateRank(actor: GcsActor, id: number): Promise<Rank> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RANKS_ACP_SECTION, "edit");
    const r = await db.rank.findUnique({ where: { id } });
    if (!r) throw new GcsNotFound();
    const { id: _id, position: _p, imageAttachmentId: _img, ...rest } = r;
    const row = await db.rank.create({ data: { ...rest, criteria: rest.criteria as Prisma.InputJsonValue, name: `${r.name} (2)`.slice(0, 40), position: await db.rank.count() } });
    await this.audit(actor, "rank.create", "rank", String(row.id), undefined, { duplicateOf: id });
    await this.ranksChanged();
    return row;
  }

  /** Scara rangurilor ca JSON portabil (avantajele după cheie). */
  async exportRanks(): Promise<{ kind: string; version: 1; ranks: Record<string, unknown>[] }> {
    const ranks = await this.deps.db.rank.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], include: { perkGroup: { select: { key: true } }, perkBadge: { select: { key: true } }, perkNameStyle: { select: { key: true } } } });
    return {
      kind: RANKS_EXPORT_KIND,
      version: 1,
      ranks: ranks.map((r) => ({
        name: r.name,
        icon: r.icon,
        minPosts: r.minPosts,
        minPoints: r.minPoints,
        minReputation: r.minReputation,
        tier: r.emblemTier,
        shape: r.emblemShape,
        emblemIcon: r.emblemIcon,
        color: r.color,
        animated: r.animated,
        match: r.match,
        criteria: normalizeCriteria(r.criteria),
        perkGroup: r.perkGroup?.key ?? null,
        perkBadge: r.perkBadge?.key ?? null,
        perkNameStyle: r.perkNameStyle?.key ?? null,
      })),
    };
  }

  /**
   * Importă o scară (fișier exportat sau o scară prestabilită). `replace`: rangurile existente se șterg întâi (membrii
   * primesc rangurile noi la recalculare). Rangurile invalide se sar. Întoarce câte s-au creat.
   */
  async importRanks(actor: GcsActor, raw: unknown, opts: { replace: boolean }): Promise<{ created: number; skipped: number }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RANKS_ACP_SECTION, "edit");
    if (opts.replace) await acp.assert(actor, RANKS_ACP_SECTION, "delete");
    const pack = raw as { kind?: unknown; ranks?: unknown };
    if (!pack || pack.kind !== RANKS_EXPORT_KIND || !Array.isArray(pack.ranks) || pack.ranks.length === 0 || pack.ranks.length > 50) throw new GcsValidationError({ file: "invalid_file" });
    const keyed = async (model: "group" | "badge" | "nameStyle", key: unknown): Promise<number | null> => {
      if (typeof key !== "string") return null;
      const row = model === "group" ? await db.group.findUnique({ where: { key } }) : model === "badge" ? await db.badge.findUnique({ where: { key } }) : await db.nameStyle.findUnique({ where: { key } });
      return row?.id ?? null;
    };
    const metrics = new Set(this.rankMetricKeys());
    const rows: Prisma.RankCreateManyInput[] = [];
    let skipped = 0;
    for (const item of pack.ranks as Record<string, unknown>[]) {
      const name = typeof item.name === "string" ? item.name.trim().slice(0, 40) : "";
      const n = (v: unknown) => (typeof v === "number" && optionalCount(v) ? v : null);
      if (name === "") {
        skipped++;
        continue;
      }
      rows.push({
        name,
        icon: typeof item.icon === "string" && item.icon.trim() !== "" && graphemes(item.icon.trim()) <= 3 ? item.icon.trim() : null,
        minPosts: n(item.minPosts),
        minPoints: n(item.minPoints),
        minReputation: n(item.minReputation),
        emblemTier: isRankTier(item.tier) ? item.tier : null,
        emblemShape: isBadgeShape(item.shape) ? item.shape : null,
        emblemIcon: typeof item.emblemIcon === "string" && isGcsIcon(item.emblemIcon) ? item.emblemIcon : null,
        color: typeof item.color === "string" && isHexColor(item.color) ? item.color.toUpperCase() : null,
        animated: item.animated === true,
        match: item.match === "any" ? "any" : "all",
        criteria: normalizeCriteria(item.criteria).filter((c) => metrics.has(c.metric)),
        perkGroupId: await keyed("group", item.perkGroup),
        perkBadgeId: await keyed("badge", item.perkBadge),
        perkNameStyleId: await keyed("nameStyle", item.perkNameStyle),
        position: 0,
      });
    }
    await db.$transaction(async (tx) => {
      if (opts.replace) await tx.rank.deleteMany({});
      const start = await tx.rank.count();
      await tx.rank.createMany({ data: rows.map((r, i) => ({ ...r, position: start + i })) });
    });
    await this.audit(actor, "rank.import", "rank", "*", undefined, { created: rows.length, replace: opts.replace });
    await this.ranksChanged();
    return { created: rows.length, skipped };
  }

  /** O scară prestabilită (ACP → Ranguri → Scări prestabilite), ca import care înlocuiește scara. */
  async applyRankPreset(actor: GcsActor, key: string): Promise<{ created: number; skipped: number }> {
    const preset = RANK_PRESETS.find((p) => p.key === key);
    if (!preset) throw new GcsValidationError({ preset: "invalid_choice" });
    return this.importRanks(
      actor,
      { kind: RANKS_EXPORT_KIND, ranks: preset.ranks.map((r) => ({ name: r.name, tier: r.tier, emblemIcon: r.icon, minPosts: r.minPosts ?? null, minPoints: r.minPoints ?? null, minReputation: r.minReputation ?? null, criteria: r.criteria ?? [], match: r.match ?? "all", animated: r.animated ?? false })) },
      { replace: true },
    );
  }

  // ─── Reguli v2: constructorul „Când → Și → Atunci” ───────────────────────

  /** O regulă pe eveniment: evenimentul disponibil, condițiile și recompensele (validate, cu referințe existente). */
  async saveEventRule(actor: GcsActor, id: number | null, input: GcsEventRuleInput): Promise<AchievementRule> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RULES_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) errors.name = "required";
    const events = (await this.deps.rules?.availableEvents()) ?? [];
    const ev = events.find((e) => e.def.key === input.event);
    if (!ev) errors.event = "invalid_choice";
    const conditions = normalizeConditions(input.conditions, ev?.def.kind ?? "count");
    const rewards = normalizeRewards(input.rewards);
    if (rewardEmpty(rewards.actor)) errors.rewards = "rule_empty";
    if (rewards.other && !ev?.def.otherLabelKey) errors.other = "invalid_choice";
    await this.checkReward(rewards.actor, errors, "actor");
    if (rewards.other) await this.checkReward(rewards.other, errors, "other");
    if (conditions.groupIds.length > 0 && (await db.group.count({ where: { id: { in: conditions.groupIds } } })) !== conditions.groupIds.length) errors.groupIds = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = {
      name,
      trigger: "EVENT" as const,
      event: input.event,
      threshold: conditions.n,
      points: rewards.actor.points,
      badgeId: rewards.actor.badgeId,
      enabled: input.enabled,
      conditions: conditions as unknown as Prisma.InputJsonValue,
      rewards: rewards as unknown as Prisma.InputJsonValue,
    };
    const before = id === null ? null : await db.achievementRule.findUnique({ where: { id } });
    if (id !== null && (!before || before.trigger !== "EVENT")) throw new GcsNotFound();
    const row = id === null ? await db.achievementRule.create({ data: { ...data, position: await db.achievementRule.count() } }) : await db.achievementRule.update({ where: { id }, data });
    await this.audit(actor, id === null ? "rule.create" : "rule.update", "achievement_rule", String(row.id), before, row);
    return row;
  }

  private async checkReward(r: GcsRuleReward, errors: Record<string, string>, prefix: string): Promise<void> {
    const { db } = this.deps;
    if (r.badgeId !== null && !(await db.badge.findUnique({ where: { id: r.badgeId } }))) errors[`${prefix}.badgeId`] = "invalid_choice";
    if (r.groupId !== null) {
      const g = await db.group.findUnique({ where: { id: r.groupId } });
      // Grupurile protejate (administrare) nu se dau automat.
      if (!g || g.isProtected || g.isVip) errors[`${prefix}.groupId`] = "invalid_choice";
    }
    if (r.vipGroupId !== null) {
      const g = await db.group.findUnique({ where: { id: r.vipGroupId } });
      if (!g?.isVip || r.vipDays === null) errors[`${prefix}.vipGroupId`] = "invalid_choice";
    }
    if (r.nameStyleId !== null && !(await db.nameStyle.findUnique({ where: { id: r.nameStyleId } }))) errors[`${prefix}.nameStyleId`] = "invalid_choice";
  }

  async setRuleEnabled(actor: GcsActor, id: number, enabled: boolean): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RULES_ACP_SECTION, "edit");
    const before = await db.achievementRule.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.achievementRule.update({ where: { id }, data: { enabled } });
    await this.audit(actor, "rule.update", "achievement_rule", String(id), { enabled: before.enabled }, { enabled });
  }

  /** Copia unei reguli (oprită, ca adminul s-o ajusteze înainte de pornire). */
  async duplicateRule(actor: GcsActor, id: number): Promise<AchievementRule> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RULES_ACP_SECTION, "edit");
    const r = await db.achievementRule.findUnique({ where: { id } });
    if (!r) throw new GcsNotFound();
    const row = await db.achievementRule.create({
      data: {
        name: `${r.name} (2)`.slice(0, 80),
        trigger: r.trigger,
        threshold: r.threshold,
        points: r.points,
        badgeId: r.badgeId,
        enabled: false,
        event: r.event,
        conditions: r.conditions as Prisma.InputJsonValue,
        rewards: r.rewards as Prisma.InputJsonValue,
        position: await db.achievementRule.count(),
      },
    });
    await this.audit(actor, "rule.create", "achievement_rule", String(row.id), undefined, { duplicateOf: id });
    return row;
  }

  /** Regulile pe evenimente ca pachet portabil (badge-urile folosite incluse, referințele după cheie). */
  async exportRules(ids?: number[]): Promise<GcsRulesPack> {
    const { db } = this.deps;
    const rules = await db.achievementRule.findMany({ where: { trigger: "EVENT", ...(ids ? { id: { in: ids } } : {}) }, orderBy: [{ position: "asc" }, { id: "asc" }] });
    const [badges, groups, styles] = await Promise.all([db.badge.findMany(), db.group.findMany({ select: { id: true, key: true } }), db.nameStyle.findMany({ select: { id: true, key: true } })]);
    const bKey = (id: number | null) => badges.find((b) => b.id === id)?.key ?? null;
    const gKey = (id: number | null) => groups.find((g) => g.id === id)?.key ?? null;
    const sKey = (id: number | null) => styles.find((s) => s.id === id)?.key ?? null;
    const used = new Set<number>();
    const reward = (r: GcsRuleReward): GcsPortableReward => {
      if (r.badgeId !== null) used.add(r.badgeId);
      return { points: r.points, badge: bKey(r.badgeId), group: gKey(r.groupId), groupDays: r.groupDays, vipGroup: gKey(r.vipGroupId), vipDays: r.vipDays, nameStyle: sKey(r.nameStyleId) };
    };
    const out: GcsPortableRule[] = rules.map((r) => {
      const c = normalizeConditions(r.conditions, "count");
      const rw = normalizeRewards(r.rewards);
      const raw = (r.conditions ?? {}) as { mode?: string };
      return {
        name: r.name,
        event: r.event ?? "",
        enabled: r.enabled,
        conditions: { mode: raw.mode ?? c.mode, n: c.n, forumIds: c.forumIds, serverIds: c.serverIds, groups: c.groupIds.map(gKey).filter((k): k is string => k !== null), windowDays: c.windowDays },
        rewards: { actor: reward(rw.actor), other: rw.other ? reward(rw.other) : null },
      };
    });
    return {
      kind: RULES_EXPORT_KIND,
      version: 1,
      badges: badges.filter((b) => used.has(b.id)).map((b) => ({ key: b.key, name: b.name, description: b.description, color: b.color, artShape: b.artShape, artTier: b.artTier, artIcon: b.artIcon, points: b.points })),
      rules: out,
    };
  }

  /**
   * Importă un pachet de reguli: badge-urile lipsă se creează (după cheie), regulile se adaugă pornite. Regulile pe
   * evenimente indisponibile (aplicația lor oprită sau lipsă) sau fără recompense valide se sar.
   */
  async importRules(actor: GcsActor, raw: unknown): Promise<{ created: number; skipped: number; badges: number }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, RULES_ACP_SECTION, "edit");
    const pack = raw as Partial<GcsRulesPack> | null;
    if (!pack || pack.kind !== RULES_EXPORT_KIND || !Array.isArray(pack.rules) || pack.rules.length > 200) throw new GcsValidationError({ file: "invalid_file" });
    let badges = 0;
    for (const b of (Array.isArray(pack.badges) ? pack.badges : []).slice(0, 100)) {
      if (!b || typeof b.key !== "string" || !/^[a-z0-9_]{2,40}$/.test(b.key) || (await db.badge.findUnique({ where: { key: b.key } }))) continue;
      const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : "";
      if (!name || !isHexColor(b.color)) continue;
      await db.badge.create({
        data: {
          key: b.key,
          name,
          description: typeof b.description === "string" ? b.description.slice(0, 200) : "",
          color: b.color.toUpperCase(),
          artShape: isBadgeShape(b.artShape) ? b.artShape : null,
          artTier: isBadgeTier(b.artTier) ? b.artTier : null,
          artIcon: typeof b.artIcon === "string" && isGcsIcon(b.artIcon) ? b.artIcon : null,
          points: Number.isInteger(b.points) && Math.abs(b.points!) <= 1000 ? b.points! : 0,
          position: await db.badge.count(),
        },
      });
      badges++;
    }
    if (badges > 0) await this.badgesChanged();
    const [allBadges, groups, styles] = await Promise.all([db.badge.findMany({ select: { id: true, key: true } }), db.group.findMany({ select: { id: true, key: true } }), db.nameStyle.findMany({ select: { id: true, key: true } })]);
    const id = (list: { id: number; key: string }[], key: unknown) => (typeof key === "string" ? (list.find((x) => x.key === key)?.id ?? null) : null);
    const reward = (r: GcsPortableReward | null | undefined): GcsRuleReward | null =>
      r
        ? {
            ...EMPTY_REWARD,
            points: typeof r.points === "number" ? r.points : 0,
            badgeId: id(allBadges, r.badge),
            groupId: id(groups, r.group),
            groupDays: r.groupDays ?? null,
            vipGroupId: id(groups, r.vipGroup),
            vipDays: r.vipDays ?? null,
            nameStyleId: id(styles, r.nameStyle),
          }
        : null;
    let created = 0;
    let skipped = 0;
    for (const rule of pack.rules) {
      try {
        const c = rule?.conditions ?? {};
        await this.saveEventRule(actor, null, {
          name: String(rule?.name ?? ""),
          event: String(rule?.event ?? ""),
          enabled: rule?.enabled !== false,
          conditions: { ...c, groupIds: (c.groups ?? []).map((k) => id(groups, k)).filter((x): x is number => x !== null) },
          rewards: { actor: reward(rule?.rewards?.actor), other: reward(rule?.rewards?.other) },
        });
        created++;
      } catch (error) {
        if (!(error instanceof GcsValidationError)) throw error;
        skipped++;
      }
    }
    await this.audit(actor, "rule.import", "achievement_rule", "*", undefined, { created, skipped, badges });
    return { created, skipped, badges };
  }

  /** „Pachet Gaming”: pachetul gata făcut, importat ca orice fișier. */
  importGamingPack(actor: GcsActor): Promise<{ created: number; skipped: number; badges: number }> {
    return this.importRules(actor, GAMING_PACK);
  }
}
