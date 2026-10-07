import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsNameStyle } from "../groups/nameStyles";
import { GCS_WIDGET_PAGES, type GcsModuleRegistry, type GcsWidgetPage } from "../modules/registry";
import { GcsNavService } from "../nav/service";
import { GcsThemeService } from "../themes/service";
import { defaultWidgetLayout, GcsWidgetService, type GcsWidgetPlacementInput } from "../widgets/service";

type DefaultGroup = {
  key: string;
  name: string;
  isProtected: boolean;
  isVip?: boolean;
  color?: string;
  /** Iconița Font Awesome a grupului (legenda, postbit-ul, lista staff-ului). */
  icon?: string;
  nameStyle?: GcsNameStyle;
};

/**
 * Grupurile create la instalare (spec §6.1), cu stilurile din machetă.
 * Grupurile implicite sunt protejate (nu se pot șterge); VIP-urile pot fi șterse din ACP.
 */
export const DEFAULT_GROUPS: DefaultGroup[] = [
  { key: "root_admin", name: "Root Admin", icon: "fa-solid fa-crown", isProtected: true, color: "#FF4D57", nameStyle: { color: "#FF4D57", glow: "#FF4D57", bold: true } },
  { key: "admin", name: "Admin", icon: "fa-solid fa-shield-halved", isProtected: true, color: "#FF4D57", nameStyle: { color: "#FF4D57", glow: "#FF4D57", bold: true } },
  { key: "super_moderator", name: "Super Moderator", icon: "fa-solid fa-user-shield", isProtected: true, color: "#5EA2FF", nameStyle: { color: "#5EA2FF", bold: true } },
  { key: "moderator", name: "Moderator", icon: "fa-solid fa-shield", isProtected: true, color: "#5EA2FF", nameStyle: { color: "#5EA2FF", bold: true } },
  { key: "member", name: "Membru", icon: "fa-solid fa-user", isProtected: true, color: "#ECEDF1", nameStyle: { color: "#ECEDF1" } },
  { key: "new_member", name: "Membru nou", icon: "fa-solid fa-seedling", isProtected: true, color: "#A1A7B4", nameStyle: { color: "#A1A7B4" } },
  { key: "banned", name: "Banat", icon: "fa-solid fa-ban", isProtected: true, color: "#6B7280", nameStyle: { color: "#6B7280" } },
  { key: "guest", name: "Vizitator", icon: "fa-solid fa-user-secret", isProtected: true, color: "#A1A7B4", nameStyle: { color: "#A1A7B4" } },
  { key: "vip_bronze", name: "VIP Bronze", icon: "fa-solid fa-medal", isProtected: false, isVip: true, color: "#CD7F32", nameStyle: { color: "#CD7F32", bold: true } },
  { key: "vip_silver", name: "VIP Silver", icon: "fa-solid fa-gem", isProtected: false, isVip: true, color: "#D8DFEA", nameStyle: { color: "#D8DFEA", glow: "#D8DFEA", bold: true } },
  {
    key: "vip_gold",
    icon: "fa-solid fa-crown",
    name: "VIP Gold",
    isProtected: false,
    isVip: true,
    color: "#F4B740",
    nameStyle: { gradient: ["#F4B740", "#FFF0B8", "#E8961C"], animated: true, bold: true },
  },
  {
    key: "vip_legend",
    icon: "fa-solid fa-dragon",
    name: "VIP Legend",
    isProtected: false,
    isVip: true,
    color: "#C7ADFF",
    nameStyle: { gradient: ["#B794FF", "#FF7AC6", "#6FB6FF"], animated: true, bold: true },
  },
];

const WARNING_ACTIONS = [
  { threshold: 3, action: "MODERATE_POSTS", durationHours: 72 },
  { threshold: 5, action: "RESTRICT", durationHours: 168 },
  { threshold: 10, action: "BAN", durationHours: null },
] as const;

export const ROOT_ACP_ROLE = "Root";
/** Versiunea meniului implicit pusă de seed (vezi `GcsNavService.upgradeDefaults`). */
export const NAV_SEED_MARK = "nav:v2";

/** Seed-ul face multe scrieri mici într-o tranzacție; limita implicită Prisma (5 s) e prea strânsă pe un server încărcat. */
const SEED_TX = { timeout: 30_000, maxWait: 10_000 };

/**
 * Datele implicite ale unei instalări noi. E idempotentă: rulată din nou, creează doar ce lipsește
 * și nu suprascrie modificările făcute din ACP.
 */
export async function seedDefaults(db: PrismaClient, registry: GcsModuleRegistry): Promise<void> {
  await db.$transaction(async (tx) => {
    const groupIds = new Map<string, number>();
    for (const [position, g] of DEFAULT_GROUPS.entries()) {
      const row = await tx.group.upsert({
        where: { key: g.key },
        update: {},
        create: {
          key: g.key,
          name: g.name,
          isProtected: g.isProtected,
          isVip: g.isVip ?? false,
          color: g.color ?? null,
          icon: g.icon ?? null,
          nameStyle: (g.nameStyle ?? undefined) as Prisma.InputJsonValue | undefined,
          position,
        },
      });
      groupIds.set(g.key, row.id);
    }

    const settings: Prisma.GroupSettingCreateManyInput[] = [];
    for (const def of registry.permissionDefs()) {
      if (def.scope !== "group") continue;
      for (const [groupKey, value] of Object.entries(def.default)) {
        const groupId = groupIds.get(groupKey);
        if (groupId === undefined || value === undefined) continue;
        settings.push({ groupId, key: def.key, value: value as Prisma.InputJsonValue });
      }
    }
    await tx.groupSetting.createMany({ data: settings, skipDuplicates: true });

    const role = await tx.acpRole.upsert({ where: { name: ROOT_ACP_ROLE }, update: {}, create: { name: ROOT_ACP_ROLE } });
    const sections = [...new Set(registry.acpMenu().flatMap((s) => s.items.map((i) => i.section)))];
    await tx.acpRolePermission.createMany({
      data: sections.map((section) => ({ roleId: role.id, section, canView: true, canEdit: true, canDelete: true })),
      skipDuplicates: true,
    });
    const rootGroupId = groupIds.get("root_admin")!;
    const assigned = await tx.acpRoleAssignment.findFirst({ where: { roleId: role.id, groupId: rootGroupId } });
    if (!assigned) await tx.acpRoleAssignment.create({ data: { roleId: role.id, groupId: rootGroupId } });

    for (const a of WARNING_ACTIONS) {
      await tx.warningAction.upsert({ where: { threshold: a.threshold }, update: {}, create: a });
    }

    for (const m of registry.all()) {
      if (m.seed) await m.seed({ tx, groupIds });
    }

    // Valorile implicite ale notificărilor (etapa 4); cele schimbate din ACP rămân.
    await tx.notificationDefault.createMany({
      data: registry.notificationTypes().map((t) => ({ type: t.key, site: true, email: t.defaultEmail })),
      skipDuplicates: true,
    });

    // Meniul principal implicit din itemii modulelor (etapa 5); un meniu editat de admin rămâne.
    // O singură dată (marcajul `nav`): un meniu golit de admin nu e refăcut la repornire.
    // Marcajul `nav:v2` (meniul cu Activitate, Clasament, VIP, Reguli și submeniul Membri): o instalare nouă îl
    // primește direct; una existentă își actualizează o singură dată meniul (`GcsNavService.upgradeDefaults`).
    const navState = await tx.systemState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    if (!navState.seedMarks.includes("nav")) {
      await GcsNavService.seedDefaults(tx, registry);
      await tx.systemState.update({ where: { id: 1 }, data: { seedMarks: { push: ["nav", NAV_SEED_MARK] } } });
    } else if (!navState.seedMarks.includes(NAV_SEED_MARK)) {
      await GcsNavService.upgradeDefaults(tx, registry);
      await tx.systemState.update({ where: { id: 1 }, data: { seedMarks: { push: NAV_SEED_MARK } } });
    }
    // Tema implicită (etapa 5), doar dacă nu există încă nicio temă.
    await GcsThemeService.seedDefault(tx);
    // Widget-urile implicite ale paginilor (etapa 5), din modulele înregistrate; o pagină aranjată de admin rămâne.
    const layouts: Partial<Record<GcsWidgetPage, GcsWidgetPlacementInput[]>> = {};
    for (const page of GCS_WIDGET_PAGES) {
      const list = defaultWidgetLayout(registry, page);
      if (list.length > 0) layouts[page] = list;
    }
    const state = await tx.systemState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const pending = (Object.keys(layouts) as GcsWidgetPage[]).filter((page) => !state.seedMarks.includes(`layout:${page}`));
    await GcsWidgetService.seedDefaults(tx, Object.fromEntries(pending.map((page) => [page, layouts[page]!])));
    if (pending.length > 0) await tx.systemState.update({ where: { id: 1 }, data: { seedMarks: { push: pending.map((page) => `layout:${page}`) } } });

    await tx.systemState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }, SEED_TX);
}
