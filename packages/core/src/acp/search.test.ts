import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsModuleRegistry } from "../modules/registry";
import { GcsAcpSearch } from "./search";

let w: GcsTestWorld;
let search: GcsAcpSearch;

const labels: Record<string, string> = {
  "settings.email.smtp_host": "Server SMTP",
  "settings.email.smtp_pass": "Parolă SMTP",
  "settings.site.name": "Numele site-ului",
};
const translate = (key: string) => labels[key] ?? key;

beforeEach(async () => {
  w = await createWorld();
  // Setările vin dintr-un modul separat de cel de test, ca să avem secțiunea de setări în meniu.
  const registry = new GcsModuleRegistry();
  for (const m of w.registry.all()) registry.register(m);
  registry.register({
    key: "settings-test",
    permissions: [],
    eventListeners: [],
    settings: [
      { key: "site.name", type: "string", default: "RED-LINE", section: "general", labelKey: "settings.site.name" },
      { key: "email.smtp_host", type: "string", default: "", section: "email", labelKey: "settings.email.smtp_host" },
      { key: "email.smtp_pass", type: "secret", default: "", section: "email", labelKey: "settings.email.smtp_pass" },
    ],
    acpMenu: [
      {
        app: "system",
        title: "acp.menu.system.settings",
        items: [
          { key: "system.settings_general", labelKey: "g", href: "/admin/settings/general", section: "system.settings_general" },
          { key: "system.settings_email", labelKey: "e", href: "/admin/settings/email", section: "system.settings_email" },
        ],
      },
    ],
  });
  search = new GcsAcpSearch({ db: w.db, registry, acp: w.acp });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("GcsAcpSearch", () => {
  test('searchAcp("smtp") → conține setarea email.smtp_host, cu link spre secțiune', async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const results = await search.search("smtp", root, translate);
    expect(results).toContainEqual({ group: "settings", label: "Server SMTP", href: "/admin/settings/email#email.smtp_host" });
  });

  test("membri după prefixul numelui normalizat, grupuri după nume", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    await w.createUser("ștefan", "member");
    await w.createUser("Stefania", "member");
    await w.createUser("Krystof", "member");

    const results = await search.search("Ște", root, translate);
    expect(results.filter((r) => r.group === "members").map((r) => r.label).sort()).toEqual(["Stefania", "ștefan"]);

    const groups = await search.search("vip", root, translate);
    expect(groups.filter((r) => r.group === "groups").map((r) => r.label)).toEqual([
      "VIP Bronze",
      "VIP Silver",
      "VIP Gold",
      "VIP Legend",
    ]);
  });

  test("maxim 8 rezultate pe grupă", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    for (let i = 0; i < 12; i++) await w.createUser(`player${i}`, "member");
    const results = await search.search("player", root, translate);
    expect(results.filter((r) => r.group === "members")).toHaveLength(8);
  });

  test("fără drepturi ACP nu găsește nimic; cu drept doar pe grupuri, doar grupuri", async () => {
    const member = await w.actorFor(await w.createUser("Membru", "member"));
    await expect(search.search("vip", member, translate)).resolves.toEqual([]);

    await w.grantAdmin(["members.groups"]);
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    const results = await search.search("a", admin, translate);
    expect(new Set(results.map((r) => r.group))).toEqual(new Set(["groups"]));
  });

  test("o căutare prea scurtă întoarce gol", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    await expect(search.search(" ", root, translate)).resolves.toEqual([]);
  });
});
