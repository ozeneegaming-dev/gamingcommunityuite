import type { GcsMail } from "@gcs/core";
import { GcsAchievementService } from "../src/profile/achievements";
import { GcsAchievementAdmin } from "../src/profile/achievementsAdmin";
import { GcsCosmeticsService } from "../src/profile/cosmetics";
import { GcsRankDirectory } from "../src/profile/display";
import { GcsMembership } from "../src/profile/membership";
import { GcsProfileService } from "../src/profile/profile";
import { GcsPromotionService } from "../src/profile/promotions";
import { GcsProfileQueries } from "../src/profile/queries";
import { GcsSocialService } from "../src/profile/social";
import { GcsVipService } from "../src/vip/vip";
import { GcsConversationService } from "../src/messages/conversations";
import { GcsConversationQueries } from "../src/messages/queries";
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
    render: (content) => world.posting.render(content),
  });
  social.registerContent({ reactions: world.reactions, reports: world.reports });
  // Fără coadă: evaluarea (jobul din worker) se apelează direct în teste; punctele pe acțiune vin din ascultători.
  const achievements = new GcsAchievementService({ db: world.db, bus: world.bus, acp: world.acp, jobs: null });
  achievements.listen(world.bus);
  const achievementAdmin = new GcsAchievementAdmin({ db: world.db, bus: world.bus, acp: world.acp, achievements, jobs: null });
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
  const vip = new GcsVipService({ db: world.db, bus: world.bus, permissions: world.permissions, settings: world.settings, membership, mailer });
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
    render: (content) => world.posting.render(content),
  });
  conversations.registerContent({ reports: world.reports });
  const conversationQueries = new GcsConversationQueries({ db: world.db, settings: world.settings, profileQueries });
  const moderator = await world.actorFor(await world.createUser("NeoX", "moderator"));

  /** Șterge pauza de flood la mesaje private. */
  async function clearPmFlood(actor: { userId: string | null }) {
    await world.redis.del(`gcs:rl:pm:${actor.userId}`);
  }

  /** Șterge pauza de flood pe perete. */
  async function clearWallFlood(actor: { userId: string | null }) {
    await world.redis.del(`gcs:rl:wall-post:${actor.userId}`);
  }

  return { ...world, outbox, mailer, profiles, social, achievements, achievementAdmin, membership, promotions, cosmetics, vip, ranks, profileQueries, conversations, conversationQueries, moderator, clearWallFlood, clearPmFlood };
}

export type GcsProfileWorld = Awaited<ReturnType<typeof createProfileWorld>>;
