import type { GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsSettingDef, GcsSeedContext } from "@gcs/core";
import { chatWidgets } from "../widgets";
import { seedChatDemo } from "./seed";

export const CHAT_CONTAINER = "chat";
export const CHAT_ACP_CHANNELS = "community.chat_channels";
export const CHAT_ACP_SETTINGS = "community.chat_settings";

const ADMINS = { root_admin: true, admin: true } as const;
const STAFF = { ...ADMINS, super_moderator: true, moderator: true } as const;
const VIPS = { vip_bronze: true, vip_silver: true, vip_gold: true, vip_legend: true } as const;
/** Toate grupurile cu cont (fără Vizitator și Banat): vizitatorii nu văd chat-ul (decizie de produs, etapa 4). */
const MEMBERS = { ...STAFF, ...VIPS, member: true, new_member: true } as const;

function containerPermission(action: string, defaults: GcsPermissionDef["default"]): GcsPermissionDef {
  const key = `chat.${action}`;
  return { key, scope: "container", containerType: CHAT_CONTAINER, labelKey: `permissions.${key}`, default: defaults };
}

/** Permisiunile chat-ului (specul etapei 4 §7). Cele pe container dau și permisiunile unui canal nou. */
const permissions: GcsPermissionDef[] = [
  containerPermission("read", { ...MEMBERS }),
  containerPermission("write", { ...MEMBERS }),
  // Șterge mesaje, dă mute, schimbă slow mode-ul.
  { key: "chat.moderate", scope: "group", labelKey: "permissions.chat.moderate", default: { ...STAFF } },
  // Etapa 5: camerele create de membri (pe grup sau individual, din fișa membrului) și anunțurile.
  { key: "chat.create_public", scope: "group", labelKey: "permissions.chat.create_public", default: { ...ADMINS } },
  { key: "chat.create_private", scope: "group", labelKey: "permissions.chat.create_private", default: { ...STAFF, ...VIPS } },
  { key: "chat.announce", scope: "group", labelKey: "permissions.chat.announce", default: { ...STAFF } },
  // Secunde între două mesaje. Mai puțin e mai permisiv, deci câștigă minimul.
  {
    key: "chat.flood_seconds",
    scope: "group",
    labelKey: "permissions.chat.flood_seconds",
    merge: "min",
    default: {
      new_member: 10,
      member: 3,
      vip_bronze: 1,
      vip_silver: 1,
      vip_gold: 1,
      vip_legend: 1,
      moderator: 0,
      super_moderator: 0,
      admin: 0,
      root_admin: 0,
    },
  },
];

const int = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");
const chatSetting = (key: string, type: GcsSettingDef["type"], value: unknown, extra: Partial<GcsSettingDef> = {}): GcsSettingDef => ({
  key: `chat.${key}`,
  type,
  default: value,
  section: "chat",
  labelKey: `settings.chat.${key}`,
  ...extra,
});

/**
 * Setările chat-ului (ACP → Comunitate → Chat → Setări), după modelul Chatbox-ului din IPS: afișarea (ora, ordinea,
 * avatarele, înălțimea), limitele (mesaje, caractere, emoticoane) și conținutul permis (imagini, YouTube, GIPHY, voce).
 */
export const CHAT_DISPLAY_SETTINGS: GcsSettingDef[] = [
  chatSetting("time_format", "string", "24h", { options: ["24h", "12h"], validate: (v) => (v === "24h" || v === "12h" ? null : "invalid_choice") }),
  chatSetting("newest_on_top", "boolean", false),
  chatSetting("rules", "string", "", { multiline: true, validate: (v) => (typeof v === "string" && v.length <= 5000 ? null : "invalid_length") }),
  chatSetting("hide_avatars", "boolean", false),
  chatSetting("min_height", "number", 420, { validate: int(120, 1200) }),
  chatSetting("hide_enter_mobile", "boolean", false),
  chatSetting("messages_to_display", "number", 30, { validate: int(10, 100) }),
  chatSetting("poll_interval", "number", 30, { validate: int(5, 600) }),
  chatSetting("max_length", "number", 500, { validate: int(0, 2000) }),
  chatSetting("max_emoticons", "number", 5, { validate: int(0, 100) }),
  chatSetting("allow_images", "boolean", true),
  chatSetting("allow_youtube", "boolean", true),
  chatSetting("voice_enabled", "boolean", true),
  chatSetting("voice_max_seconds", "number", 60, { validate: int(5, 300) }),
  chatSetting("giphy_key", "secret", ""),
];

const settings: GcsSettingDef[] = [
  ...CHAT_DISPLAY_SETTINGS,
  {
    key: "chat.word_filter",
    type: "json",
    default: [],
    section: "chat",
    labelKey: "settings.chat.word_filter",
    validate: (v) =>
      Array.isArray(v) && v.length <= 500 && v.every((w) => typeof w === "string" && w.trim().length > 0 && w.length <= 50) ? null : "invalid_value",
  },
];

/** ACP → Comunitate → Chat. */
const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "community",
    title: "acp.menu.community.chat_group",
    items: [
      { key: CHAT_ACP_CHANNELS, labelKey: "acp.menu.community.chat_channels", href: "/admin/community/chat", section: CHAT_ACP_CHANNELS },
      { key: CHAT_ACP_SETTINGS, labelKey: "acp.menu.community.chat_settings", href: "/admin/community/chat/settings", section: CHAT_ACP_SETTINGS },
    ],
  },
];

/** Canalul „General” (shoutbox-ul paginii principale), cu permisiunile implicite. Idempotent. */
async function seedChat({ tx, groupIds }: GcsSeedContext): Promise<void> {
  const existing = await tx.chatChannel.findUnique({ where: { key: "general" } });
  if (existing) return;
  await tx.chatChannel.create({ data: { key: "general", name: "General", position: 0, retentionDays: 7, showOnHome: true } });
  await tx.containerPermission.createMany({ data: defaultChannelPermissions(groupIds, "general"), skipDuplicates: true });
}

/** Modulul Chat (specul etapei 4): canale cu permisiuni, mesaje live, mute, slow mode și retenție. */
export const chatModule: GcsModule = {
  key: "chat",
  app: { optional: true, labelKey: "apps.chat", icon: "fa-solid fa-comment-dots" },
  nav: [{ key: "chat", labelKey: "site.nav.chat", icon: "fa-solid fa-comment-dots", href: "/chat", position: 10 }],
  permissions,
  settings,
  acpMenu,
  eventListeners: [],
  notificationTypes: [{ key: "chat.mention", labelKey: "notifications.type.chat.mention", important: false, defaultEmail: "OFF" }],
  widgets: chatWidgets,
  seed: seedChat,
  seedDemo: seedChatDemo,
};

/** Permisiunile implicite ale unui canal nou (din `default` al permisiunilor pe container). */
export function defaultChannelPermissions(groupIds: ReadonlyMap<string, number>, key: string) {
  return permissions
    .filter((p) => p.scope === "container")
    .flatMap((p) =>
      Object.entries(p.default)
        .filter(([, v]) => v === true)
        .map(([group]) => groupIds.get(group))
        .filter((id): id is number => id !== undefined)
        .map((groupId) => ({ containerType: CHAT_CONTAINER, containerId: key, groupId, action: p.key })),
    );
}
