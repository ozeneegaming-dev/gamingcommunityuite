import type { GcsMemberDataHandler } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

/**
 * Chat Pro la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri): profilul de chat și statisticile
 * zilnice dispar odată cu membrul; perioadele câștigate rămân fără câștigător. La unire, statisticile se adună pe
 * zile, perioadele câștigate trec la țintă, iar profilul de chat al țintei rămâne (al sursei trece doar dacă ținta nu
 * are unul).
 */
export function chatProMemberData(deps: { db: PrismaClient }): GcsMemberDataHandler {
  const { db } = deps;
  return {
    key: "chat_pro",
    async summary(userId) {
      const [days, wins] = await Promise.all([db.chatProDailyStat.count({ where: { userId } }), db.chatProWinner.count({ where: { userId } })]);
      return [
        { key: "chat_pro.days", count: days },
        { key: "chat_pro.wins", count: wins },
      ];
    },
    async erase({ userId }) {
      return (
        (await db.chatProDailyStat.deleteMany({ where: { userId } })).count +
        (await db.chatProWinner.updateMany({ where: { userId }, data: { userId: null } })).count +
        (await db.chatProProfile.deleteMany({ where: { userId } })).count
      );
    },
    async merge({ sourceId, targetId }) {
      return db.$transaction(async (tx) => {
        let n = await tx.$executeRaw`
          INSERT INTO chat_pro_daily_stats ("userId", day, messages)
          SELECT ${targetId}, day, messages FROM chat_pro_daily_stats WHERE "userId" = ${sourceId}
          ON CONFLICT ("userId", day) DO UPDATE SET messages = chat_pro_daily_stats.messages + EXCLUDED.messages`;
        n += (await tx.chatProDailyStat.deleteMany({ where: { userId: sourceId } })).count;
        n += (await tx.chatProWinner.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        const [source, target] = await Promise.all([
          tx.chatProProfile.findUnique({ where: { userId: sourceId } }),
          tx.chatProProfile.findUnique({ where: { userId: targetId }, select: { userId: true } }),
        ]);
        if (source) {
          await tx.chatProProfile.delete({ where: { userId: sourceId } });
          if (!target) {
            const { userId: _source, updatedAt: _at, ...rest } = source;
            void _source;
            void _at;
            await tx.chatProProfile.create({ data: { ...rest, userId: targetId, prefs: rest.prefs ?? {}, gifFavorites: rest.gifFavorites ?? [] } });
          }
          n++;
        }
        return n;
      });
    },
  };
}
