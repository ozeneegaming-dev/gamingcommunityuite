import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsNameStyle } from "../groups/nameStyles";
import type { GcsModuleRegistry } from "../modules/registry";

type DefaultGroup = {
  key: string;
  name: string;
  isProtected: boolean;
  isVip?: boolean;
  color?: string;
  nameStyle?: GcsNameStyle;
};

/**
 * Grupurile create la instalare (spec §6.1), cu stilurile din machetă.
 * Grupurile implicite sunt protejate (nu se pot șterge); VIP-urile pot fi șterse din ACP.
 */
export const DEFAULT_GROUPS: DefaultGroup[] = [
  { key: "root_admin", name: "Root Admin", isProtected: true, color: "#FF4D57", nameStyle: { color: "#FF4D57", glow: "#FF4D57", bold: true } },
  { key: "admin", name: "Admin", isProtected: true, color: "#FF4D57", nameStyle: { color: "#FF4D57", glow: "#FF4D57", bold: true } },
  { key: "super_moderator", name: "Super Moderator", isProtected: true, color: "#5EA2FF", nameStyle: { color: "#5EA2FF", bold: true } },
  { key: "moderator", name: "Moderator", isProtected: true, color: "#5EA2FF", nameStyle: { color: "#5EA2FF", bold: true } },
  { key: "member", name: "Membru", isProtected: true, color: "#ECEDF1", nameStyle: { color: "#ECEDF1" } },
  { key: "new_member", name: "Membru nou", isProtected: true, color: "#A1A7B4", nameStyle: { color: "#A1A7B4" } },
  { key: "banned", name: "Banat", isProtected: true, color: "#6B7280", nameStyle: { color: "#6B7280" } },
  { key: "guest", name: "Vizitator", isProtected: true, color: "#A1A7B4", nameStyle: { color: "#A1A7B4" } },
  { key: "vip_bronze", name: "VIP Bronze", isProtected: false, isVip: true, color: "#CD7F32", nameStyle: { color: "#CD7F32", bold: true } },
  { key: "vip_silver", name: "VIP Silver", isProtected: false, isVip: true, color: "#D8DFEA", nameStyle: { color: "#D8DFEA", glow: "#D8DFEA", bold: true } },
  {
    key: "vip_gold",
    name: "VIP Gold",
    isProtected: false,
    isVip: true,
    color: "#F4B740",
    nameStyle: { gradient: ["#F4B740", "#FFF0B8", "#E8961C"], animated: true, bold: true },
  },
  {
    key: "vip_legend",
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

    await tx.systemState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }, SEED_TX);
}
