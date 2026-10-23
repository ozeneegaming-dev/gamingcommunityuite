import { GcsModuleRegistry, seedDefaults, settingValueError } from "@gcs/core";
import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { coreModule } from "../core-module";
import { forumsModule } from "./index";

const db = testDb();

function registry(): GcsModuleRegistry {
  const r = new GcsModuleRegistry();
  r.register(coreModule);
  r.register(forumsModule);
  return r;
}

async function groupSetting(groupKey: string, key: string): Promise<unknown> {
  const row = await db.groupSetting.findFirst({ where: { key, group: { key: groupKey } } });
  return row?.value;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("forumsModule", () => {
  test("se înregistrează lângă coreModule fără chei duplicate", () => {
    expect(() => registry()).not.toThrow();
  });

  test("declară permisiunile pe container ale forumului", () => {
    const keys = forumsModule.permissions.filter((p) => p.scope === "container").map((p) => p.key);
    expect(keys).toEqual(["forums.view", "forums.read", "forums.create", "forums.reply", "forums.upload", "forums.download", "forums.rate"]);
    for (const p of forumsModule.permissions.filter((d) => d.scope === "container")) expect(p.containerType).toBe("forum");
  });

  test("un forum nou: vizitatorul vede și citește, dar nu scrie; banatul nu are nimic", () => {
    const def = (key: string) => forumsModule.permissions.find((p) => p.key === key)!.default;
    expect(def("forums.read").guest).toBe(true);
    expect(def("forums.reply").guest).toBeUndefined();
    expect(def("forums.reply").member).toBe(true);
    for (const p of forumsModule.permissions) expect(p.default.banned).toBeUndefined();
  });

  test("setările de postare au valori implicite valide", () => {
    for (const s of forumsModule.settings) {
      expect(s.section).toBe("posting");
      expect(settingValueError(s, s.default)).toBeNull();
    }
    expect(forumsModule.settings.find((s) => s.key === "forums.posts_per_page")?.default).toBe(20);
  });

  test("meniul ACP adaugă aplicația Comunitate", () => {
    const sections = forumsModule.acpMenu.flatMap((s) => s.items.map((i) => i.section));
    expect(forumsModule.acpMenu.every((s) => s.app === "community")).toBe(true);
    expect(sections).toEqual(
      expect.arrayContaining(["community.forums", "community.prefixes", "community.saved_actions", "community.forum_settings"]),
    );
  });

  test("seed-ul dă setările de grup din specul etapei (aprobare, editare, flood)", async () => {
    await seedDefaults(db, registry());
    expect(await groupSetting("new_member", "forums.approval_first_posts")).toBe(2);
    expect(await groupSetting("member", "forums.approval_first_posts")).toBe(0);
    expect(await groupSetting("member", "forums.edit_own_minutes")).toBe(60);
    expect(await groupSetting("admin", "forums.edit_own_minutes")).toBe(-1);
    expect(await groupSetting("member", "forums.hide_own")).toBe(true);
    expect(await groupSetting("new_member", "forums.flood_seconds")).toBe(30);
    expect(await groupSetting("super_moderator", "forums.moderate_all")).toBe(true);
    expect(await groupSetting("moderator", "forums.moderate_all")).toBeUndefined();
  });

  test("seed-ul creează cele 5 reacții implicite o singură dată", async () => {
    await seedDefaults(db, registry());
    await seedDefaults(db, registry());
    const reactions = await db.reaction.findMany({ orderBy: { position: "asc" } });
    expect(reactions.map((r) => [r.key, r.weight])).toEqual([
      ["like", 1],
      ["gg", 1],
      ["thanks", 1],
      ["haha", 0],
      ["disagree", -1],
    ]);
  });

  test("seed-ul nu suprascrie o reacție modificată din ACP", async () => {
    await seedDefaults(db, registry());
    await db.reaction.update({ where: { key: "like" }, data: { label: "Apreciez" } });
    await seedDefaults(db, registry());
    expect((await db.reaction.findUniqueOrThrow({ where: { key: "like" } })).label).toBe("Apreciez");
  });
});
