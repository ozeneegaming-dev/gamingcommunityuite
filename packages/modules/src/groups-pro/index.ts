import type { GcsAcpMenuSection, GcsModule, GcsSeedContext, GcsSettingDef } from "@gcs/core";
import { DEFAULT_LEGEND_CATEGORIES, DEFAULT_LEGEND_DISPLAY, validLegendCategories, validLegendDisplay } from "./legend";

export * from "./legend";

export const GROUPS_PRO_APP = "groups_pro";

/** Setarea cu categoriile legendei (ordinea lor e ordinea din legendă). */
export const LEGEND_CATEGORIES_SETTING = "groups_pro.legend_categories";
/** Setarea cu opțiunile de afișare ale legendei (coloane, numărători, grupurile goale, butonul și pagina grupurilor). */
export const LEGEND_DISPLAY_SETTING = "groups_pro.legend_display";
/**
 * Setările de grup ale legendei: categoria (cheia ei; `""` = grupul nu apare), grupul sub care apare (id sau `null`) și
 * poziția (ordinea din pagina ACP „Legenda grupurilor”; fără ea, „Prioritate afișare”).
 */
export const LEGEND_CATEGORY_KEY = "legend.category";
export const LEGEND_PARENT_KEY = "legend.parent";
export const LEGEND_POSITION_KEY = "legend.position";

/** Pagina ACP „Legenda grupurilor” (ACP → Membri), vizibilă doar cu aplicația pornită și accesibilă adminului. */
export const GROUPS_LEGEND_ACP_HREF = "/admin/members/groups-legend";

/** Grupurile tehnice: nu apar în legendă (implicit), orice ar fi în ACP. */
const HIDDEN_BY_DEFAULT = new Set(["guest", "banned"]);
const STAFF = new Set(["root_admin", "admin"]);
const MODERATORS = new Set(["super_moderator", "moderator"]);

/**
 * Categoria implicită a unui grup, după tipul lui: administratorii → Staff, moderatorii → Moderatori, VIP → VIP,
 * vizitatorii și banații → ascunși (`""`), ceilalți → Membri. Folosită la instalare / actualizare (doar grupurile fără
 * categorie) și pentru grupurile create mai târziu, până le alege adminul alta.
 */
export function defaultLegendCategory(group: { key: string; isVip: boolean }): string {
  if (HIDDEN_BY_DEFAULT.has(group.key)) return "";
  if (STAFF.has(group.key)) return "staff";
  if (MODERATORS.has(group.key)) return "moderators";
  if (group.isVip) return "vip";
  return "members";
}

const settings: GcsSettingDef[] = [
  {
    key: LEGEND_CATEGORIES_SETTING,
    type: "json",
    default: DEFAULT_LEGEND_CATEGORIES.map((c) => ({ ...c })),
    section: "groups_pro",
    labelKey: "settings.groups_pro.legend_categories",
    validate: (v) => (validLegendCategories(v) ? null : "invalid_value"),
  },
  {
    key: LEGEND_DISPLAY_SETTING,
    type: "json",
    default: { ...DEFAULT_LEGEND_DISPLAY },
    section: "groups_pro",
    labelKey: "settings.groups_pro.legend_display",
    validate: (v) => (validLegendDisplay(v) ? null : "invalid_value"),
  },
];

/**
 * ACP → Membri → „Legenda grupurilor”: categoriile, locul grupurilor și opțiunile de afișare, cu previzualizare. Dreptul
 * e cel al grupurilor (`members.groups`); intrarea apare doar cu aplicația pornită și accesibilă adminului (`app`).
 */
const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "members",
    title: "acp.menu.members.members",
    icon: "fa-solid fa-users",
    items: [
      {
        key: "members.groups_legend",
        labelKey: "acp.menu.members.groups_legend",
        href: GROUPS_LEGEND_ACP_HREF,
        section: "members.groups",
        icon: "fa-solid fa-layer-group",
        app: GROUPS_PRO_APP,
      },
    ],
  },
];

/**
 * Seed-ul Grupuri Pro (idempotent, rulat și la actualizare): aplicația pornește **oprită** (instalările noi și cele
 * existente păstrează legenda simplă; o stare aleasă în ACP rămâne), iar grupurile fără categorie în legendă primesc
 * categoria implicită după tipul lor. O categorie aleasă deja nu se schimbă.
 */
async function seedGroupsPro({ tx }: GcsSeedContext): Promise<void> {
  await tx.app.upsert({ where: { key: GROUPS_PRO_APP }, create: { key: GROUPS_PRO_APP, enabled: false }, update: {} });
  const groups = await tx.group.findMany({ select: { id: true, key: true, isVip: true } });
  await tx.groupSetting.createMany({
    data: groups.map((g) => ({ groupId: g.id, key: LEGEND_CATEGORY_KEY, value: defaultLegendCategory(g) })),
    skipDuplicates: true,
  });
}

/**
 * Grupuri Pro (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot, aplicație premium): legenda grupurilor pe categorii
 * definite de admin (carduri cu numărători, grupuri legate sub un grup părinte, tooltip-uri), pagina ACP „Legenda
 * grupurilor” și pagina `/members/groups` („Grupurile comunității”). Oprită, legenda rămâne cea simplă din pachetul
 * standard, iar paginile dau 404. Numele stilizate, pastilele-link, tooltip-ul cu numărători și grupurile secundare
 * rămân în pachetul standard.
 */
export const groupsProModule: GcsModule = {
  key: GROUPS_PRO_APP,
  app: {
    optional: true,
    labelKey: "apps.groups_pro",
    icon: "fa-solid fa-layer-group",
    descriptionKey: "apps.descriptions.groups_pro",
    routes: ["/members/groups"],
    premium: true,
    settingsHref: GROUPS_LEGEND_ACP_HREF,
  },
  permissions: [],
  settings,
  acpMenu,
  eventListeners: [],
  seed: seedGroupsPro,
};
