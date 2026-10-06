import type { GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsSettingDef } from "@gcs/core";
import { forumWidgets } from "../widgets";
import { forumStatTiles } from "./stats";
import { seedForumDemo, seedForums } from "./seed";

const ADMINS = { root_admin: true, admin: true } as const;
const GLOBAL_MODS = { ...ADMINS, super_moderator: true } as const;
const STAFF = { ...GLOBAL_MODS, moderator: true } as const;
const VIPS = { vip_bronze: true, vip_silver: true, vip_gold: true, vip_legend: true } as const;
/** Toate grupurile cu cont (fără Vizitator și Banat). */
const MEMBERS = { ...STAFF, ...VIPS, member: true, new_member: true } as const;
const EVERYONE = { ...MEMBERS, guest: true } as const;

/** O valoare numerică pentru fiecare categorie de grupuri. */
function perTier(values: { newMember: number; member: number; vip: number; staff: number }) {
  return {
    new_member: values.newMember,
    member: values.member,
    vip_bronze: values.vip,
    vip_silver: values.vip,
    vip_gold: values.vip,
    vip_legend: values.vip,
    moderator: values.staff,
    super_moderator: values.staff,
    admin: values.staff,
    root_admin: values.staff,
  };
}

function containerPermission(action: string, defaults: GcsPermissionDef["default"]): GcsPermissionDef {
  const key = `forums.${action}`;
  return { key, scope: "container", containerType: "forum", labelKey: `permissions.${key}`, default: defaults };
}

function groupPermission(key: string, defaults: GcsPermissionDef["default"], merge?: "max" | "min"): GcsPermissionDef {
  const def: GcsPermissionDef = { key, scope: "group", labelKey: `permissions.${key}`, default: defaults };
  if (merge) def.merge = merge;
  return def;
}

/**
 * Permisiunile forumului (specul etapei 2, §6).
 * Cele pe container dau și permisiunile unui forum nou creat la rădăcină; un subforum moștenește părintele.
 */
const permissions: GcsPermissionDef[] = [
  containerPermission("view", { ...EVERYONE }),
  containerPermission("read", { ...EVERYONE }),
  containerPermission("create", { ...MEMBERS }),
  containerPermission("reply", { ...MEMBERS }),
  containerPermission("upload", { ...MEMBERS }),
  containerPermission("download", { ...EVERYONE }),
  // Minute în care autorul își poate edita postarea; -1 = oricând.
  groupPermission("forums.edit_own_minutes", perTier({ newMember: 60, member: 60, vip: 60, staff: -1 })),
  groupPermission("forums.hide_own", { ...MEMBERS }),
  // Câte postări ale unui cont nou trec prin aprobare. Mai puțin e mai permisiv, deci câștigă minimul.
  groupPermission("forums.approval_first_posts", perTier({ newMember: 2, member: 0, vip: 0, staff: 0 }), "min"),
  // Secunde între două postări.
  groupPermission("forums.flood_seconds", perTier({ newMember: 30, member: 10, vip: 5, staff: 0 }), "min"),
  // Moderator pe toate forumurile, cu toate puterile.
  groupPermission("forums.moderate_all", { ...GLOBAL_MODS }),
  // Și membrii noi: sondajul trece prin coada de aprobare odată cu topicul (specul etapei 2, §1).
  groupPermission("forums.poll_create", { ...MEMBERS }),
  groupPermission("forums.tags_max", perTier({ newMember: 5, member: 5, vip: 5, staff: 10 })),
];

const EMBED_PROVIDERS = ["youtube", "twitch", "medal", "image"];

function postingSetting(key: string, type: GcsSettingDef["type"], defaultValue: unknown, validate?: GcsSettingDef["validate"]): GcsSettingDef {
  const def: GcsSettingDef = { key, type, default: defaultValue, section: "posting", labelKey: `settings.${key}` };
  if (validate) def.validate = validate;
  return def;
}

const between = (min: number, max: number) => (v: unknown) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range";

const settings: GcsSettingDef[] = [
  postingSetting("forums.posts_per_page", "number", 20, between(5, 100)),
  postingSetting("forums.topics_per_page", "number", 25, between(5, 100)),
  postingSetting("forums.post_max_chars", "number", 20_000, between(100, 200_000)),
  postingSetting("forums.embeds", "json", EMBED_PROVIDERS, (v) =>
    Array.isArray(v) && v.every((p) => EMBED_PROVIDERS.includes(p as string)) ? null : "invalid_choice",
  ),
  postingSetting("forums.revisions_visible_to_author", "boolean", true),
];

const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "community",
    title: "acp.menu.community.forums_group",
    items: [
      ["forums", "/admin/community/forums"],
      ["prefixes", "/admin/community/prefixes"],
      ["saved_actions", "/admin/community/saved-actions"],
      ["forum_settings", "/admin/settings/posting"],
    ].map(([key, href]) => ({ key: `community.${key}`, labelKey: `acp.menu.community.${key}`, href: href!, section: `community.${key}` })),
  },
];

/** Modulul Forum (specul etapei 2). */
export const forumsModule: GcsModule = {
  key: "forums",
  permissions,
  settings,
  acpMenu,
  notificationTypes: [
    { key: "forums.mention", labelKey: "notifications.type.forums.mention", important: false, defaultEmail: "DIGEST" },
    { key: "forums.quote", labelKey: "notifications.type.forums.quote", important: false, defaultEmail: "DIGEST" },
    { key: "forums.reply", labelKey: "notifications.type.forums.reply", important: false, defaultEmail: "DIGEST", countEach: true },
    { key: "forums.topic", labelKey: "notifications.type.forums.topic", important: false, defaultEmail: "DIGEST" },
    { key: "forums.reaction", labelKey: "notifications.type.forums.reaction", important: false, defaultEmail: "OFF" },
    { key: "forums.solution", labelKey: "notifications.type.forums.solution", important: false, defaultEmail: "DIGEST" },
  ],
  eventListeners: [],
  nav: [
    { key: "forum", labelKey: "site.nav.forum", icon: "fa-solid fa-comments", href: "/", position: 0 },
    { key: "members", labelKey: "site.nav.members", icon: "fa-solid fa-users", href: "/members", position: 20 },
    { key: "staff", labelKey: "site.nav.staff", icon: "fa-solid fa-shield-halved", href: "/staff", position: 30 },
  ],
  widgets: forumWidgets,
  stats: forumStatTiles,
  // Pagina principală implicită (specul etapei 5): anunțul sus, shoutbox-ul și topicurile recente în dreapta,
  // panoul de statistici (cu „Cine e online”) jos.
  // Tipurile aplicațiilor lipsă (ex. fără Chat) se sar la seed.
  widgetLayout: {
    index: [
      { zone: "top", type: "core.announcement" },
      { zone: "sidebar", type: "chat.shoutbox" },
      { zone: "sidebar", type: "forums.recentTopics" },
      { zone: "bottom", type: "core.statsPanel" },
    ],
  },
  seed: seedForums,
  seedDemo: seedForumDemo,
};
