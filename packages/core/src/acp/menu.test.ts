import { describe, expect, test } from "vitest";
import { GcsModuleRegistry } from "../modules/registry";
import { acpAppEntries, buildAcpMenu } from "./menu";

function registry() {
  const r = new GcsModuleRegistry();
  r.register({
    key: "core",
    settings: [],
    permissions: [],
    eventListeners: [],
    acpMenu: [
      {
        app: "system",
        title: "acp.menu.system.overview",
        items: [{ key: "system.dashboard", labelKey: "d", href: "/admin", section: "system.dashboard" }],
      },
      {
        app: "members",
        title: "acp.menu.members.members",
        items: [
          { key: "members.members", labelKey: "m", href: "/admin/members", section: "members.members" },
          { key: "members.groups", labelKey: "g", href: "/admin/groups", section: "members.groups" },
        ],
      },
      {
        app: "members",
        title: "acp.menu.members.staff",
        items: [{ key: "members.acp_roles", labelKey: "r", href: "/admin/staff/roles", section: "members.acp_roles" }],
      },
    ],
  });
  return r;
}

const right = { view: true, edit: false, delete: false };

describe("buildAcpMenu", () => {
  test("cu drept doar pe members.groups → o singură aplicație, members, cu o singură intrare", () => {
    const menu = buildAcpMenu(registry(), { "members.groups": right });
    expect(menu).toHaveLength(1);
    expect(menu[0]?.app).toBe("members");
    expect(menu[0]?.items.map((i) => i.key)).toEqual(["members.groups"]);
  });

  test("un drept fără view nu afișează intrarea", () => {
    expect(buildAcpMenu(registry(), { "members.groups": { view: false, edit: true, delete: false } })).toEqual([]);
  });

  test("păstrează ordinea secțiunilor din module", () => {
    const menu = buildAcpMenu(registry(), {
      "system.dashboard": right,
      "members.members": right,
      "members.acp_roles": right,
    });
    expect(menu.map((s) => s.title)).toEqual([
      "acp.menu.system.overview",
      "acp.menu.members.members",
      "acp.menu.members.staff",
    ]);
  });

  test("paginile unei aplicații apar doar cu aplicația pornită și accesibilă adminului", () => {
    const r = registry();
    r.register({
      key: "groups_pro",
      settings: [],
      permissions: [],
      eventListeners: [],
      acpMenu: [
        {
          app: "members",
          title: "acp.menu.members.members",
          items: [{ key: "members.groups_legend", labelKey: "l", href: "/admin/members/groups-legend", section: "members.groups", app: "groups_pro" }],
        },
      ],
    });
    const rights = { "members.groups": right };
    const keys = (menu: ReturnType<typeof buildAcpMenu>) => menu.flatMap((s) => s.items.map((i) => i.key));
    expect(keys(buildAcpMenu(r, rights, () => false))).toEqual(["members.groups"]);
    expect(keys(buildAcpMenu(r, rights, (app) => app === "groups_pro"))).toEqual(["members.groups", "members.groups_legend"]);
    // Fără filtru (ex. lista tuturor paginilor), toate intrările.
    expect(keys(buildAcpMenu(r, rights))).toEqual(["members.groups", "members.groups_legend"]);
  });
});

describe("acpAppEntries", () => {
  test("o intrare per aplicație, cu primul link, în ordinea salvată de admin", () => {
    const menu = buildAcpMenu(registry(), {
      "system.dashboard": right,
      "members.members": right,
      "members.groups": right,
    });
    expect(acpAppEntries(menu)).toEqual([
      { app: "system", href: "/admin" },
      { app: "members", href: "/admin/members" },
    ]);
    expect(acpAppEntries(menu, ["members", "system"]).map((a) => a.app)).toEqual(["members", "system"]);
    // O aplicație necunoscută în ordinea salvată e ignorată; cele lipsă vin la final.
    expect(acpAppEntries(menu, ["vip", "members"]).map((a) => a.app)).toEqual(["members", "system"]);
  });
});
