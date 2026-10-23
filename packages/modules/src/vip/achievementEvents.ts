import type { GcsAchievementEventDef } from "@gcs/core";

/** Evenimentele VIP (Realizări v2): un abonament VIP primit (cumpărat, acordat sau reînnoit). */
export const vipAchievementEvents: GcsAchievementEventDef[] = [
  {
    key: "vip.subscribed",
    labelKey: "achievements.events.vip.subscribed",
    icon: "fa-solid fa-gem",
    kind: "count",
    sources: [
      {
        event: "vip.granted",
        map: (e) =>
          typeof e.payload.userId === "string" && typeof e.payload.subscriptionId === "number" ? [{ userId: e.payload.userId, ref: `vip:${e.payload.subscriptionId}` }] : [],
      },
    ],
    current: ({ db }, userId) => db.vipSubscription.count({ where: { userId } }),
  },
];
