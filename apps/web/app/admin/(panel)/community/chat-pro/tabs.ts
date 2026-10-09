/**
 * Setările Chat Pro pe tab-urile din ACP → Comunitate → Chat Pro: fiecare tab are formularul lui, deci salvarea unui
 * tab nu atinge setările celorlalte (comutatoarele lipsă din formular ar însemna „oprit”).
 */
export const CHAT_PRO_TABS = {
  general: ["chat_pro.ranking_period", "chat_pro.ranking_reset_day", "chat_pro.count_cooldown", "chat_pro.commands", "chat_pro.bar_seconds"],
  gifs: ["chat_pro.gif_provider", "chat_pro.gif_key"],
  vote: ["chat_pro.vote_enabled", "chat_pro.vote_text", "chat_pro.vote_url", "chat_pro.vote_interval"],
  emotes: ["chat_pro.emote_max_kb", "chat_pro.emote_max_side"],
} as const;

export type GcsChatProTab = keyof typeof CHAT_PRO_TABS;
