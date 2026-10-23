import type { GcsAchievementEventDef } from "@gcs/core";

const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/**
 * Evenimentele aplicației Clanuri (Realizări v2): intrarea într-un clan (cerere acceptată), crearea unui clan (aprobat)
 * și victoria într-un clan war. Clan war-urile trimit evenimentul generic `achievements.occurrence` cu
 * `{ event: "clans.war_win", userId, ref }` pentru fiecare membru al clanului câștigător.
 */
export const clanAchievementEvents: GcsAchievementEventDef[] = [
  {
    key: "clans.join",
    labelKey: "achievements.events.clans.join",
    icon: "fa-solid fa-user-plus",
    kind: "count",
    sources: [
      {
        event: "clan.membership",
        map: (e) => {
          const clanId = num(e.payload.clanId);
          return e.payload.kind === "accepted" && typeof e.payload.userId === "string" && clanId !== null ? [{ userId: e.payload.userId, ref: `clan:${clanId}` }] : [];
        },
      },
    ],
    current: ({ db }, userId) => db.clanMember.count({ where: { userId } }),
  },
  {
    key: "clans.create",
    labelKey: "achievements.events.clans.create",
    icon: "fa-solid fa-shield-halved",
    kind: "count",
    sources: [
      {
        event: "clan.reviewed",
        map: (e) => {
          const clanId = num(e.payload.clanId);
          return e.payload.kind === "approved" && typeof e.payload.userId === "string" && clanId !== null ? [{ userId: e.payload.userId, ref: `clan:${clanId}` }] : [];
        },
      },
    ],
    current: ({ db }, userId) => db.clan.count({ where: { createdById: userId, status: "ACTIVE" } }),
  },
  { key: "clans.war_win", labelKey: "achievements.events.clans.war_win", icon: "fa-solid fa-trophy", kind: "count" },
];
