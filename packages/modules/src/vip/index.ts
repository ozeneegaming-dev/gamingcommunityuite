import { isSafeHref, type GcsAcpMenuSection, type GcsModule, type GcsPermissionDef, type GcsSettingDef } from "@gcs/core";
import { donationWidgets } from "../widgets";
import {
  DONATION_CURRENCY_SETTING,
  DONATION_INSTRUCTIONS_SETTING,
  DONATION_MEMBER_SUBMIT_SETTING,
  DONATION_METHODS_SETTING,
  DONATION_URL_SETTING,
  DONATIONS_SETTINGS_SECTION,
  SPONSOR_PERIOD_SETTING,
} from "./donations";
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
  // Donațiile (ACP › VIP & Magazin › Donații › Setări): linkul extern de plată (pagina comunității; gol = doar
  // instrucțiunile din `/donatii`), instrucțiunile, moneda principală, metodele propuse, cererile „Am donat” și perioada
  // insignei „Sponsor” (pragul ei, `profile.sponsor_min_amount`, e afișat tot aici).
  { key: DONATION_URL_SETTING, type: "string", default: "", section: DONATIONS_SETTINGS_SECTION, labelKey: "settings.donations.external_url", validate: (v) => (v === "" || isSafeHref(v) ? null : "invalid_url") },
  {
    key: DONATION_INSTRUCTIONS_SETTING,
    type: "string",
    default: "",
    section: DONATIONS_SETTINGS_SECTION,
    labelKey: "settings.donations.instructions",
    multiline: true,
    validate: (v) => ((v as string).length > 2000 ? "too_long" : null),
  },
  { key: DONATION_CURRENCY_SETTING, type: "string", default: "EUR", section: DONATIONS_SETTINGS_SECTION, labelKey: "settings.donations.currency", validate: (v) => (/^[A-Z]{3}$/.test(v as string) ? null : "invalid") },
  {
    key: DONATION_METHODS_SETTING,
    type: "string",
    default: "PayPal, Revolut, Transfer bancar",
    section: DONATIONS_SETTINGS_SECTION,
    labelKey: "settings.donations.methods",
    validate: (v) => ((v as string).length > 400 ? "too_long" : null),
  },
  { key: DONATION_MEMBER_SUBMIT_SETTING, type: "boolean", default: true, section: DONATIONS_SETTINGS_SECTION, labelKey: "settings.donations.member_submit" },
  {
    key: SPONSOR_PERIOD_SETTING,
    type: "string",
    default: "all",
    section: DONATIONS_SETTINGS_SECTION,
    labelKey: "settings.donations.sponsor_period",
    options: ["all", "year", "month"],
    validate: (v) => (v === "all" || v === "year" || v === "month" ? null : "invalid_choice"),
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
      // Raportul VIP din zona Statistici („în curând”).
      { key: "stats.vip", labelKey: "acp.menu.stats.vip", href: "/admin/stats/vip", section: "stats.vip", icon: "fa-solid fa-crown", area: "stats", group: "acp.menu.stats.apps" },
    ],
  },
  // Donațiile și „Obiectivul lunii”: lista (filtre, CSV, confirmarea cererilor), obiectivele și setările.
  {
    app: "vip",
    title: "acp.menu.vip.donations_group",
    icon: "fa-solid fa-hand-holding-heart",
    items: [
      { key: "vip.donations", labelKey: "acp.menu.vip.donations", href: "/admin/vip/donations", section: "vip.donations", icon: "fa-solid fa-hand-holding-dollar" },
      { key: "vip.donation_goals", labelKey: "acp.menu.vip.donation_goals", href: "/admin/vip/donations/goals", section: "vip.donation_goals", icon: "fa-solid fa-bullseye" },
      { key: "vip.donation_settings", labelKey: "acp.menu.vip.donation_settings", href: "/admin/settings/donations", section: "system.settings_donations", icon: "fa-solid fa-sliders" },
    ],
  },
];

/** Modulul VIP (specul etapei 3): niveluri, abonamente cu expirare, istoric. */
export const vipModule: GcsModule = {
  key: "vip",
  app: {
    optional: true,
    labelKey: "apps.vip",
    icon: "fa-solid fa-crown",
    descriptionKey: "apps.descriptions.vip",
    routes: ["/vip", "/donatii", "/api/donations"],
    sections: [
      { key: "page", labelKey: "site.nav.vip", icon: "fa-solid fa-crown", href: "/vip" },
      { key: "donations", labelKey: "site.nav.donations", icon: "fa-solid fa-hand-holding-heart", href: "/donatii" },
    ],
  },
  permissions,
  settings,
  acpMenu,
  notificationTypes: [
    { key: "vip.expiring", labelKey: "notifications.type.vip.expiring", important: true, defaultEmail: "INSTANT" },
    { key: "vip.granted", labelKey: "notifications.type.vip.granted", important: false, defaultEmail: "DIGEST" },
    { key: "vip.expired", labelKey: "notifications.type.vip.expired", important: false, defaultEmail: "DIGEST" },
    // Donațiile: confirmarea (mulțumirea) și respingerea, pentru donator; o cerere nouă „Am donat”, pentru echipă.
    { key: "donations.confirmed", labelKey: "notifications.type.donations.confirmed", important: false, defaultEmail: "INSTANT" },
    { key: "donations.rejected", labelKey: "notifications.type.donations.rejected", important: false, defaultEmail: "INSTANT" },
    { key: "donations.submitted", labelKey: "notifications.type.donations.submitted", important: false, defaultEmail: "DIGEST" },
  ],
  eventListeners: [],
  // Widget-ul „Obiectivul lunii” (în orice temă).
  widgets: donationWidgets,
  stats: vipStatTiles,
  // Pagina publică a planurilor (`/vip`); dispare din meniu odată cu aplicația. Nu exista în meniul anterior.
  nav: [{ key: "vip", labelKey: "site.nav.vip", icon: "fa-solid fa-crown", href: "/vip", position: 50 }],
  navPrevious: [],
};
