/**
 * Setările chat-ului pe tab-urile din ACP → Chat → Setări (după chatbox-ul de referință). Fiecare tab are formularul lui, deci
 * salvarea unui tab nu atinge setările celuilalt (comutatoarele lipsă din formular ar însemna „oprit”).
 */
export const CHAT_SETTINGS_TABS = {
  general: ["chat.time_format", "chat.newest_on_top", "chat.show_rules", "chat.rules", "chat.hide_avatars", "chat.min_height", "chat.hide_enter_mobile"],
  advanced: [
    "chat.messages_to_display",
    "chat.poll_interval",
    "chat.flood_seconds",
    "chat.max_length",
    "chat.max_emoticons",
    "chat.allow_images",
    "chat.allow_youtube",
    "chat.voice_enabled",
    "chat.voice_max_seconds",
    "chat.giphy_key",
  ],
} as const;

export type GcsChatSettingsTab = keyof typeof CHAT_SETTINGS_TABS;

/** Intervalul de actualizare se scrie în ACP în milisecunde, dar se păstrează în secunde (`chat.poll_interval`). */
export const POLL_FIELD = "ms:chat.poll_interval";
