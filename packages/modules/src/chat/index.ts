import { GCS_RICH_FIELDS, richFieldError, type GcsAcpMenuSection, type GcsModule, type GcsPermissionDef, type GcsSettingDef, type GcsSeedContext } from "@gcs/core";
import { chatWidgets } from "../widgets";
import { seedChatDemo } from "./seed";

export const CHAT_CONTAINER = "chat";
export const CHAT_ACP_CHANNELS = "community.chat_channels";
export const CHAT_ACP_SETTINGS = "community.chat_settings";
/** ACP → Chat → Moderare (motivele, jurnalul, sancțiunile active) și Moderatori (accesul de moderator în chat). */
export const CHAT_ACP_MODERATION = "community.chat_moderation";
export const CHAT_ACP_MODERATORS = "community.chat_moderators";

const ADMINS = { root_admin: true, admin: true } as const;
const STAFF = { ...ADMINS, super_moderator: true, moderator: true } as const;
const SENIOR = { ...ADMINS, super_moderator: true } as const;
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
  // Moderarea granulară (staff și accesul de moderator în chat). Root Admin le are pe toate; moderatorii, cele obișnuite.
  { key: "chat.edit_any", scope: "group", labelKey: "permissions.chat.edit_any", default: { ...SENIOR } },
  { key: "chat.pin", scope: "group", labelKey: "permissions.chat.pin", default: { ...STAFF } },
  { key: "chat.hide", scope: "group", labelKey: "permissions.chat.hide", default: { ...STAFF } },
  { key: "chat.delete_any", scope: "group", labelKey: "permissions.chat.delete_any", default: { ...STAFF } },
  { key: "chat.purge_user", scope: "group", labelKey: "permissions.chat.purge_user", default: { ...SENIOR } },
  { key: "chat.warn", scope: "group", labelKey: "permissions.chat.warn", default: { ...STAFF } },
  { key: "chat.mute", scope: "group", labelKey: "permissions.chat.mute", default: { ...STAFF } },
  { key: "chat.kick", scope: "group", labelKey: "permissions.chat.kick", default: { ...STAFF } },
  { key: "chat.ban", scope: "group", labelKey: "permissions.chat.ban", default: { ...SENIOR } },
  { key: "chat.slow_user", scope: "group", labelKey: "permissions.chat.slow_user", default: { ...STAFF } },
  // Dă acces de moderator în chat (ACP → Chat → Moderatori și `/acces`).
  { key: "chat.grant_access", scope: "group", labelKey: "permissions.chat.grant_access", default: { ...ADMINS } },
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
 * Setările chat-ului (ACP → Comunitate → Chat → Setări), după chatbox-ul de referință: afișarea (ora, ordinea,
 * regulile, avatarele, înălțimea), limitele (mesaje, flood, caractere, emoticoane) și conținutul permis (imagini,
 * YouTube, GIPHY, voce).
 */
export const CHAT_DISPLAY_SETTINGS: GcsSettingDef[] = [
  chatSetting("time_format", "string", "24h", { options: ["24h", "12h"], validate: (v) => (v === "24h" || v === "12h" ? null : "invalid_choice") }),
  chatSetting("newest_on_top", "boolean", false),
  // Linkul „Reguli” din antetul chat-ului (apare doar dacă textul regulilor nu e gol).
  chatSetting("show_rules", "boolean", true),
  // Regulile: documentul editorului (profilul `chatRules`); un text vechi rămâne valabil (devine paragrafe la citire).
  chatSetting("rules", "json", "", { validate: (v) => richFieldError(v, GCS_RICH_FIELDS.chatRules) }),
  chatSetting("hide_avatars", "boolean", false),
  chatSetting("min_height", "number", 420, { validate: int(120, 1200) }),
  chatSetting("hide_enter_mobile", "boolean", false),
  chatSetting("messages_to_display", "number", 30, { validate: int(10, 100) }),
  chatSetting("poll_interval", "number", 30, { validate: int(5, 600) }),
  // Flood control global (secunde, 0 = niciunul): se aplică valoarea mai strictă dintre el și `chat.flood_seconds` al grupului.
  chatSetting("flood_seconds", "number", 0, { validate: int(0, 3600) }),
  chatSetting("max_length", "number", 500, { validate: int(0, 2000) }),
  chatSetting("max_emoticons", "number", 5, { validate: int(0, 100) }),
  chatSetting("allow_images", "boolean", true),
  chatSetting("allow_youtube", "boolean", true),
  chatSetting("voice_enabled", "boolean", true),
  chatSetting("voice_max_seconds", "number", 60, { validate: int(5, 300) }),
  chatSetting("giphy_key", "secret", ""),
];

/** Motivele gata scrise din dialogurile de moderare (editabile în ACP → Chat → Moderare). */
export const CHAT_MOD_REASONS_DEFAULT = ["Spam", "Flood", "Limbaj vulgar", "Jigniri", "Reclamă"];

/** Setările moderării chat-ului (ACP → Chat → Moderare). */
export const CHAT_MODERATION_SETTINGS: GcsSettingDef[] = [
  chatSetting("mod_reasons", "json", CHAT_MOD_REASONS_DEFAULT, {
    validate: (v) => (Array.isArray(v) && v.length <= 30 && v.every((r) => typeof r === "string" && r.trim().length > 0 && r.length <= 80) ? null : "invalid_value"),
  }),
  // Linia de sistem publică la un acces de moderator dat („X a primit acces de moderator în chat de la Y”).
  chatSetting("announce_grants", "boolean", true),
];

const settings: GcsSettingDef[] = [
  ...CHAT_DISPLAY_SETTINGS,
  ...CHAT_MODERATION_SETTINGS,
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
    icon: "fa-solid fa-comment-dots",
    items: [
      {
        key: CHAT_ACP_CHANNELS,
        labelKey: "acp.menu.community.chat_channels",
        href: "/admin/community/chat",
        section: CHAT_ACP_CHANNELS,
        icon: "fa-solid fa-hashtag",
      },
      {
        key: CHAT_ACP_SETTINGS,
        labelKey: "acp.menu.community.chat_settings",
        href: "/admin/community/chat/settings",
        section: CHAT_ACP_SETTINGS,
        icon: "fa-solid fa-gear",
      },
      {
        key: CHAT_ACP_MODERATION,
        labelKey: "acp.menu.community.chat_moderation",
        href: "/admin/community/chat/moderation",
        section: CHAT_ACP_MODERATION,
        icon: "fa-solid fa-shield-halved",
      },
      {
        key: CHAT_ACP_MODERATORS,
        labelKey: "acp.menu.community.chat_moderators",
        href: "/admin/community/chat/moderators",
        section: CHAT_ACP_MODERATORS,
        icon: "fa-solid fa-user-shield",
      },
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
  app: {
    optional: true,
    labelKey: "apps.chat",
    icon: "fa-solid fa-comment-dots",
    descriptionKey: "apps.descriptions.chat",
    routes: ["/chat", "/api/chat"],
    sections: [
      { key: "chat", labelKey: "site.nav.chat", icon: "fa-solid fa-comment-dots", href: "/chat" },
      { key: "private", labelKey: "apps.sections.chat_private", icon: "fa-solid fa-lock", href: "/chat", permission: "chat.create_private" },
    ],
  },
  nav: [{ key: "chat", labelKey: "site.nav.chat", icon: "fa-solid fa-comment-dots", href: "/chat", position: 10 }],
  permissions,
  settings,
  acpMenu,
  eventListeners: [],
  notificationTypes: [
    { key: "chat.mention", labelKey: "notifications.type.chat.mention", important: false, defaultEmail: "OFF" },
    // Moderarea: mute / kick / ban / slow mode primite și accesul de moderator în chat (dat, retras, expirat).
    { key: "chat.sanction", labelKey: "notifications.type.chat.sanction", important: true, defaultEmail: "OFF" },
    { key: "chat.access", labelKey: "notifications.type.chat.access", important: false, defaultEmail: "OFF" },
  ],
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
