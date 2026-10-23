import type { GcsAchievementEventDef } from "@gcs/core";

const userOf = (e: { payload: Record<string, unknown> }) => (typeof e.payload.userId === "string" ? [{ userId: e.payload.userId, ref: "value" }] : []);

/** Un profil complet: avatar, descriere și ziua de naștere completate. */
export async function profileCompleted(db: Parameters<NonNullable<GcsAchievementEventDef["current"]>>[0]["db"], userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { image: true, bio: true, birthday: true } });
  return !!u && !!u.image && u.bio.trim() !== "" && u.birthday !== null;
}

/**
 * Evenimentele nucleului (Realizări v2): vechimea, profilul complet, contul Steam legat și ziua de naștere. Vechimea și
 * ziua de naștere vin din jobul zilnic; profilul și Steam la actualizarea profilului și la evaluarea membrului.
 */
export const coreAchievementEvents: GcsAchievementEventDef[] = [
  {
    key: "core.member_days",
    labelKey: "achievements.events.core.member_days",
    icon: "fa-solid fa-calendar-check",
    kind: "value",
    rankMetric: true,
    current: async ({ db }, userId) => {
      const u = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
      return u ? Math.floor((Date.now() - u.createdAt.getTime()) / 86_400_000) : 0;
    },
  },
  {
    key: "core.profile_completed",
    labelKey: "achievements.events.core.profile_completed",
    icon: "fa-solid fa-id-card",
    kind: "value",
    sources: [{ event: "profile.updated", map: userOf }],
    current: async ({ db }, userId) => ((await profileCompleted(db, userId)) ? 1 : 0),
  },
  {
    key: "core.steam_linked",
    labelKey: "achievements.events.core.steam_linked",
    icon: "fa-brands fa-steam",
    kind: "value",
    sources: [{ event: "profile.updated", map: userOf }, { event: "user.registered", map: userOf }],
    current: async ({ db }, userId) => ((await db.account.count({ where: { userId, providerId: "steam" } })) > 0 ? 1 : 0),
  },
  {
    key: "core.birthday",
    labelKey: "achievements.events.core.birthday",
    icon: "fa-solid fa-cake-candles",
    kind: "count",
  },
];
