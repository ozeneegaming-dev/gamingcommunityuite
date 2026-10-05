import type { GcsMail } from "@gcs/core";
import { GcsProfileService } from "../src/profile/profile";
import { GcsSocialService } from "../src/profile/social";
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
  const moderator = await world.actorFor(await world.createUser("NeoX", "moderator"));

  /** Șterge pauza de flood pe perete. */
  async function clearWallFlood(actor: { userId: string | null }) {
    await world.redis.del(`gcs:rl:wall-post:${actor.userId}`);
  }

  return { ...world, outbox, mailer, profiles, social, moderator, clearWallFlood };
}

export type GcsProfileWorld = Awaited<ReturnType<typeof createProfileWorld>>;
