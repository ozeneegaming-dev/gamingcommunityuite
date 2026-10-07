import { isSafeHref, type GcsAcpMenuSection, type GcsModule, type GcsPermissionDef, type GcsSettingDef } from "@gcs/core";
import { VIP_CONTACT_SETTING, VIP_INTRO_SETTING } from "./public";
import { vipStatTiles } from "./stats";

const permissions: GcsPermissionDef[] = [
  // Acordarea, prelungirea și retragerea VIP-ului (fișa membrului și ACP → VIP).
  { key: "vip.manage", scope: "group", labelKey: "permissions.vip.manage", default: { root_admin: true, admin: true } },
];

const settings: GcsSettingDef[] = [
  {
    key: "vip.warn_days",
    type: "number",
    default: 3,
    section: "vip",
    labelKey: "settings.vip.warn_days",
    validate: (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 30 ? null : "invalid_range"),
  },
  // Pagina publică `/vip`: linkul butonului „Contactează staff-ul” (gol = pagina staff-ului) și un text de introducere.
  {
    key: VIP_CONTACT_SETTING,
    type: "string",
    default: "",
    section: "vip",
    labelKey: "settings.vip.contact_url",
    validate: (v) => (v === "" || isSafeHref(v) ? null : "invalid_url"),
  },
  {
    key: VIP_INTRO_SETTING,
    type: "string",
    default: "",
    section: "vip",
    labelKey: "settings.vip.page_intro",
    multiline: true,
    validate: (v) => ((v as string).length > 1000 ? "too_long" : null),
  },
];

/** ACP → VIP & Magazin → VIP (spec §12.1). Magazinul vine în etapa 9. */
const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "vip",
    title: "acp.menu.vip.vip_group",
    icon: "fa-solid fa-crown",
    items: [
      ...[
        ["tiers", "/admin/vip/tiers", "fa-solid fa-layer-group"],
        ["subscribers", "/admin/vip/subscribers", "fa-solid fa-user-check"],
        ["history", "/admin/vip/history", "fa-solid fa-clock-rotate-left"],
        ["name_styles", "/admin/vip/name-styles", "fa-solid fa-signature"],
        ["frames", "/admin/vip/frames", "fa-solid fa-circle-user"],
      ].map(([key, href, icon]) => ({ key: `vip.${key}`, labelKey: `acp.menu.vip.${key}`, href: href!, section: `vip.${key}`, icon: icon! })),
      // Setările secțiunii `vip` (pagina publică `/vip`, avertizarea expirării), în pagina generică de setări.
      { key: "vip.page", labelKey: "acp.menu.vip.page", href: "/admin/settings/vip", section: "system.settings_vip", icon: "fa-solid fa-store" },
    ],
  },
];

/** Modulul VIP (specul etapei 3): niveluri, abonamente cu expirare, istoric. */
export const vipModule: GcsModule = {
  key: "vip",
  app: { optional: true, labelKey: "apps.vip", icon: "fa-solid fa-crown" },
  permissions,
  settings,
  acpMenu,
  notificationTypes: [
    { key: "vip.expiring", labelKey: "notifications.type.vip.expiring", important: true, defaultEmail: "INSTANT" },
    { key: "vip.granted", labelKey: "notifications.type.vip.granted", important: false, defaultEmail: "DIGEST" },
    { key: "vip.expired", labelKey: "notifications.type.vip.expired", important: false, defaultEmail: "DIGEST" },
  ],
  eventListeners: [],
  stats: vipStatTiles,
  // Pagina publică a planurilor (`/vip`); dispare din meniu odată cu aplicația. Nu exista în meniul anterior.
  nav: [{ key: "vip", labelKey: "site.nav.vip", icon: "fa-solid fa-crown", href: "/vip", position: 50 }],
  navPrevious: [],
};
