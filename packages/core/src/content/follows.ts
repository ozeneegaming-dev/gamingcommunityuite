import type { PrismaClient } from "@gcs/db";
import { GcsForbidden } from "../errors";
import type { GcsActor } from "../permissions/types";

/**
 * Urmăririle (spec §5): un user urmărește un conținut (`topic`, `forum`, `downloads.file`…).
 * Verificarea că actorul vede conținutul o face apelantul; notificările vin în etapa 4.
 */
export class GcsFollowService {
  constructor(private readonly deps: { db: PrismaClient }) {}

  async follow(actor: GcsActor, contentType: string, contentId: string): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    await this.deps.db.follow.createMany({ data: [{ userId: actor.userId, contentType, contentId }], skipDuplicates: true });
  }

  async unfollow(actor: GcsActor, contentType: string, contentId: string): Promise<void> {
    if (!actor.userId) return;
    await this.deps.db.follow.deleteMany({ where: { userId: actor.userId, contentType, contentId } });
  }

  async isFollowing(userId: string | null, contentType: string, contentId: string): Promise<boolean> {
    if (!userId) return false;
    return (await this.deps.db.follow.count({ where: { userId, contentType, contentId } })) > 0;
  }

  count(contentType: string, contentId: string): Promise<number> {
    return this.deps.db.follow.count({ where: { contentType, contentId } });
  }

  async followers(contentType: string, contentId: string): Promise<string[]> {
    const rows = await this.deps.db.follow.findMany({ where: { contentType, contentId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }
}
