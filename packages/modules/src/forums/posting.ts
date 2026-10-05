import {
  GcsRateLimited,
  GcsSearchIndex,
  GcsValidationError,
  writeAudit,
  type GcsActor,
  type GcsAttachmentService,
  type GcsContentRenderer,
  type GcsEventBus,
  type GcsPermissionService,
  type GcsRedisRateLimiter,
  type GcsRendered,
  type GcsSettingsService,
} from "@gcs/core";
import type { Forum, Prisma, PrismaClient } from "@gcs/db";
import { GcsForumCounters } from "./counters";
import { RENDER_LABELS } from "./labels";

type Tx = Prisma.TransactionClient;

/** Dependențele serviciilor de scriere ale forumului. */
export type GcsForumDeps = {
  db: PrismaClient;
  bus: GcsEventBus;
  permissions: GcsPermissionService;
  settings: GcsSettingsService;
  rateLimiter: GcsRedisRateLimiter;
  renderer: GcsContentRenderer;
  attachments: GcsAttachmentService;
  /** Host-ul public al site-ului (pentru embed-urile Twitch). */
  siteHost: () => Promise<string>;
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

  /** Pauza minimă între două postări ale aceluiași user (`forums.flood_seconds`). */
  async checkFlood(actor: GcsActor): Promise<void> {
    const seconds = await this.deps.permissions.groupValue<number | boolean>(actor, "forums.flood_seconds");
    if (typeof seconds !== "number" || seconds <= 0) return;
    const res = await this.deps.rateLimiter.consume(`forum-post:${actor.userId}`, { window: seconds, max: 1 });
    if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter) });
  }

  /** Conținutul trimis de editor → JSON validat + HTML sanitizat, cu lungimea maximă din setări. */
  async render(content: unknown): Promise<GcsRendered> {
    const { settings, renderer, siteHost } = this.deps;
    const [embeds, maxChars, locale, host] = await Promise.all([
      settings.get<string[]>("forums.embeds"),
      settings.get<number>("forums.post_max_chars"),
      settings.get<string>("site.locale"),
      siteHost(),
    ]);
    const rendered = renderer.render(content, { embeds, siteHost: host, labels: RENDER_LABELS[locale] ?? RENDER_LABELS.ro! });
    if (rendered.text.length > maxChars) throw new GcsValidationError({ content: "too_long" }, { max: String(maxChars) });
    return rendered;
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
