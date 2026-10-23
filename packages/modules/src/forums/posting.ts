import {
  GcsForbidden,
  GcsRateLimited,
  GcsSearchIndex,
  GcsValidationError,
  writeAudit,
  type GcsActor,
  type GcsAttachmentService,
  type GcsContentRenderer,
  type GcsEventBus,
  type GcsGroupMentionService,
  type GcsPermissionService,
  type GcsRateLimiter,
  type GcsRendered,
  type GcsSettingsService,
} from "@gcs/core";
import type { Forum, Prisma, PrismaClient } from "@gcs/db";
import { allowedBlocks } from "./blocks";
import { GcsForumCounters } from "./counters";
import { RENDER_LABELS } from "./labels";

type Tx = Prisma.TransactionClient;

/** Dependențele serviciilor de scriere ale forumului. */
export type GcsForumDeps = {
  db: PrismaClient;
  bus: GcsEventBus;
  permissions: GcsPermissionService;
  settings: GcsSettingsService;
  rateLimiter: GcsRateLimiter;
  renderer: GcsContentRenderer;
  attachments: GcsAttachmentService;
  /** Host-ul public al site-ului (pentru embed-urile Twitch). */
  siteHost: () => Promise<string>;
  /**
   * Filtrele pluginurilor înainte de salvare (`post.before_save`, etapa 6): pot modifica titlul și conținutul sau pot
   * respinge postarea. Lipsă = fără filtre.
   */
  contentFilter?: <T extends GcsPostFilterInput>(data: T, actor: GcsActor) => Promise<T>;
  /** Mențiunile de grup (Mențiuni v2): ce grupuri poate menționa autorul și pauza dintre mențiuni. Lipsă = text simplu. */
  groupMentions?: GcsGroupMentionService;
  /** Forum v2: SVG-ul unei iconițe Font Awesome (iconițele blocurilor din postări). */
  icon?: (name: string) => string | null;
};

/**
 * Cine scrie conținutul randat (Mențiuni v2): fără `actor`, mențiunile de grup devin text simplu. `keep`: documentul
 * vechi, la o editare (pastilele deja salvate rămân). `cooldown`: verifică pauza dintre mențiuni (conținut nou, care
 * notifică membrii grupului); pauza pornește abia după salvare (`markGroupMentions`). `blocks`: conținutul unei postări
 * din forum (Forum v2): autorul poate folosi blocurile permise grupurilor lui (`forums.block_*`); altfel niciun bloc.
 */
export type GcsRenderContext = { actor?: GcsActor; keep?: unknown; cooldown?: boolean; blocks?: boolean };

/** Datele trimise filtrelor de conținut: topic nou, răspuns sau editare. */
export type GcsPostFilterInput = {
  kind: "topic" | "reply" | "edit";
  title: string | null;
  content: unknown;
  forumId: number;
  topicId: number | null;
  authorId: string | null;
};

/** Tranzacțiile de scriere: mai lungi decât implicitul Prisma (5 s), pentru vârfuri de trafic. */
export const WRITE_TX = { timeout: 15_000, maxWait: 15_000 };

export const POST_CONTENT_TYPE = "forums.post";
export const forumContainer = (forumId: number) => ({ type: "forum", id: String(forumId) });

/** Logica comună topicurilor și răspunsurilor: moderare, aprobare, flood, randare, promovare. */
export class GcsForumPosting {
  readonly counters = new GcsForumCounters();
  readonly search = new GcsSearchIndex();

  constructor(readonly deps: GcsForumDeps) {}

  /** Moderator pe forum: global (`forums.moderate_all`) sau pe acel forum, cu puterea cerută. */
  async isModerator(actor: GcsActor, power: string, forumId: number): Promise<boolean> {
    if (!actor.userId) return false;
    const { permissions } = this.deps;
    return (await permissions.can(actor, "forums.moderate_all")) || (await permissions.canModerate(actor, power, forumContainer(forumId)));
  }

  /** Poate citi și face acțiunea pe forum (ex. `forums.reply`). */
  async canOnForum(actor: GcsActor, permission: string, forumId: number): Promise<boolean> {
    const { permissions } = this.deps;
    const ref = forumContainer(forumId);
    return (await permissions.can(actor, "forums.read", ref)) && (await permissions.can(actor, permission, ref));
  }

  /** O postare nouă trece prin coada de aprobare? (specul etapei 2, §2: primele postări ale unui cont nou, sau forumul o cere) */
  async needsApproval(actor: GcsActor, forum: Pick<Forum, "id" | "requireApproval">): Promise<boolean> {
    if (await this.isModerator(actor, "approve", forum.id)) return false;
    if (forum.requireApproval) return true;
    const firstPosts = await this.deps.permissions.groupValue<number | boolean>(actor, "forums.approval_first_posts");
    if (typeof firstPosts !== "number" || firstPosts <= 0) return false;
    const user = await this.deps.db.user.findUnique({ where: { id: actor.userId! }, select: { approvedPostsCount: true } });
    return (user?.approvedPostsCount ?? 0) < firstPosts;
  }

  /**
   * Forum v2: opțiunile forumului la postare. Sondajele și tag-urile oprite pe forum se refuză oricui; pragul de postări
   * (`minPosts`) și regulile de acceptat (`rulesMode: accept`) se aplică membrilor fără puteri de moderare.
   */
  async checkForumOptions(actor: GcsActor, forum: Pick<Forum, "id" | "minPosts" | "rulesMode" | "pollsEnabled" | "tagsEnabled">, opts: { poll?: boolean; tags?: number } = {}): Promise<void> {
    if (opts.poll && !forum.pollsEnabled) throw new GcsValidationError({ poll: "disabled" });
    if ((opts.tags ?? 0) > 0 && !forum.tagsEnabled) throw new GcsValidationError({ tags: "disabled" });
    if (!actor.userId || (forum.minPosts <= 0 && forum.rulesMode !== "accept")) return;
    if (await this.isModerator(actor, "edit", forum.id)) return;
    if (forum.minPosts > 0) {
      const user = await this.deps.db.user.findUnique({ where: { id: actor.userId }, select: { postsCount: true } });
      if ((user?.postsCount ?? 0) < forum.minPosts) throw new GcsForbidden({ reason: "min_posts", min: String(forum.minPosts) });
    }
    if (forum.rulesMode === "accept") {
      const accepted = await this.deps.db.forumRulesAcceptance.findUnique({ where: { forumId_userId: { forumId: forum.id, userId: actor.userId } }, select: { forumId: true } });
      if (!accepted) throw new GcsForbidden({ reason: "rules_not_accepted" });
    }
  }

  /** Pauza minimă între două postări ale aceluiași user (`forums.flood_seconds`). */
  async checkFlood(actor: GcsActor): Promise<void> {
    const seconds = await this.deps.permissions.groupValue<number | boolean>(actor, "forums.flood_seconds");
    if (typeof seconds !== "number" || seconds <= 0) return;
    const res = await this.deps.rateLimiter.consume(`forum-post:${actor.userId}`, { window: seconds, max: 1 });
    if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter) });
  }

  /** Trece datele unei postări prin filtrele pluginurilor (dacă există), înainte de validare și randare. */
  async filterContent<T extends GcsPostFilterInput>(actor: GcsActor, data: T): Promise<T> {
    return this.deps.contentFilter ? this.deps.contentFilter(data, actor) : data;
  }

  /**
   * Conținutul trimis de editor → JSON validat + HTML sanitizat, cu lungimea maximă din setări. Cu `ctx.actor`,
   * mențiunile grupurilor pe care autorul le poate menționa rămân pastile; restul devin text simplu.
   */
  async render(content: unknown, ctx: GcsRenderContext = {}): Promise<GcsRendered> {
    const { settings, renderer, siteHost, groupMentions } = this.deps;
    const [embeds, maxChars, locale, host, groups, blocks] = await Promise.all([
      settings.get<string[]>("forums.embeds"),
      settings.get<number>("forums.post_max_chars"),
      settings.get<string>("site.locale"),
      siteHost(),
      groupMentions && ctx.actor ? groupMentions.renderMap(ctx.actor, ctx.keep) : Promise.resolve(undefined),
      ctx.blocks && ctx.actor ? allowedBlocks(this.deps, ctx.actor, ctx.keep) : Promise.resolve([]),
    ]);
    const rendered = renderer.render(content, {
      embeds,
      siteHost: host,
      labels: RENDER_LABELS[locale] ?? RENDER_LABELS.ro!,
      ...(groups ? { groups } : {}),
      blocks,
      ...(this.deps.icon ? { icon: this.deps.icon } : {}),
    });
    if (rendered.text.length > maxChars) throw new GcsValidationError({ content: "too_long" }, { max: String(maxChars) });
    if (ctx.cooldown && ctx.actor && groupMentions) await groupMentions.assertCooldown(ctx.actor, rendered.groupMentions);
    return rendered;
  }

  /** Pornește pauza dintre mențiuni pentru grupurile menționate într-un conținut nou, după salvare. */
  async markGroupMentions(actor: GcsActor, rendered: Pick<GcsRendered, "groupMentions">): Promise<void> {
    await this.deps.groupMentions?.markCooldown(actor, rendered.groupMentions);
  }

  /** Titlul unui topic: spațiile multiple comasate, 3–150 de caractere. */
  cleanTitle(title: string): string {
    const clean = title.replace(/\s+/g, " ").trim();
    if (clean.length < 3) throw new GcsValidationError({ title: "too_short" });
    if (clean.length > 150) throw new GcsValidationError({ title: "too_long" });
    return clean;
  }

  /**
   * Promovarea automată *Membru nou → Membru* la `new_member.post_threshold` postări aprobate (specul etapei 2, §3).
   * Întoarce `true` dacă userul a fost promovat; apelantul emite evenimentul după commit.
   */
  async promoteIfReady(tx: Tx, userId: string | null): Promise<boolean> {
    if (!userId) return false;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { approvedPostsCount: true, primaryGroupId: true, primaryGroup: { select: { key: true } } },
    });
    if (user?.primaryGroup.key !== "new_member") return false;
    const setting = await tx.groupSetting.findUnique({
      where: { groupId_key: { groupId: user.primaryGroupId, key: "new_member.post_threshold" } },
    });
    const threshold = typeof setting?.value === "number" ? setting.value : 5;
    if (user.approvedPostsCount < threshold) return false;

    const member = await tx.group.findUnique({ where: { key: "member" }, select: { id: true } });
    if (!member) return false;
    await tx.user.update({ where: { id: userId }, data: { primaryGroupId: member.id, previousPrimaryGroupId: user.primaryGroupId } });
    await tx.userGroup.deleteMany({ where: { userId, groupId: member.id } });
    await writeAudit(tx, {
      actorId: null,
      action: "user.promoted",
      targetType: "user",
      targetId: userId,
      before: { primaryGroupId: user.primaryGroupId },
      after: { primaryGroupId: member.id, approvedPostsCount: user.approvedPostsCount },
    });
    return true;
  }

  async emitPromoted(userId: string): Promise<void> {
    await this.deps.bus.emit({ name: "user.promoted", payload: { userId }, tags: [`user:${userId}`] });
  }

  /** Pagina pe care apare postarea, după postările vizibile dinaintea ei (plus ea însăși). */
  async pageOf(topicId: number, postId: number): Promise<number> {
    const [before, perPage] = await Promise.all([
      this.deps.db.post.count({ where: { topicId, visibility: "VISIBLE", id: { lt: postId } } }),
      this.deps.settings.get<number>("forums.posts_per_page"),
    ]);
    return Math.floor(before / perPage) + 1;
  }
}
