import type { GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsSettingDef, GcsSeedContext } from "@gcs/core";

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

const settings: GcsSettingDef[] = [
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
      { key: CHAT_ACP_SETTINGS, labelKey: "acp.menu.community.chat_settings", href: "/admin/settings/chat", section: CHAT_ACP_SETTINGS },
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
  permissions,
  settings,
  acpMenu,
  eventListeners: [],
  seed: seedChat,
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
