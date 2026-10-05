import { GcsModuleRegistry, type GcsModule } from "../src/modules/registry";

/**
 * Un modul minim pentru testele din `core` (care nu pot importa `@gcs/modules`, fiindcă acesta depinde de `core`).
 * Imită forma lui `coreModule`: câteva permisiuni de grup și secțiunile ACP folosite în teste.
 */
export const testCoreModule: GcsModule = {
  key: "core",
  settings: [],
  eventListeners: [],
  permissions: [
    {
      key: "core.view_public",
      scope: "group",
      labelKey: "p",
      default: { root_admin: true, admin: true, member: true, new_member: true, guest: true, banned: true },
    },
    { key: "acp.access", scope: "group", labelKey: "p", default: { root_admin: true, admin: true } },
    { key: "upload.max_mb", scope: "group", labelKey: "p", default: { member: 10, admin: -1 } },
    { key: "profile.styled_name", scope: "group", labelKey: "p", default: { vip_gold: true } },
    { key: "forums.view", scope: "container", containerType: "forum", labelKey: "p", default: {} },
  ],
  acpMenu: [
    {
      app: "members",
      title: "acp.menu.members.members",
      items: [
        { key: "members.members", labelKey: "m", href: "/admin/members", section: "members.members" },
        { key: "members.groups", labelKey: "g", href: "/admin/members/groups", section: "members.groups" },
        { key: "members.warnings", labelKey: "w", href: "/admin/members/warnings", section: "members.warnings" },
      ],
    },
    {
      app: "vip",
      title: "acp.menu.vip.vip",
      items: [{ key: "vip.tiers", labelKey: "v", href: "/admin/vip/tiers", section: "vip.tiers" }],
    },
  ],
};

export function testRegistry(): GcsModuleRegistry {
  const registry = new GcsModuleRegistry();
  registry.register(testCoreModule);
  return registry;
}
