import { GcsNotificationService, GcsRealtime, type GcsMail } from "@gcs/core";
import { GcsAchievementService } from "../src/profile/achievements";
import { GcsAchievementAdmin } from "../src/profile/achievementsAdmin";
import { GcsAchievementRules, systemActor } from "../src/profile/achievementRules";
import { GcsCosmeticsService } from "../src/profile/cosmetics";
import { GcsRankDirectory } from "../src/profile/display";
import { GcsProfileFieldAdmin } from "../src/profile/fieldsAdmin";
import { GcsMembership } from "../src/profile/membership";
import { GcsProfileService } from "../src/profile/profile";
import { GcsPromotionService } from "../src/profile/promotions";
import { GcsProfileQueries } from "../src/profile/queries";
import { GcsSocialService } from "../src/profile/social";
import { GcsVipService } from "../src/vip/vip";
import { GcsConversationService } from "../src/messages/conversations";
import { GcsConversationQueries } from "../src/messages/queries";
import { GcsNotificationProducers } from "../src/notifications/producers";
import { createForumWorld } from "./world";

/**
 * Un site de test cu modulele etapei 3 peste lumea forumului: aceleași servicii, plus un outbox
 * în care ajung emailurile (în loc de SMTP).
 */
export async function createProfileWorld() {
  const world = await createForumWorld();
  const outbox: GcsMail[] = [];
  const mailer = async (mail: GcsMail) => {
    outbox.push(mail);
  };
  const profiles = new GcsProfileService({
    db: world.db,
    bus: world.bus,
    permissions: world.permissions,
    settings: world.settings,
    attachments: world.attachments,
    rateLimiter: world.rateLimiter,
    mailer,
    baseUrl: async () => "https://forum.test",
  });
  const social = new GcsSocialService({
    db: world.db,
    bus: world.bus,
    cache: world.cache,
    permissions: world.permissions,
    settings: world.settings,
    rateLimiter: world.rateLimiter,
    profiles,
    render: (content, ctx) => world.posting.render(content, ctx),
    markGroupMentions: (actor, rendered) => world.posting.markGroupMentions(actor, rendered),
  });
  social.registerContent({ reactions: world.reactions, reports: world.reports });
  // Fără coadă: evaluarea (jobul din worker) se apelează direct în teste; punctele pe acțiune vin din ascultători.
  const achievements = new GcsAchievementService({ db: world.db, bus: world.bus, acp: world.acp, jobs: null });
  achievements.listen(world.bus);
  const membership = new GcsMembership({ bus: world.bus, permissions: world.permissions });
  const promotions = new GcsPromotionService({ db: world.db, bus: world.bus, acp: world.acp, membership });
  achievements.onEvaluated(async (userId) => void (await promotions.evaluateUser(userId)));
  const cosmetics = new GcsCosmeticsService({
    db: world.db,
    bus: world.bus,
    cache: world.cache,
    permissions: world.permissions,
    acp: world.acp,
    attachments: world.attachments,
    redis: world.redis,
  });
  cosmetics.listen(world.bus);
  const vip = new GcsVipService({ db: world.db, bus: world.bus, permissions: world.permissions, settings: world.settings, membership });
  // Realizări v2: aplicațiile oprite (`appsOff`), mesajele live publicate (`published`) și motorul regulilor.
  const appsOff = new Set<string>();
  const published: { room: string; event: string; data: unknown }[] = [];
  const liveRecorder = { publish: async (room: string, event: string, data: unknown) => void published.push({ room, event, data }) };
  const enabledFilter = async () => (key: string) => !appsOff.has(key);
  const achievementRules = new GcsAchievementRules({
    db: world.db,
    bus: world.bus,
    registry: world.registry,
    enabledFilter,
    setting: (key) => world.settings.get(key),
    membership,
    realtime: liveRecorder,
    jobs: null,
    schedule: async () => {},
    grantVip: async (userId, groupId, days) => void (await vip.grant(await systemActor(world.db), { userId, groupId, days, asPrimary: false })),
  });
  achievementRules.listen(world.bus);
  achievements.configureRanks({ registry: world.registry, enabledFilter, membership, realtime: liveRecorder });
  achievements.onEvaluated(async (userId) => void (await achievementRules.evaluateValues(userId)));
  const achievementAdmin = new GcsAchievementAdmin({ db: world.db, bus: world.bus, acp: world.acp, achievements, jobs: null, attachments: world.attachments, rules: achievementRules });
  const ranks = new GcsRankDirectory({ db: world.db, cache: world.cache });
  const profileQueries = new GcsProfileQueries({ db: world.db, cache: world.cache, permissions: world.permissions, profiles, social, ranks });
  const conversations = new GcsConversationService({
    db: world.db,
    bus: world.bus,
    cache: world.cache,
    permissions: world.permissions,
    settings: world.settings,
    rateLimiter: world.rateLimiter,
    attachments: world.attachments,
    profiles,
    social,
    render: (content, ctx) => world.posting.render(content, ctx),
    markGroupMentions: (actor, rendered) => world.posting.markGroupMentions(actor, rendered),
  });
  conversations.registerContent({ reports: world.reports });
  const conversationQueries = new GcsConversationQueries({ db: world.db, settings: world.settings, profileQueries });
  // Notificările (etapa 4): fără coadă, deci fan-out-ul și emailurile imediate rulează pe loc.
  const notifications = new GcsNotificationService({ db: world.db, bus: world.bus, cache: world.cache, registry: world.registry });
  const realtime = new GcsRealtime(world.redis);
  const producers = new GcsNotificationProducers({
    db: world.db,
    redis: world.redis,
    notifications,
    actors: world.actors,
    posting: world.posting,
    forumQueries: world.queries,
    conversations,
    settings: world.settings,
    mailer,
    realtime,
    jobs: null,
    baseUrl: async () => "https://forum.test",
    groupMentions: world.groupMentions,
  });
  producers.registerTargets();
  producers.listen(world.bus);
  const moderator = await world.actorFor(await world.createUser("NeoX", "moderator"));

  /** Șterge pauza de flood la mesaje private. */
  async function clearPmFlood(actor: { userId: string | null }) {
    await world.redis.del(`gcs:rl:pm:${actor.userId}`);
  }

  /** Șterge pauza de flood pe perete. */
  async function clearWallFlood(actor: { userId: string | null }) {
    await world.redis.del(`gcs:rl:wall-post:${actor.userId}`);
  }

  return { ...world, outbox, mailer, profiles, social, profileFields: new GcsProfileFieldAdmin({ db: world.db, bus: world.bus, acp: world.acp }), achievements, achievementAdmin, achievementRules, appsOff, published, membership, promotions, cosmetics, vip, ranks, profileQueries, conversations, conversationQueries, notifications, producers, realtime, moderator, clearWallFlood, clearPmFlood };
}

export type GcsProfileWorld = Awaited<ReturnType<typeof createProfileWorld>>;
