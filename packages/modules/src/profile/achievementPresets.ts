/**
 * Formatul de export / import al regulilor (Realizări v2) și pachetul gata făcut „Pachet Gaming”. Referințele sunt
 * portabile: badge-urile, grupurile și stilurile de nume după cheie (un badge lipsă din pachet se creează la import),
 * forumurile și serverele după id (rămân doar cele care există pe site).
 */

export const RULES_EXPORT_KIND = "gcs.achievement-rules";
export const RANKS_EXPORT_KIND = "gcs.ranks";

export type GcsPortableReward = {
  points?: number;
  badge?: string | null;
  group?: string | null;
  groupDays?: number | null;
  vipGroup?: string | null;
  vipDays?: number | null;
  nameStyle?: string | null;
};

export type GcsPortableRule = {
  name: string;
  event: string;
  enabled?: boolean;
  conditions?: { mode?: string; n?: number; forumIds?: number[]; serverIds?: number[]; groups?: string[]; windowDays?: number | null };
  rewards: { actor: GcsPortableReward; other?: GcsPortableReward | null };
};

export type GcsPortableBadge = { key: string; name: string; description?: string; color: string; artShape?: string | null; artTier?: string | null; artIcon?: string | null; points?: number };

export type GcsRulesPack = { kind: typeof RULES_EXPORT_KIND; version: 1; badges?: GcsPortableBadge[]; rules: GcsPortableRule[] };

const badge = (key: string, name: string, description: string, color: string, artIcon: string, artTier: string, artShape = "medal"): GcsPortableBadge => ({ key, name, description, color, artIcon, artTier, artShape, points: 0 });

/** „Pachet Gaming”: reguli pentru forum, chat, servere și clanuri (evenimentele aplicațiilor oprite se sar la import). */
export const GAMING_PACK: GcsRulesPack = {
  kind: RULES_EXPORT_KIND,
  version: 1,
  badges: [
    badge("gp_first_blood", "Primul sânge", "Primele 100 de ucideri pe servere", "#E5484D", "fa-solid fa-crosshairs", "bronze"),
    badge("gp_headhunter", "Vânător de capete", "500 de headshot-uri", "#E5484D", "fa-solid fa-skull", "silver"),
    badge("gp_marathon", "Maratonist", "100 de ore jucate", "#3DDC97", "fa-solid fa-hourglass-half", "gold"),
    badge("gp_elo_2000", "Elita ELO", "ELO 2000 în mix", "#FFB224", "fa-solid fa-chart-line", "platinum", "star"),
    badge("gp_mix_10", "Câștigător de mix-uri", "10 victorii în mix", "#4FA3FF", "fa-solid fa-flag-checkered", "silver"),
    badge("gp_chatter", "Vorbăreț", "500 de mesaje în chat", "#8E7CFF", "fa-solid fa-comments", "bronze", "hexagon"),
    badge("gp_popular", "Popular", "100 de reacții primite", "#FF6BA8", "fa-solid fa-heart", "gold", "rosette"),
    badge("gp_clan", "Spirit de echipă", "A intrat într-un clan", "#3DDC97", "fa-solid fa-users", "bronze", "shield"),
    badge("gp_founder", "Fondator de clan", "A creat un clan aprobat", "#FFB224", "fa-solid fa-shield-halved", "gold", "shield"),
    badge("gp_veteran", "Veteran", "Un an în comunitate", "#A1A7B4", "fa-solid fa-calendar-check", "silver"),
  ],
  rules: [
    { name: "100 de ucideri", event: "servers.kills", conditions: { mode: "reach", n: 100 }, rewards: { actor: { points: 25, badge: "gp_first_blood" } } },
    { name: "500 de headshot-uri", event: "servers.headshots", conditions: { mode: "reach", n: 500 }, rewards: { actor: { points: 50, badge: "gp_headhunter" } } },
    { name: "100 de ore jucate", event: "servers.hours", conditions: { mode: "reach", n: 100 }, rewards: { actor: { points: 100, badge: "gp_marathon" } } },
    { name: "ELO 2000", event: "servers.elo", conditions: { mode: "reach", n: 2000 }, rewards: { actor: { points: 150, badge: "gp_elo_2000" } } },
    { name: "10 victorii în mix", event: "servers.mix_wins", conditions: { mode: "reach", n: 10 }, rewards: { actor: { points: 40, badge: "gp_mix_10" } } },
    { name: "Prima conectare pe server", event: "servers.first_connect", conditions: { mode: "reach", n: 1 }, rewards: { actor: { points: 10 } } },
    { name: "500 de mesaje în chat", event: "chat.message", conditions: { mode: "nth", n: 500 }, rewards: { actor: { points: 30, badge: "gp_chatter" } } },
    { name: "Câștigătorul clasamentului de chat", event: "chat_pro.ranking_winner", conditions: { mode: "every", n: 1 }, rewards: { actor: { points: 20 } } },
    {
      name: "100 de reacții primite",
      event: "forums.reaction_received",
      conditions: { mode: "nth", n: 100 },
      rewards: { actor: { points: 50, badge: "gp_popular" }, other: { points: 1 } },
    },
    { name: "Intră într-un clan", event: "clans.join", conditions: { mode: "nth", n: 1 }, rewards: { actor: { points: 15, badge: "gp_clan" } } },
    { name: "Creează un clan", event: "clans.create", conditions: { mode: "nth", n: 1 }, rewards: { actor: { points: 50, badge: "gp_founder" } } },
    { name: "Câștigă un clan war", event: "clans.war_win", conditions: { mode: "every", n: 1 }, rewards: { actor: { points: 25 } } },
    { name: "Un an de comunitate", event: "core.member_days", conditions: { mode: "reach", n: 365 }, rewards: { actor: { points: 100, badge: "gp_veteran" } } },
    { name: "Steam legat", event: "core.steam_linked", conditions: { mode: "reach", n: 1 }, rewards: { actor: { points: 10 } } },
  ],
};
