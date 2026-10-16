import type { GcsAchievementEventDef } from "@gcs/core";

/**
 * Evenimentele Chat Pro (Realizări v2): câștigătorul clasamentului pe perioadă (insigna de perioadă acordată prin
 * `grantPeriodWinner`, care trimite `achievements.period_winner` cu `source: "chat_pro"`).
 */
export const chatProAchievementEvents: GcsAchievementEventDef[] = [
  {
    key: "chat_pro.ranking_winner",
    labelKey: "achievements.events.chat_pro.ranking_winner",
    icon: "fa-solid fa-crown",
    kind: "count",
    sources: [
      {
        event: "achievements.period_winner",
        map: (e) =>
          e.payload.source === "chat_pro" && typeof e.payload.userId === "string" ? [{ userId: e.payload.userId, ref: `period:${String(e.payload.period)}` }] : [],
      },
    ],
  },
];
