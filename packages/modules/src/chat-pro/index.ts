import type { GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsSeedContext, GcsSettingDef } from "@gcs/core";
import { CHAT_PRO_COMMANDS, type GcsChatProCommand } from "./prefs";

export const CHAT_PRO_APP = "chat_pro";
export const CHAT_PRO_ACP_SETTINGS = "community.chat_pro_settings";
export const CHAT_PRO_ACP_BAR = "community.chat_pro_bar";
export const CHAT_PRO_ACP_EMOTES = "community.chat_pro_emotes";
/** Badge-ul acordat câștigătorului unei perioade a clasamentului (prin sistemul de badge-uri). */
export const CHAT_PRO_WINNER_BADGE = "chat_pro_winner";

const ADMINS = { root_admin: true, admin: true } as const;
const STAFF = { ...ADMINS, super_moderator: true, moderator: true } as const;
const VIPS = { vip_bronze: true, vip_silver: true, vip_gold: true, vip_legend: true } as const;
const MEMBERS = { ...STAFF, ...VIPS, member: true, new_member: true } as const;

const permissions: GcsPermissionDef[] = [
  // Pagina `/chat/history` (doar mesajele camerelor pe care membrul le poate citi).
  { key: "chat_pro.history", scope: "group", labelKey: "permissions.chat_pro.history", default: { ...MEMBERS } },
];

const int = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");
const setting = (key: string, type: GcsSettingDef["type"], value: unknown, extra: Partial<GcsSettingDef> = {}): GcsSettingDef => ({
  key: `chat_pro.${key}`,
  type,
  default: value,
  section: "chat_pro",
  labelKey: `settings.chat_pro.${key}`,
  ...extra,
});

/** Adresele permise în bara de anunțuri și în mementoul de vot: o cale a site-ului sau `https://`. */
export function safeChatProUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  if (v === "") return true;
  if (v.length > 300) return false;
  if (/^\/(?!\/)[^\s]*$/.test(v)) return true;
  return URL.canParse(v) && new URL(v).protocol === "https:";
}

/**
 * Setările Chat Pro (ACP → Comunitate → Chat Pro): perioada clasamentului (lunară / săptămânală, ziua resetării),
 * pauza dintre mesajele numărate, comenzile active, furnizorul GIF și cheia lui, mementoul de vot, ritmul barei de
 * anunțuri și limitele emoticoanelor.
 */
export const CHAT_PRO_SETTINGS: GcsSettingDef[] = [
  setting("ranking_period", "string", "month", { options: ["month", "week"], validate: (v) => (v === "month" || v === "week" ? null : "invalid_choice") }),
  // Ziua resetării: 1–28 (lunar) sau 1–7 (săptămânal, 1 = luni).
  setting("ranking_reset_day", "number", 1, { validate: int(1, 28) }),
  // Secunde între două mesaje numărate în clasament (anti-spam, peste flood-ul chat-ului).
  setting("count_cooldown", "number", 5, { validate: int(0, 600) }),
  setting("commands", "json", [...CHAT_PRO_COMMANDS], {
    validate: (v) => (Array.isArray(v) && v.every((c) => CHAT_PRO_COMMANDS.includes(c as GcsChatProCommand)) && new Set(v).size === v.length ? null : "invalid_value"),
  }),
  setting("gif_provider", "string", "giphy", { options: ["giphy", "tenor"], validate: (v) => (v === "giphy" || v === "tenor" ? null : "invalid_choice") }),
  setting("gif_key", "secret", ""),
  setting("vote_enabled", "boolean", false),
  setting("vote_text", "string", "", { validate: (v) => (typeof v === "string" && v.length <= 200 ? null : "too_long") }),
  setting("vote_url", "string", "", { validate: (v) => (safeChatProUrl(v) ? null : "invalid_url") }),
  setting("vote_interval", "number", 120, { validate: int(5, 1440) }),
  setting("bar_seconds", "number", 8, { validate: int(3, 120) }),
  setting("emote_max_kb", "number", 256, { validate: int(16, 2048) }),
  setting("emote_max_side", "number", 256, { validate: int(32, 512) }),
];

/** ACP → Comunitate → Chat Pro: setările, bara de anunțuri și emoticoanele. */
const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "community",
    title: "acp.menu.community.chat_pro_group",
    icon: "fa-solid fa-wand-magic-sparkles",
    items: [
      { key: CHAT_PRO_ACP_SETTINGS, labelKey: "acp.menu.community.chat_pro_settings", href: "/admin/community/chat-pro", section: CHAT_PRO_ACP_SETTINGS, icon: "fa-solid fa-sliders" },
      { key: CHAT_PRO_ACP_BAR, labelKey: "acp.menu.community.chat_pro_bar", href: "/admin/community/chat-pro/bar", section: CHAT_PRO_ACP_BAR, icon: "fa-solid fa-bullhorn" },
      { key: CHAT_PRO_ACP_EMOTES, labelKey: "acp.menu.community.chat_pro_emotes", href: "/admin/community/chat-pro/emotes", section: CHAT_PRO_ACP_EMOTES, icon: "fa-solid fa-face-grin-stars" },
    ],
  },
];

/**
 * Seed-ul Chat Pro (idempotent): aplicația pornește **oprită** (pachetul standard păstrează chat-ul actual; o stare
 * aleasă în ACP rămâne), iar badge-ul câștigătorului clasamentului există în sistemul de badge-uri.
 */
async function seedChatPro({ tx }: GcsSeedContext): Promise<void> {
  await tx.app.upsert({ where: { key: CHAT_PRO_APP }, create: { key: CHAT_PRO_APP, enabled: false }, update: {} });
  const last = await tx.badge.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
  await tx.badge.createMany({
    data: [
      {
        key: CHAT_PRO_WINNER_BADGE,
        name: "Câștigătorul chat-ului",
        description: "Cele mai multe mesaje în chat într-o perioadă a clasamentului.",
        symbol: "#1",
        color: "#EA6C00",
        manual: true,
        points: 0,
        artShape: "rosette",
        artTier: "gold",
        artIcon: "fa-solid fa-comments",
        position: (last?.position ?? 0) + 1,
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * Chat Pro (specul 2026-10-10-chat-pro): aplicația premium peste Chat. Refolosește canalele și mesajele chat-ului
 * standard și își adaugă funcțiile prin punctele de extensie (`GcsChatExtensions`): aranjamente, setări pe membru,
 * bara de anunțuri, insigne, emoticoane, GIF-uri, comenzile botului, clasamentul și istoricul. Oprită, chat-ul
 * standard rămâne exact ca înainte.
 */
export const chatProModule: GcsModule = {
  key: CHAT_PRO_APP,
  app: {
    optional: true,
    labelKey: "apps.chat_pro",
    icon: "fa-solid fa-wand-magic-sparkles",
    descriptionKey: "apps.descriptions.chat_pro",
    routes: ["/chat/history", "/api/chat-pro"],
    requires: ["chat"],
    premium: true,
    sections: [{ key: "history", labelKey: "apps.sections.chat_pro_history", icon: "fa-solid fa-clock-rotate-left", href: "/chat/history", permission: "chat_pro.history" }],
  },
  permissions,
  settings: CHAT_PRO_SETTINGS,
  acpMenu,
  eventListeners: [],
  notificationTypes: [{ key: "chat_pro.reply", labelKey: "notifications.type.chat_pro.reply", important: false, defaultEmail: "OFF" }],
  seed: seedChatPro,
};
