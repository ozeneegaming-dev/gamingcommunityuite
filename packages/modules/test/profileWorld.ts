import type { GcsMail } from "@gcs/core";
import { GcsProfileService } from "../src/profile/profile";
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
  const moderator = await world.actorFor(await world.createUser("NeoX", "moderator"));

  return { ...world, outbox, mailer, profiles, moderator };
}

export type GcsProfileWorld = Awaited<ReturnType<typeof createProfileWorld>>;
