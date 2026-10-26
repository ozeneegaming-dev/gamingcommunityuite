import {
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  writeAudit,
  type GcsActor,
  type GcsCache,
  type GcsEventBus,
  type GcsPermissionService,
  type GcsReactionService,
  type GcsRateLimiter,
  type GcsRendered,
  type GcsReportService,
  type GcsSettingsService,
  assertMemberCanWrite,
  warningAckRequired,
} from "@gcs/core";
import type { PrismaClient, StatusUpdate } from "@gcs/db";
import { normalizePrivacy, type GcsContactPolicy } from "./privacy";
import type { GcsProfileService } from "./profile";

export const USER_FOLLOW = "user";
export const STATUS_CONTENT_TYPE = "profile.status";

const FOLLOW_LIMIT = { window: 3600, max: 30 };
const IGNORE_TTL = 600;

export type GcsSocialDeps = {
  db: PrismaClient;
  bus: GcsEventBus;
  cache: GcsCache;
  permissions: GcsPermissionService;
  settings: GcsSettingsService;
  rateLimiter: GcsRateLimiter;
  profiles: GcsProfileService;
  /**
   * Randarea conținutului (aceeași ca la postările forumului: validare, sanitizare, lungime maximă). Cu `actor`,
   * mențiunile de grup ale autorului devin pastile (cu pauza dintre mențiuni verificată, `cooldown`).
   */
  render: (content: unknown, ctx?: { actor?: GcsActor; cooldown?: boolean }) => Promise<GcsRendered>;
  /** Pornește pauza dintre mențiunile de grup după salvare. */
  markGroupMentions?: (actor: GcsActor, rendered: GcsRendered) => Promise<void>;
};

const userTags = (...ids: string[]) => ids.map((id) => `user:${id}`);

/** Un actor „ca pe server” pentru un user oarecare (grupurile lui), ca să-i verificăm permisiunile. */
export async function actorOf(db: PrismaClient, userId: string): Promise<GcsActor | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, primaryGroupId: true, groups: { select: { groupId: true } } } });
  if (!user) return null;
  return { userId: user.id, groupIds: [user.primaryGroupId, ...user.groups.map((g) => g.groupId)], primaryGroupId: user.primaryGroupId, isBanned: false, ip: "" };
}

/** Urmăritori, ignorare și peretele profilului (specul etapei 3, §4, §6). */
export class GcsSocialService {
  constructor(private readonly deps: GcsSocialDeps) {}

  // ─── Urmărire ────────────────────────────────────────────────────────────

  async follow(actor: GcsActor, userId: string): Promise<void> {
    const { db, bus, rateLimiter, profiles } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (actor.userId === userId) throw new GcsValidationError({ user: "self" });
    const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, privacy: true } });
    if (!target || !(await profiles.canView(actor, target))) throw new GcsNotFound();
    const limit = await rateLimiter.consume(`follow:${actor.userId}`, FOLLOW_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });

    const created = await db.$transaction(async (tx) => {
      const { count } = await tx.follow.createMany({ data: [{ userId: actor.userId!, contentType: USER_FOLLOW, contentId: userId }], skipDuplicates: true });
      if (count > 0) await tx.user.update({ where: { id: userId }, data: { followersCount: { increment: count } } });
      return count > 0;
    });
    if (created) await bus.emit({ name: "user.followed", payload: { followerId: actor.userId, userId }, tags: userTags(userId, actor.userId) });
  }

  async unfollow(actor: GcsActor, userId: string): Promise<void> {
    const { db, bus } = this.deps;
    if (!actor.userId) return;
    const removed = await db.$transaction(async (tx) => {
      const { count } = await tx.follow.deleteMany({ where: { userId: actor.userId!, contentType: USER_FOLLOW, contentId: userId } });
      if (count > 0) await tx.user.update({ where: { id: userId }, data: { followersCount: { decrement: count } } });
      return count > 0;
    });
    if (removed) await bus.emit({ name: "user.unfollowed", payload: { followerId: actor.userId, userId }, tags: userTags(userId, actor.userId) });
  }

  async isFollowing(followerId: string | null, userId: string): Promise<boolean> {
    if (!followerId) return false;
    return (await this.deps.db.follow.count({ where: { userId: followerId, contentType: USER_FOLLOW, contentId: userId } })) > 0;
  }

  // ─── Ignorare ────────────────────────────────────────────────────────────

  /** Staff-ul (`profile.moderate`) nu poate fi ignorat: altfel n-ar mai putea modera sau scrie. */
  async ignore(actor: GcsActor, userId: string, opts: { posts: boolean; messages: boolean }): Promise<void> {
    const { db, bus, permissions } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (actor.userId === userId) throw new GcsValidationError({ user: "self" });
    const target = await actorOf(db, userId);
    if (!target) throw new GcsNotFound();
    if (await permissions.can(target, "profile.moderate")) throw new GcsValidationError({ user: "staff" });
    if (!opts.posts && !opts.messages) return this.unignore(actor, userId);
    await db.userIgnore.upsert({
      where: { userId_ignoredId: { userId: actor.userId, ignoredId: userId } },
      create: { userId: actor.userId, ignoredId: userId, posts: opts.posts, messages: opts.messages },
      update: { posts: opts.posts, messages: opts.messages },
    });
    await bus.emit({ name: "user.ignored", payload: { userId: actor.userId, ignoredId: userId }, tags: userTags(actor.userId) });
  }

  async unignore(actor: GcsActor, userId: string): Promise<void> {
    if (!actor.userId) return;
    await this.deps.db.userIgnore.deleteMany({ where: { userId: actor.userId, ignoredId: userId } });
    await this.deps.bus.emit({ name: "user.unignored", payload: { userId: actor.userId, ignoredId: userId }, tags: userTags(actor.userId) });
  }

  /** Pe cine ignoră `userId` (la postări sau la mesaje). Cache-uit pe tag-ul `user:{id}`. */
  async ignoredIds(userId: string | null, kind: "posts" | "messages"): Promise<string[]> {
    if (!userId) return [];
    const key = `user:${userId}:ignored:${kind}`;
    const cached = await this.deps.cache.get<string[]>(key);
    if (cached) return cached;
    const rows = await this.deps.db.userIgnore.findMany({ where: { userId, [kind]: true }, select: { ignoredId: true } });
    const ids = rows.map((r) => r.ignoredId);
    await this.deps.cache.set(key, ids, { ttlSec: IGNORE_TTL, tags: userTags(userId) });
    return ids;
  }

  /** `true` dacă `ownerId` îl ignoră pe `otherId` (la `kind`). */
  async isIgnoring(ownerId: string, otherId: string | null, kind: "posts" | "messages"): Promise<boolean> {
    if (!otherId) return false;
    return (await this.ignoredIds(ownerId, kind)).includes(otherId);
  }

  /**
   * Regula de contact comună pereților și mesajelor: `MEMBERS` = orice membru, `FOLLOWED` = doar cei pe care
   * proprietarul îi urmărește, `NOBODY` = nimeni. Proprietarul trece mereu; staff-ul trece de politică (dar nu și de ignorare).
   */
  async allowsContact(actor: GcsActor, ownerId: string, policy: GcsContactPolicy, opts: { staffBypass: boolean }): Promise<boolean> {
    if (!actor.userId) return false;
    if (actor.userId === ownerId) return true;
    if (await this.isIgnoring(ownerId, actor.userId, "messages")) return false;
    if (opts.staffBypass && (await this.deps.profiles.isModerator(actor))) return true;
    if (policy === "MEMBERS") return true;
    if (policy === "NOBODY") return false;
    return this.deps.profiles.ownerFollows(ownerId, actor.userId);
  }

  // ─── Perete ──────────────────────────────────────────────────────────────

  /** Poate `actor` să scrie pe peretele lui `ownerId`? (setări, permisiuni, confidențialitate, ignorare) */
  async canPostOnWall(actor: GcsActor, owner: { id: string; privacy: unknown }): Promise<boolean> {
    const { settings, permissions, profiles } = this.deps;
    if (!actor.userId) return false;
    if (!(await settings.get<boolean>("profile.wall_enabled"))) return false;
    if (!(await permissions.can(actor, "profile.wall_post"))) return false;
    if (!(await profiles.canView(actor, owner))) return false;
    return this.allowsContact(actor, owner.id, normalizePrivacy(owner.privacy).wall, { staffBypass: true });
  }

  async postStatus(actor: GcsActor, profileUserId: string, content: unknown, parentId?: number): Promise<StatusUpdate> {
    const { db, bus, permissions, rateLimiter, render } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const owner = await db.user.findUnique({ where: { id: profileUserId }, select: { id: true, privacy: true } });
    if (!owner) throw new GcsNotFound();
    if (!(await this.canPostOnWall(actor, owner))) throw new GcsForbidden({ permission: "profile.wall_post" });
    if (parentId !== undefined) {
      const parent = await db.statusUpdate.findUnique({ where: { id: parentId } });
      if (!parent || parent.profileUserId !== profileUserId || parent.parentId !== null || parent.visibility !== "VISIBLE") throw new GcsNotFound();
    }
    await assertMemberCanWrite(db, actor.userId, { ackRequired: await warningAckRequired(this.deps.settings) });
    const seconds = await permissions.groupValue<number | boolean>(actor, "forums.flood_seconds");
    if (typeof seconds === "number" && seconds > 0) {
      const res = await rateLimiter.consume(`wall-post:${actor.userId}`, { window: seconds, max: 1 });
      if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter) });
    }
    const rendered = await render(content, { actor, cooldown: true });
    if (rendered.text.trim() === "" && rendered.attachments.length === 0) throw new GcsValidationError({ content: "required" });

    const status = await db.$transaction(async (tx) => {
      const row = await tx.statusUpdate.create({
        data: {
          profileUserId,
          authorId: actor.userId,
          parentId: parentId ?? null,
          contentJson: rendered.json as object,
          contentHtml: rendered.html,
          ip: actor.ip,
        },
      });
      if (parentId !== undefined) await tx.statusUpdate.update({ where: { id: parentId }, data: { repliesCount: { increment: 1 } } });
      return row;
    });
    await this.deps.markGroupMentions?.(actor, rendered);
    await bus.emit({
      name: "status.created",
      payload: { statusId: status.id, profileUserId, authorId: actor.userId, parentId: parentId ?? null },
      tags: [...userTags(profileUserId), `wall:${profileUserId}`],
    });
    return status;
  }

  /** Autorul, proprietarul peretelui sau staff-ul. */
  private async assertCanManageStatus(actor: GcsActor, status: StatusUpdate): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (status.authorId === actor.userId || status.profileUserId === actor.userId) return;
    if (await this.deps.profiles.isModerator(actor)) return;
    throw new GcsForbidden({ permission: "profile.moderate" });
  }

  private async setStatusVisibility(actor: GcsActor, statusId: number, visibility: "HIDDEN" | "VISIBLE"): Promise<void> {
    const { db, bus } = this.deps;
    const status = await db.statusUpdate.findUnique({ where: { id: statusId } });
    if (!status) throw new GcsNotFound();
    await this.assertCanManageStatus(actor, status);
    // Restaurarea e doar a staff-ului (autorul/proprietarul doar ascund).
    if (visibility === "VISIBLE" && !(await this.deps.profiles.isModerator(actor))) throw new GcsForbidden({ permission: "profile.moderate" });
    if (status.visibility === visibility) return;
    await db.$transaction(async (tx) => {
      await tx.statusUpdate.update({ where: { id: statusId }, data: { visibility } });
      if (status.parentId !== null) {
        await tx.statusUpdate.update({ where: { id: status.parentId }, data: { repliesCount: { increment: visibility === "HIDDEN" ? -1 : 1 } } });
      }
    });
    if (status.authorId !== actor.userId) {
      await writeAudit(db, { actorId: actor.userId, action: `profile.status_${visibility === "HIDDEN" ? "hide" : "restore"}`, targetType: "status", targetId: String(statusId), ip: actor.ip });
    }
    await bus.emit({ name: "status.updated", payload: { statusId, visibility }, tags: [...userTags(status.profileUserId), `wall:${status.profileUserId}`] });
  }

  hideStatus(actor: GcsActor, statusId: number): Promise<void> {
    return this.setStatusVisibility(actor, statusId, "HIDDEN");
  }

  restoreStatus(actor: GcsActor, statusId: number): Promise<void> {
    return this.setStatusVisibility(actor, statusId, "VISIBLE");
  }

  async deleteStatus(actor: GcsActor, statusId: number): Promise<void> {
    const { db, bus } = this.deps;
    const status = await db.statusUpdate.findUnique({ where: { id: statusId } });
    if (!status) throw new GcsNotFound();
    await this.assertCanManageStatus(actor, status);
    await db.$transaction(async (tx) => {
      await tx.statusUpdate.delete({ where: { id: statusId } });
      if (status.parentId !== null && status.visibility === "VISIBLE") {
        await tx.statusUpdate.update({ where: { id: status.parentId }, data: { repliesCount: { decrement: 1 } } });
      }
    });
    await bus.emit({ name: "status.deleted", payload: { statusId }, tags: [...userTags(status.profileUserId), `wall:${status.profileUserId}`] });
  }

  /** Un status e vizibil pentru `viewer`: profilul e vizibil, iar statusul (și părintele) nu e ascuns, sau viewer-ul e moderator. */
  async canViewStatus(viewer: GcsActor, statusId: number): Promise<boolean> {
    const { db, profiles } = this.deps;
    const status = await db.statusUpdate.findUnique({
      where: { id: statusId },
      include: { profileUser: { select: { id: true, privacy: true } }, parent: { select: { visibility: true } } },
    });
    if (!status || !(await profiles.canView(viewer, status.profileUser))) return false;
    if (status.visibility === "VISIBLE" && (status.parent?.visibility ?? "VISIBLE") === "VISIBLE") return true;
    return viewer.userId !== null && (await profiles.isModerator(viewer));
  }

  /** Reacțiile și rapoartele pe statusuri, prin serviciile comune (`profile.status`). */
  registerContent(services: { reactions: GcsReactionService; reports: GcsReportService }): void {
    const { db } = this.deps;
    services.reactions.registerContent(STATUS_CONTENT_TYPE, {
      author: async (id) => (await db.statusUpdate.findUnique({ where: { id: Number(id) }, select: { authorId: true } }))?.authorId ?? null,
      canView: (actor, id) => this.canViewStatus(actor, Number(id)),
      tags: async (id) => {
        const s = await db.statusUpdate.findUnique({ where: { id: Number(id) }, select: { profileUserId: true } });
        return s ? [`wall:${s.profileUserId}`] : [];
      },
    });
    services.reports.registerContent(STATUS_CONTENT_TYPE, {
      canView: (actor, id) => this.canViewStatus(actor, Number(id)),
      canModerate: (actor) => this.deps.profiles.isModerator(actor),
      hide: (actor, id) => this.hideStatus(actor, Number(id)),
    });
  }
}
