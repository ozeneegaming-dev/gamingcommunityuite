import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsRateLimited, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { compileGroupMentionCss, GcsGroupMentionService, GROUP_MENTION_SETTING, normalizeGroupName, type GcsGroupMentionSettings } from "./mentions";

let w: GcsTestWorld;
let mentions: GcsGroupMentionService;
let root: GcsActor;

beforeEach(async () => {
  w = await createWorld();
  mentions = new GcsGroupMentionService({ db: w.db, cache: w.cache, redis: w.redis });
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const keys = (groups: { key: string }[]) => groups.map((g) => g.key).sort();

async function settingsOf(key: string): Promise<GcsGroupMentionSettings> {
  return (await mentions.group(w.groups[key]!))!.settings;
}

async function save(key: string, patch: Partial<GcsGroupMentionSettings>, actor = root) {
  return w.groupService.setMentionSettings(w.groups[key]!, { ...(await settingsOf(key)), ...patch }, actor);
}

describe("setările implicite", () => {
  test("staff-ul (admin, super moderator, moderator) poate fi menționat de staff; restul grupurilor nu", async () => {
    const groups = await mentions.groups();
    expect(keys(groups.filter((g) => g.mentionable))).toEqual(["admin", "moderator", "super_moderator"]);
    const staff = [w.groups.admin!, w.groups.super_moderator!, w.groups.moderator!].sort((a, b) => a - b);
    expect(await settingsOf("moderator")).toEqual({ enabled: true, allowedGroupIds: staff, notify: true, notifyLimit: 50, cooldownMinutes: 10 });
    expect((await settingsOf("member")).enabled).toBe(false);
  });

  test("Vizitator și Banat nu pot fi menționate nici cu setarea salvată direct în bază", async () => {
    for (const key of ["guest", "banned"]) {
      await w.db.groupSetting.create({ data: { groupId: w.groups[key]!, key: GROUP_MENTION_SETTING.enabled, value: true } });
    }
    const groups = await mentions.groups();
    expect(groups.find((g) => g.key === "guest")!.mentionable).toBe(false);
    expect(groups.find((g) => g.key === "banned")!.mentionable).toBe(false);
    expect(keys(await mentions.mentionableBy(root))).toEqual(["admin", "moderator", "super_moderator"]);
  });
});

describe("cine poate menționa", () => {
  test("un moderator poate menționa staff-ul; un membru nu, până nu e permis grupul lui", async () => {
    const mod = await w.actorFor(await w.createUser("Mod", "moderator"));
    const member = await w.actorFor(await w.createUser("Membru", "member"));
    expect(keys(await mentions.mentionableBy(mod))).toEqual(["admin", "moderator", "super_moderator"]);
    expect(await mentions.mentionableBy(member)).toEqual([]);

    await save("moderator", { allowedGroupIds: [w.groups.member!] });
    expect(keys(await mentions.mentionableBy(member))).toEqual(["moderator"]);
    // Un grup secundar contează la fel ca cel principal.
    const vip = await w.actorFor(await w.createUser("Vip", "vip_gold", ["member"]));
    expect(keys(await mentions.mentionableBy(vip))).toEqual(["moderator"]);
  });

  test("Root Admin poate menționa orice grup activ; vizitatorii și banații nu pot menționa nimic", async () => {
    await save("vip_gold", { enabled: true, allowedGroupIds: [] });
    expect(keys(await mentions.mentionableBy(root))).toEqual(["admin", "moderator", "super_moderator", "vip_gold"]);
    const guest: GcsActor = { userId: null, groupIds: [w.groups.guest!], primaryGroupId: w.groups.guest!, isBanned: false, ip: "1.1.1.1" };
    expect(await mentions.mentionableBy(guest)).toEqual([]);
    const mod = await w.actorFor(await w.createUser("Mod", "moderator"));
    expect(await mentions.mentionableBy({ ...mod, isBanned: true })).toEqual([]);
    expect(await mentions.mentionableBy({ ...mod, groupIds: [...mod.groupIds, w.groups.banned!] })).toEqual([]);
  });

  test("renderMap: grupurile permise, plus cele deja salvate în documentul vechi (editare)", async () => {
    const member = await w.actorFor(await w.createUser("Membru", "member"));
    expect([...(await mentions.renderMap(member)).keys()]).toEqual([]);
    const old = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: String(w.groups.moderator), label: "Moderator", kind: "group" } }] }] };
    expect(await mentions.renderMap(member, old)).toEqual(new Map([[String(w.groups.moderator), { name: "Moderator" }]]));
    // Un grup dezactivat între timp nu mai e păstrat.
    await save("moderator", { enabled: false });
    expect([...(await mentions.renderMap(member, old)).keys()]).toEqual([]);
  });
});

describe("ACP → Grupuri → Mențiuni", () => {
  test("salvează toate setările, cu jurnal; cache-ul se invalidează imediat", async () => {
    const before = await settingsOf("vip_gold");
    const next = await save("vip_gold", { enabled: true, allowedGroupIds: [w.groups.member!, w.groups.member!], notify: false, notifyLimit: 5, cooldownMinutes: 0 });
    expect(next).toEqual({ enabled: true, allowedGroupIds: [w.groups.member!], notify: false, notifyLimit: 5, cooldownMinutes: 0 });
    expect(await settingsOf("vip_gold")).toEqual(next);
    const audit = await w.db.auditLog.findFirstOrThrow({ where: { action: "group.mentions" } });
    expect(audit).toMatchObject({ targetId: String(w.groups.vip_gold), before, after: next });
  });

  test("validări: Vizitator/Banat nu pot fi activate, limite în interval, grupuri existente", async () => {
    await expect(save("guest", { enabled: true })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(save("banned", { enabled: true })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(save("member", { notifyLimit: 0 })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(save("member", { notifyLimit: 501 })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(save("member", { cooldownMinutes: -1 })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(save("member", { allowedGroupIds: [999_999] })).rejects.toBeInstanceOf(GcsValidationError);
    // Dezactivate, Vizitator și Banat se pot salva (ex. formularul trimis fără schimbări).
    await expect(save("banned", { enabled: false })).resolves.toMatchObject({ enabled: false });
  });

  test("doar cine are dreptul ACP pe grupuri poate schimba setările", async () => {
    const member = await w.actorFor(await w.createUser("Membru", "member"));
    await expect(save("member", { enabled: true }, member)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("un grup nou nu moștenește setările de mențiune ale grupului Membru", async () => {
    await save("member", { enabled: true, allowedGroupIds: [w.groups.member!] });
    const created = await w.groupService.create({ name: "Echipa" }, root);
    expect(await w.db.groupSetting.count({ where: { groupId: created.id, key: { startsWith: "mentions." } } })).toBe(0);
    expect((await mentions.group(created.id))!.mentionable).toBe(false);
  });
});

describe("pauza dintre mențiuni", () => {
  test("același membru nu poate menționa din nou grupul în pauza setată; alt grup sau alt membru, da", async () => {
    const mod = await w.actorFor(await w.createUser("Mod", "moderator"));
    const other = await w.actorFor(await w.createUser("Mod2", "moderator"));
    const g = w.groups.moderator!;
    await expect(mentions.assertCooldown(mod, [g])).resolves.toBeUndefined();
    await mentions.markCooldown(mod, [g]);
    const error = await mentions.assertCooldown(mod, [g]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GcsRateLimited);
    expect((error as GcsRateLimited).params).toMatchObject({ reason: "group_mention_cooldown", group: "Moderator" });
    expect(Number((error as GcsRateLimited).params!.retryAfter)).toBeGreaterThan(590);
    await expect(mentions.assertCooldown(mod, [w.groups.admin!])).resolves.toBeUndefined();
    await expect(mentions.assertCooldown(other, [g])).resolves.toBeUndefined();
  });

  test("cu pauza 0 nu există limită", async () => {
    const mod = await w.actorFor(await w.createUser("Mod", "moderator"));
    await save("moderator", { cooldownMinutes: 0 });
    await mentions.markCooldown(mod, [w.groups.moderator!]);
    await expect(mentions.assertCooldown(mod, [w.groups.moderator!])).resolves.toBeUndefined();
  });
});

test("normalizeGroupName: fără diacritice, spații și majuscule", () => {
  expect(normalizeGroupName("Super Moderator")).toBe("supermoderator");
  expect(normalizeGroupName("Membru nou")).toBe("membrunou");
  expect(normalizeGroupName("Ștefăniță")).toBe("stefanita");
});

test("compileGroupMentionCss: culoarea și iconița fiecărui grup, cu valorile validate", () => {
  const icon = { width: 512, height: 512, path: "M0 0h512v512H0z" };
  const css = compileGroupMentionCss(
    [
      { id: 5, color: "#5EA2FF", icon },
      { id: 6, color: "red;background:url(x)", icon: { width: 1, height: 1, path: '"/><script>' } },
      { id: 7, color: null, icon: null },
    ],
    icon,
  );
  const url = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/></svg>')}")`;
  expect(css.split("\n")).toEqual([
    `.gcs-groupMention{--gcs-gm-icon:${url};--gcs-gm-before:""}`,
    `.gcs-groupMention[data-group-id="5"]{--gcs-gm-color:#5EA2FF;--gcs-gm-icon:${url};--gcs-gm-before:""}`,
  ]);
});
