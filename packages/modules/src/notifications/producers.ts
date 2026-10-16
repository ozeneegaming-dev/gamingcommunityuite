import {
  contentRefs,
  type GcsActor,
  type GcsActorResolver,
  type GcsEventBus,
  type GcsGroupMentionService,
  type GcsJobData,
  type GcsJobQueue,
  type GcsMailer,
  type GcsNotificationService,
  type GcsRealtime,
  type GcsSettingsService,
} from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type Redis from "ioredis";
import { canViewPost } from "../forums/content";
import { POST_CONTENT_TYPE, type GcsForumPosting } from "../forums/posting";
import type { GcsForumQueries } from "../forums/queries";
import { slugify } from "../forums/slug";
import type { GcsConversationService } from "../messages/conversations";
import { docSnippet } from "../content-text";
import { STEAM_PLACEHOLDER_DOMAIN } from "../profile/profile";
import { digestMail, notificationMail, type GcsNotificationMailItem } from "./emails";
import type { GcsGroupDirectory } from "../profile/groupDirectory";

export const NOTIFY_FANOUT_JOB = "notifications.fanout";
export const NOTIFY_EMAIL_JOB = "notifications.email";
export const NOTIFY_DIGEST_JOB = "notifications.digest";
export const NOTIFY_CLEANUP_JOB = "notifications.cleanup";
export const NOTIFY_GROUP_MENTION_JOB = "notifications.group_mention";

const FANOUT_BATCH = 500;
/** O postare cu zeci de mențiuni nu trimite zeci de notificări. */
const MAX_REFS = 20;
/** Câte grupuri dintr-un conținut notifică membrii (restul pastilelor rămân, fără notificări). */
const MAX_GROUP_REFS = 5;
/** Membrii unui grup menționat se citesc în loturi; cel mult atâția candidați verificați pe grup. */
const GROUP_BATCH = 200;
const GROUP_SCAN_MAX = 2_000;
const SNIPPET_MAX = 140;
const DIGEST_CHECK_MS = 15 * 60_000;
const DIGEST_MAX_ITEMS = 50;

type FanoutKind = "reply" | "topic";

const memberHref = (u: { id: string; name: string }) => `/members/${u.id}-${slugify(u.name)}`;
const topicHref = (t: { id: number; title: string }) => `/topic/${t.id}-${slugify(t.title)}`;

const snippetOf = (json: unknown) => docSnippet(json, SNIPPET_MAX);

/**
 * Producătorii de notificări (specul etapei 4 §6): ascultătorii care transformă evenimentele modulelor în notificări,
 * țintele lor (acces + descriere), livrarea live, emailurile imediate și digestul zilnic.
 * Cu `jobs: null` (teste), joburile rulează pe loc.
 */
export class GcsNotificationProducers {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      redis: Redis;
      notifications: GcsNotificationService;
      actors: GcsActorResolver;
      posting: GcsForumPosting;
      forumQueries: GcsForumQueries;
      conversations: GcsConversationService;
      settings: GcsSettingsService;
      mailer: GcsMailer;
      realtime: GcsRealtime;
      jobs: GcsJobQueue | null;
      baseUrl: () => Promise<string>;
      /** Mențiunile de grup (Mențiuni v2); lipsă = fără notificări pentru grupuri. */
      groupMentions?: GcsGroupMentionService;
      /** Setările de afișare ale grupurilor („doar membrii cu grupul principal”). */
      groupDirectory?: GcsGroupDirectory;
    },
  ) {}

  /** Actorul unui destinatar (fără IP: un ban pe IP nu ascunde notificările). */
  private actor(userId: string): Promise<GcsActor> {
    return this.deps.actors.forUser(userId, "");
  }

  registerTargets(): void {
    const { db, notifications, posting, forumQueries, conversations } = this.deps;
    notifications.registerTarget("forums.post", {
      canView: async (userId, id) => canViewPost(posting, await this.actor(userId), Number(id)),
      describe: async (id) => {
        const post = await db.post.findUnique({ where: { id: Number(id) }, select: { contentJson: true, topic: { select: { id: true, title: true } } } });
        return post ? { title: post.topic.title, href: `${topicHref(post.topic)}/post/${id}`, snippet: snippetOf(post.contentJson) } : null;
      },
    });
    notifications.registerTarget("forums.topic", {
      canView: async (userId, id) => (await forumQueries.topicAccess(await this.actor(userId), Number(id))).canRead,
      describe: async (id) => {
        const topic = await db.topic.findUnique({ where: { id: Number(id) }, select: { id: true, title: true } });
        return topic ? { title: topic.title, href: topicHref(topic) } : null;
      },
    });
    notifications.registerTarget("profile.user", {
      canView: async () => true,
      describe: async (id) => {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, name: true } });
        return user ? { title: user.name, href: memberHref(user) } : null;
      },
    });
    notifications.registerTarget("profile.status", {
      canView: async (_userId, id) => (await db.statusUpdate.findUnique({ where: { id: Number(id) }, select: { visibility: true } }))?.visibility === "VISIBLE",
      describe: async (id) => {
        const status = await db.statusUpdate.findUnique({ where: { id: Number(id) }, select: { contentJson: true, profileUser: { select: { id: true, name: true } } } });
        return status ? { title: status.profileUser.name, href: `${memberHref(status.profileUser)}#status-${id}`, snippet: snippetOf(status.contentJson) } : null;
      },
    });
    notifications.registerTarget("pm.conversation", {
      canView: (userId, id) => conversations.isParticipant(userId, Number(id)),
      describe: async (id) => {
        const conv = await db.conversation.findUnique({ where: { id: Number(id) }, select: { title: true } });
        return conv ? { title: conv.title, href: `/messages/${id}` } : null;
      },
    });
    notifications.registerTarget("vip.subscription", {
      canView: async (userId, id) => (await db.vipSubscription.findUnique({ where: { id: Number(id) }, select: { userId: true } }))?.userId === userId,
      describe: async (id) => {
        const sub = await db.vipSubscription.findUnique({ where: { id: Number(id) }, select: { group: { select: { name: true } } } });
        return sub ? { title: sub.group.name, href: "/settings" } : null;
      },
    });
    // Membri v2: grupul secundar expirat (titlul = numele grupului, linkul = membrii grupului).
    notifications.registerTarget("core.group", {
      canView: async () => true,
      describe: async (id) => {
        const group = await db.group.findUnique({ where: { id: Number(id) }, select: { id: true, name: true } });
        return group ? { title: group.name, href: `/members?group=${group.id}` } : null;
      },
    });
    notifications.registerTarget("core.warning", {
      canView: async (userId, id) => (await db.warning.findUnique({ where: { id }, select: { userId: true } }))?.userId === userId,
      describe: async (id) => {
        const warning = await db.warning.findUnique({ where: { id }, select: { reason: true } });
        return warning ? { title: warning.reason, href: "/settings" } : null;
      },
    });
  }

  listen(bus: GcsEventBus): void {
    const { db, notifications, realtime, conversations } = this.deps;
    const str = (v: unknown) => (typeof v === "string" ? v : null);

    bus.on("post.created", async (e) => {
      if (!e.payload.pending) await this.onPostVisible(Number(e.payload.postId), "reply");
    });
    bus.on("topic.created", async (e) => {
      if (!e.payload.pending) await this.onPostVisible(Number(e.payload.postId), "topic");
    });
    // La aprobare pleacă notificările amânate ale postărilor (inclusiv primul mesaj al unui topic nou).
    bus.on("post.approved", async (e) => {
      for (const p of (e.payload.posts as { postId: number }[] | undefined) ?? []) {
        const post = await db.post.findUnique({ where: { id: p.postId }, select: { topic: { select: { firstPostId: true } } } });
        if (post) await this.onPostVisible(p.postId, post.topic.firstPostId === p.postId ? "topic" : "reply");
      }
    });
    bus.on("reaction.changed", async (e) => {
      const { contentType, contentId, reactionId, userId, authorId } = e.payload;
      if (contentType !== POST_CONTENT_TYPE || typeof reactionId !== "number" || !str(authorId)) return;
      const reaction = await db.reaction.findUnique({ where: { id: reactionId }, select: { weight: true } });
      if (!reaction || reaction.weight <= 0) return;
      await notifications.notify({ userIds: [authorId as string], type: "forums.reaction", targetType: "forums.post", targetId: String(contentId), actorId: str(userId) });
    });
    bus.on("topic.solved", async (e) => {
      const solver = str(e.payload.solverId);
      if (solver) await notifications.notify({ userIds: [solver], type: "forums.solution", targetType: "forums.post", targetId: String(e.payload.postId), actorId: str(e.payload.actorId) });
    });
    bus.on("user.followed", async (e) => {
      const userId = str(e.payload.userId);
      if (userId) await notifications.notify({ userIds: [userId], type: "profile.follower", targetType: "profile.user", targetId: userId, actorId: str(e.payload.followerId) });
    });
    bus.on("status.created", async (e) => {
      const profileUserId = str(e.payload.profileUserId);
      const authorId = str(e.payload.authorId);
      const statusId = Number(e.payload.statusId);
      // Mențiunile din status sau din comentariu (după id): membrii cu notificarea de mențiune, grupurile prin worker.
      const status = Number.isSafeInteger(statusId) ? await db.statusUpdate.findUnique({ where: { id: statusId }, select: { contentJson: true } }) : null;
      const refs = status ? contentRefs(status.contentJson) : { mentions: [] as string[], groups: [] as number[] };
      const mentioned = refs.mentions.filter((id) => id !== authorId).slice(0, MAX_REFS);
      const target = { targetType: "profile.status", targetId: String(statusId), actorId: authorId };
      if (mentioned.length > 0) await notifications.notify({ userIds: mentioned, type: "forums.mention", ...target });
      const groups = refs.groups.slice(0, MAX_GROUP_REFS);
      if (groups.length > 0) await this.run(NOTIFY_GROUP_MENTION_JOB, { ...target, groups, skip: mentioned }, `notif-group-status-${statusId}`);
      if (!profileUserId || e.payload.parentId !== null || mentioned.includes(profileUserId)) return;
      await notifications.notify({ userIds: [profileUserId], type: "profile.wall", ...target });
    });
    bus.on("badge.awarded", async (e) => {
      const userId = str(e.payload.userId);
      const badge = await db.badge.findUnique({ where: { id: Number(e.payload.badgeId) }, select: { name: true } });
      if (userId && badge) {
        await notifications.notify({ userIds: [userId], type: "profile.badge", targetType: "profile.user", targetId: userId, actorId: null, data: { title: badge.name } });
      }
    });
    bus.on("rank.changed", async (e) => {
      const userId = str(e.payload.userId);
      if (!userId || typeof e.payload.rankId !== "number") return;
      const rank = await db.rank.findUnique({ where: { id: e.payload.rankId }, select: { name: true } });
      if (rank) await notifications.notify({ userIds: [userId], type: "profile.badge", targetType: "profile.user", targetId: userId, actorId: null, data: { title: rank.name } });
    });
    bus.on("pm.message.created", async (e) => {
      const conversationId = Number(e.payload.conversationId);
      const authorId = str(e.payload.authorId);
      const participants = await db.conversationParticipant.findMany({ where: { conversationId, leftAt: null }, select: { userId: true } });
      const others = participants.map((p) => p.userId).filter((id) => id !== authorId);
      await notifications.notify({ userIds: others, type: "pm.message", targetType: "pm.conversation", targetId: String(conversationId), actorId: authorId });
      for (const userId of others) await realtime.publish(`user:${userId}`, "pm", { unread: await conversations.unreadCount(userId) });
      // Mențiunile de grup dintr-un mesaj privat: doar membrii grupului care participă la conversație o pot vedea.
      const messageId = Number(e.payload.messageId);
      const message = Number.isSafeInteger(messageId) ? await db.conversationMessage.findUnique({ where: { id: messageId }, select: { contentJson: true } }) : null;
      // Mențiunile de membri: doar participanții (ceilalți nu văd conversația), cu notificarea de mențiune.
      const mentioned = message ? contentRefs(message.contentJson).mentions.filter((id) => others.includes(id)).slice(0, MAX_REFS) : [];
      if (mentioned.length > 0) {
        await notifications.notify({ userIds: mentioned, type: "forums.mention", targetType: "pm.conversation", targetId: String(conversationId), actorId: authorId });
      }
      const groups = message ? contentRefs(message.contentJson).groups.slice(0, MAX_GROUP_REFS) : [];
      if (groups.length > 0) {
        await this.run(NOTIFY_GROUP_MENTION_JOB, { targetType: "pm.conversation", targetId: String(conversationId), actorId: authorId, groups, skip: mentioned }, `notif-group-pm-${messageId}`);
      }
    });
    // Mențiunile din conținutul fără editor de postări (chat-ul, statusurile de pe profil, tichetele): membrii după id,
    // cu tipul dat (implicit `forums.mention`, „te-a menționat în …”), grupurile prin notificarea de grup (setările lor).
    bus.on("mentions.created", async (e) => {
      const targetType = str(e.payload.targetType);
      const targetId = str(e.payload.targetId);
      if (!targetType || !targetId) return;
      const authorId = str(e.payload.authorId);
      const type = typeof e.payload.type === "string" && e.payload.type ? e.payload.type : "forums.mention";
      const userIds = (Array.isArray(e.payload.userIds) ? e.payload.userIds : [])
        .filter((id): id is string => typeof id === "string" && id !== authorId)
        .slice(0, MAX_REFS);
      if (userIds.length > 0) await notifications.notify({ userIds, type, targetType, targetId, actorId: authorId });
      const groups = (Array.isArray(e.payload.groupIds) ? e.payload.groupIds : []).filter((id): id is number => Number.isInteger(id)).slice(0, MAX_GROUP_REFS);
      const skip = (Array.isArray(e.payload.skip) ? e.payload.skip : []).filter((id): id is string => typeof id === "string");
      if (groups.length > 0) {
        await this.run(NOTIFY_GROUP_MENTION_JOB, { targetType, targetId, actorId: authorId, groups, skip: [...userIds, ...skip] }, `notif-group-${targetType}-${targetId}`);
      }
    });
    bus.on("pm.read", async (e) => {
      const userId = str(e.payload.userId);
      if (userId) await realtime.publish(`user:${userId}`, "pm", { unread: await conversations.unreadCount(userId) });
    });
    for (const type of ["vip.granted", "vip.expiring", "vip.expired"]) {
      bus.on(type, async (e) => {
        const userId = str(e.payload.userId);
        if (!userId || typeof e.payload.subscriptionId !== "number") return;
        const data = typeof e.payload.expiresAt === "string" ? { expiresAt: e.payload.expiresAt } : undefined;
        await notifications.notify({ userIds: [userId], type, targetType: "vip.subscription", targetId: String(e.payload.subscriptionId), actorId: null, ...(data ? { data } : {}) });
      });
    }
    bus.on("group.secondary_expired", async (e) => {
      const userId = str(e.payload.userId);
      if (!userId || typeof e.payload.groupId !== "number") return;
      await notifications.notify({ userIds: [userId], type: "core.group_expired", targetType: "core.group", targetId: String(e.payload.groupId), actorId: null });
    });
    // Avertismentul nu are actor: un user care ignoră moderatorul îl primește oricum.
    bus.on("user.warned", async (e) => {
      const userId = str(e.payload.userId);
      if (userId) await notifications.notify({ userIds: [userId], type: "core.warning", targetType: "core.warning", targetId: String(e.payload.warningId), actorId: null });
    });

    // Livrarea: live în camera userului; emailul imediat printr-un job (un singur email pe notificare).
    bus.on("notification.created", async (e) => {
      const userId = e.payload.userId as string;
      // `created`: clientul ia notificarea (tradusă în limba lui) și o arată ca toast (etapa 5).
      await realtime.publish(`user:${userId}`, "notification", { unread: await notifications.unreadCount(userId), created: e.payload.notificationId });
      if (e.payload.email === "INSTANT") await this.run(NOTIFY_EMAIL_JOB, { notificationId: e.payload.notificationId }, `notif-email-${String(e.payload.notificationId)}`);
    });
    bus.on("notification.read", async (e) => {
      await realtime.publish(`user:${String(e.payload.userId)}`, "notification", { unread: e.payload.unread });
    });
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: NOTIFY_FANOUT_JOB, handler: (data) => this.fanout(data) });
    jobs.register({ name: NOTIFY_GROUP_MENTION_JOB, handler: (data) => this.groupMentionFanout(data) });
    jobs.register({ name: NOTIFY_EMAIL_JOB, handler: async (data) => void (await this.sendInstant(Number(data.notificationId))) });
    jobs.register({ name: NOTIFY_DIGEST_JOB, everyMs: DIGEST_CHECK_MS, handler: async () => void (await this.digestIfDue()) });
    jobs.register({ name: NOTIFY_CLEANUP_JOB, everyMs: 24 * 3600_000, handler: async () => void (await this.deps.notifications.cleanup()) });
  }

  /** În worker (prin coadă) sau pe loc, fără coadă. */
  private async run(name: string, data: GcsJobData, jobId?: string): Promise<void> {
    if (this.deps.jobs) {
      await this.deps.jobs.enqueue(name, data, jobId ? { jobId } : {});
      return;
    }
    if (name === NOTIFY_FANOUT_JOB) await this.fanout(data);
    else if (name === NOTIFY_GROUP_MENTION_JOB) await this.groupMentionFanout(data);
    else if (name === NOTIFY_EMAIL_JOB) await this.sendInstant(Number(data.notificationId));
  }

  /** O postare a devenit vizibilă: mențiunile și citatele pe loc, urmăritorii prin job. */
  async onPostVisible(postId: number, kind: FanoutKind): Promise<void> {
    const { db, notifications } = this.deps;
    const post = await db.post.findUnique({ where: { id: postId }, select: { authorId: true, contentJson: true } });
    if (!post) return;
    const refs = contentRefs(post.contentJson);
    const mentioned = refs.mentions.slice(0, MAX_REFS);
    const quotedAuthors = (await db.post.findMany({ where: { id: { in: refs.quotes.slice(0, MAX_REFS) } }, select: { authorId: true } }))
      .map((p) => p.authorId)
      .filter((id): id is string => id !== null && !mentioned.includes(id));
    const target = { targetType: "forums.post", targetId: String(postId), actorId: post.authorId };
    await notifications.notify({ userIds: mentioned, type: "forums.mention", ...target });
    await notifications.notify({ userIds: quotedAuthors, type: "forums.quote", ...target });
    // Cine a fost deja notificat pentru mențiune sau citat nu mai primește și „răspuns nou” pentru aceeași postare.
    await this.run(NOTIFY_FANOUT_JOB, { kind, postId, skip: [...mentioned, ...quotedAuthors] }, `notif-fanout-${postId}`);
    // Mențiunile de grup (Mențiuni v2), tot prin worker: membrii grupurilor, fără cei notificați deja direct.
    const groups = refs.groups.slice(0, MAX_GROUP_REFS);
    if (groups.length > 0) {
      await this.run(
        NOTIFY_GROUP_MENTION_JOB,
        { targetType: "forums.post", targetId: String(postId), actorId: post.authorId, groups, skip: [...mentioned, ...quotedAuthors] },
        `notif-group-post-${postId}`,
      );
    }
  }

  /**
   * Notificările unei mențiuni de grup (`core.group_mention`, cu numele grupului): membrii grupului (principal sau
   * secundar), cei mai activi primii, cel mult `notifyLimit` pe grup. Sar autorul, cei care nu văd conținutul și cei
   * notificați deja (mențiune directă, citat sau alt grup menționat în același conținut). Preferințele fiecărui membru
   * (tipul oprit pe site, ignorarea autorului) le aplică `notify`.
   */
  async groupMentionFanout(data: GcsJobData): Promise<void> {
    const { db, notifications, groupMentions } = this.deps;
    if (!groupMentions || typeof data.targetType !== "string" || typeof data.targetId !== "string") return;
    const { targetType, targetId } = data;
    const actorId = typeof data.actorId === "string" ? data.actorId : null;
    const groupIds = (Array.isArray(data.groups) ? data.groups : []).filter((id): id is number => Number.isInteger(id)).slice(0, MAX_GROUP_REFS);
    const notified = new Set<string>([...(Array.isArray(data.skip) ? data.skip.filter((id): id is string => typeof id === "string") : []), ...(actorId ? [actorId] : [])]);
    const all = await groupMentions.groups();

    for (const groupId of new Set(groupIds)) {
      const group = all.find((g) => g.id === groupId);
      if (!group || !group.mentionable || !group.settings.notify) continue;
      const limit = group.settings.notifyLimit;
      const picked: string[] = [];
      // Membrii grupului: principal sau secundar, sau doar principal dacă grupul cere („doar grupul principal”).
      const primaryOnly = (await this.deps.groupDirectory?.group(groupId))?.primaryOnly === true;
      for (let offset = 0; picked.length < limit && offset < GROUP_SCAN_MAX; offset += GROUP_BATCH) {
        const batch = await db.user.findMany({
          where: primaryOnly ? { primaryGroupId: groupId } : { OR: [{ primaryGroupId: groupId }, { groups: { some: { groupId } } }] },
          orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
          skip: offset,
          take: GROUP_BATCH,
          select: { id: true },
        });
        for (const { id } of batch) {
          if (picked.length >= limit) break;
          if (notified.has(id)) continue;
          if ((await notifications.visibleTo(targetType, targetId, [id])).length > 0) picked.push(id);
        }
        if (batch.length < GROUP_BATCH) break;
      }
      for (const id of picked) notified.add(id);
      if (picked.length === 0) continue;
      await notifications.notify({ userIds: picked, type: "core.group_mention", targetType, targetId, actorId, data: { group: group.name, groupId: group.id } });
    }
  }

  /** Urmăritorii topicului (răspuns) sau ai forumului (topic nou), în loturi. */
  async fanout(data: GcsJobData): Promise<void> {
    const { db, notifications } = this.deps;
    const kind = data.kind === "topic" ? "topic" : "reply";
    const postId = Number(data.postId);
    const skip = new Set(Array.isArray(data.skip) ? (data.skip as string[]) : []);
    const post = await db.post.findUnique({ where: { id: postId }, select: { authorId: true, visibility: true, topic: { select: { id: true, title: true, forumId: true } } } });
    if (!post || post.visibility !== "VISIBLE") return;
    const { topic } = post;
    const contentType = kind === "topic" ? "forum" : "topic";
    const contentId = String(kind === "topic" ? topic.forumId : topic.id);
    let cursor = 0;
    for (;;) {
      const batch = await db.follow.findMany({
        where: { contentType, contentId, id: { gt: cursor } },
        orderBy: { id: "asc" },
        take: FANOUT_BATCH,
        select: { id: true, userId: true },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;
      const userIds = batch.map((f) => f.userId).filter((id) => !skip.has(id));
      await notifications.notify(
        kind === "topic"
          ? { userIds, type: "forums.topic", targetType: "forums.topic", targetId: String(topic.id), actorId: post.authorId }
          : // Răspunsurile se grupează pe topic; linkul duce la cel mai nou răspuns.
            { userIds, type: "forums.reply", targetType: "forums.topic", targetId: String(topic.id), actorId: post.authorId, data: { href: `${topicHref(topic)}/post/${postId}` } },
      );
      if (batch.length < FANOUT_BATCH) break;
    }
  }

  private async mailContext() {
    const { settings } = this.deps;
    const [site, locale, siteUrl] = await Promise.all([settings.get<string>("site.name"), settings.get<string>("site.locale"), this.deps.baseUrl()]);
    return { site, locale, siteUrl };
  }

  private async mailItems(rows: { type: string; count: number; actorIds: string[]; data: unknown }[]): Promise<GcsNotificationMailItem[]> {
    const ids = [...new Set(rows.flatMap((r) => r.actorIds))];
    const names = new Map((await this.deps.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return rows.map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      return {
        type: r.type,
        count: r.count,
        actors: r.actorIds.map((id) => names.get(id)).filter((n): n is string => !!n),
        title: typeof data.title === "string" ? data.title : "",
        href: typeof data.href === "string" ? data.href : "/notifications",
        ...(typeof data.snippet === "string" && data.snippet ? { snippet: data.snippet } : {}),
        data,
      };
    });
  }

  /** Emailul imediat: revendicat atomic (`emailedAt`), deci un job rulat de două ori trimite un singur email. */
  async sendInstant(notificationId: number, now = new Date()): Promise<boolean> {
    const { db, mailer } = this.deps;
    if (!Number.isSafeInteger(notificationId)) return false;
    const { count } = await db.notification.updateMany({ where: { id: notificationId, emailedAt: null, readAt: null }, data: { emailedAt: now } });
    if (count === 0) return false;
    const n = await db.notification.findUniqueOrThrow({ where: { id: notificationId }, include: { user: { select: { name: true, email: true } } } });
    if (n.user.email.endsWith(STEAM_PLACEHOLDER_DOMAIN)) return false;
    const [item] = await this.mailItems([n]);
    try {
      await mailer(notificationMail({ to: n.user.email, name: n.user.name, ...(await this.mailContext()), item: item! }));
    } catch (error) {
      // Reîncercat de coadă: revendicarea se anulează.
      await db.notification.updateMany({ where: { id: notificationId, emailedAt: now }, data: { emailedAt: null } });
      throw error;
    }
    return true;
  }

  /**
   * Digestul: pentru fiecare user, notificările necitite, netrimise, cu emailul pe `DIGEST`. Revendicarea e un singur
   * `UPDATE … RETURNING` pe user, deci două rulări simultane nu trimit două emailuri.
   */
  async digest(now = new Date()): Promise<number> {
    const { db, notifications, mailer } = this.deps;
    const users = await db.notification.findMany({ where: { readAt: null, emailedAt: null }, distinct: ["userId"], select: { userId: true } });
    const ctx = await this.mailContext();
    let sent = 0;
    for (const { userId } of users) {
      const prefs = await notifications.preferences(userId);
      const types = Object.entries(prefs)
        .filter(([, p]) => p.email === "DIGEST")
        .map(([t]) => t);
      if (types.length === 0) continue;
      const claimed = await db.$queryRaw<{ id: number }[]>`
        UPDATE notifications SET "emailedAt" = ${now.toISOString()}::timestamp
        WHERE "userId" = ${userId} AND "readAt" IS NULL AND "emailedAt" IS NULL AND type = ANY(${types}::text[])
        RETURNING id`;
      if (claimed.length === 0) continue;
      const [user, rows] = await Promise.all([
        db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
        db.notification.findMany({ where: { id: { in: claimed.map((c) => c.id) } }, orderBy: { updatedAt: "desc" }, take: DIGEST_MAX_ITEMS }),
      ]);
      if (!user || user.email.endsWith(STEAM_PLACEHOLDER_DOMAIN)) continue;
      await mailer(digestMail({ to: user.email, name: user.name, ...ctx, items: await this.mailItems(rows) })).catch((error: unknown) => {
        console.error("[gcs] digestul nu a putut fi trimis", error);
      });
      sent++;
    }
    return sent;
  }

  /** Rulat la 15 minute: trimite digestul o dată pe zi, după ora `notifications.digest_hour` (în fusul site-ului). */
  async digestIfDue(now = new Date()): Promise<boolean> {
    const { settings, redis } = this.deps;
    const [hour, timeZone] = await Promise.all([settings.get<number>("notifications.digest_hour"), settings.get<string>("site.timezone")]);
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
    } catch {
      parts = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
    }
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    if (Number(get("hour")) < hour) return false;
    const claimed = await redis.set(`gcs:notifications:digest:${get("year")}-${get("month")}-${get("day")}`, "1", "EX", 2 * 86_400, "NX");
    if (claimed !== "OK") return false;
    await this.digest(now);
    return true;
  }
}
