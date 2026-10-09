import type { GcsModule, GcsSeedContext, GcsSettingDef } from "@gcs/core";

export const GROUPS_PRO_APP = "groups_pro";

/** Setarea cu categoriile legendei (ordinea lor e ordinea din legendă). */
export const LEGEND_CATEGORIES_SETTING = "groups_pro.legend_categories";
/** Setările de grup ale legendei: categoria (cheia ei; `""` = grupul nu apare) și grupul sub care apare (id sau `null`). */
export const LEGEND_CATEGORY_KEY = "legend.category";
export const LEGEND_PARENT_KEY = "legend.parent";

/** O categorie a legendei: cheia și eticheta (`""` = eticheta implicită tradusă, pentru categoriile implicite). */
export type GcsLegendCategory = { key: string; label: string };

/** Categoriile implicite (etichetele traduse: `groupsPro.category.<cheie>`); serverele vin mai târziu. */
export const DEFAULT_LEGEND_CATEGORIES: readonly GcsLegendCategory[] = [
  { key: "staff", label: "" },
  { key: "moderators", label: "" },
  { key: "vip", label: "" },
  { key: "members", label: "" },
];
export const LEGEND_CATEGORY_MAX = 12;
export const LEGEND_LABEL_MAX = 32;
const CATEGORY_KEY_RE = /^[a-z0-9_]{1,24}$/;

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

/** Validarea listei de categorii: 1–12, chei unice `[a-z0-9_]`, etichete scurte. */
export function validLegendCategories(v: unknown): v is GcsLegendCategory[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > LEGEND_CATEGORY_MAX) return false;
  const keys = new Set<string>();
  for (const c of v) {
    if (typeof c !== "object" || c === null) return false;
    const { key, label } = c as Record<string, unknown>;
    if (typeof key !== "string" || !CATEGORY_KEY_RE.test(key) || keys.has(key)) return false;
    if (typeof label !== "string" || label.length > LEGEND_LABEL_MAX) return false;
    keys.add(key);
  }
  return true;
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
 * definite de admin (carduri cu numărători, grupuri legate sub un grup părinte, tooltip-uri) și pagina
 * `/members/groups` („Grupurile comunității”). Oprită, legenda rămâne cea simplă din pachetul standard, iar pagina dă 404.
 * Numele stilizate, pastilele-link, tooltip-ul cu numărători și grupurile secundare rămân în pachetul standard.
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
  },
  permissions: [],
  settings,
  acpMenu: [],
  eventListeners: [],
  seed: seedGroupsPro,
};
