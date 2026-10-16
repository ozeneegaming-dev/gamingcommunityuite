import type { GcsAchievementEventDef } from "@gcs/core";

/** Evenimentele Chat-ului (Realizări v2): mesajele trimise (fără cele ale boților). */
export const chatAchievementEvents: GcsAchievementEventDef[] = [
  {
    key: "chat.message",
    labelKey: "achievements.events.chat.message",
    icon: "fa-solid fa-comments",
    kind: "count",
    sources: [
      {
        event: "chat.message",
        map: (e) =>
          typeof e.payload.authorId === "string" && !e.payload.bot && typeof e.payload.messageId === "number" ? [{ userId: e.payload.authorId, ref: `chat:${e.payload.messageId}` }] : [],
      },
    ],
    current: ({ db }, userId) => db.chatMessage.count({ where: { authorId: userId } }),
  },
];
