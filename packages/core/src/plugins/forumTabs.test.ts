import { describe, expect, test } from "vitest";
import { testManifest } from "../../test/pluginFixtures";
import { PLUGIN_HOOK_POINTS } from "./catalog";
import { parsePluginManifest } from "./manifest";

const issues = (raw: unknown) => {
  const r = parsePluginManifest(raw);
  return r.ok ? [] : r.issues.map((i) => `${i.path}:${i.code}`);
};

const TAB = {
  key: "aspect",
  label: "forum.tab",
  icon: "fa-solid fa-palette",
  types: ["FORUM", "CATEGORY"],
  fields: [
    { type: "text", key: "tag", label: "forum.tag", maxLength: 20, slot: { slot: "forum.row.title" } },
    { type: "color", key: "title", label: "forum.title", css: { var: "--gcs-forum-title-color" } },
    { type: "toggle", key: "glow", label: "forum.glow", css: { class: "gcs-forumRow--titleGlow" } },
    { type: "select", key: "look", label: "forum.look", options: [{ value: "dark", label: "forum.dark" }], css: { class: "gcsp-look-" } },
    { type: "number", key: "veil", label: "forum.veil", min: 0, max: 100, default: 70, css: { var: "--gcsp-veil", unit: "%" } },
  ],
};
const forumManifest = (over: Record<string, unknown> = {}) => testManifest({ capabilities: ["widgets", "hooks"], hooks: [{ point: "forum.list" }, { point: "forum.edit" }], forumTabs: [TAB], ...over });

describe("manifestul: extensiile forumului (Forum v2)", () => {
  test("punctele forumului sunt în catalog", () => {
    expect(PLUGIN_HOOK_POINTS).toEqual(expect.arrayContaining(["forum.list", "forum.page", "topic.bar", "forum.edit"]));
  });

  test("un tab valid primește valorile implicite (poziția, `chip`, `hook: false`)", () => {
    const r = parsePluginManifest(forumManifest());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.forumTabs[0]).toMatchObject({ key: "aspect", position: 100, hook: false });
    expect(r.manifest.forumTabs[0]!.fields[0]).toMatchObject({ slot: { slot: "forum.row.title", as: "chip" } });
  });

  test("taburile cer capabilitatea `hooks`; `hook: true` cere punctul `forum.edit`", () => {
    expect(issues(forumManifest({ capabilities: ["widgets"], hooks: [] }))).toContain("forumTabs:missing_capability:hooks");
    expect(issues(forumManifest({ hooks: [{ point: "forum.list" }], forumTabs: [{ ...TAB, hook: true }] }))).toContain("forumTabs:missing_hook:forum.edit");
  });

  test("stilul: doar variabilele `--gcsp-*` / `--gcs-forum-*` și clasele `gcsp-*` sau modificatorii nucleului", () => {
    const withField = (f: Record<string, unknown>) => forumManifest({ forumTabs: [{ ...TAB, fields: [f] }] });
    expect(issues(withField({ type: "color", key: "c", label: "x", css: { var: "--gcs-accent" } }))[0]).toMatch(/^forumTabs\.0\.fields\.0\.css\.var/);
    expect(issues(withField({ type: "toggle", key: "t", label: "x", css: { class: "gcs-btn" } }))[0]).toMatch(/^forumTabs\.0\.fields\.0\.css\.class/);
    expect(issues(withField({ type: "toggle", key: "t", label: "x", css: { class: "gcs-forumRow--titleCaps" } }))).toEqual([]);
  });

  test("Aspect forumuri: câmpul imagine (limitele implicite) și selectul cu opțiunile din site", () => {
    const withFields = (fields: unknown[]) => forumManifest({ forumTabs: [{ ...TAB, fields }] });
    const r = parsePluginManifest(withFields([{ type: "image", key: "icon", label: "x", css: { var: "--gcs-forum-icon-image" } }, { type: "select", key: "server", label: "x", optionsFrom: "servers" }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.forumTabs[0]!.fields[0]).toMatchObject({ type: "image", maxKb: 512, maxSide: 1600, animated: false });
    expect(issues(withFields([{ type: "image", key: "i", label: "x", maxKb: 99999 }]))[0]).toMatch(/^forumTabs\.0\.fields\.0\.maxKb/);
    expect(issues(withFields([{ type: "select", key: "s", label: "x" }]))).toContain("forumTabs.aspect.s.options:required");
    expect(issues(withFields([{ type: "select", key: "s", label: "x", optionsFrom: "forums", options: [{ value: "a", label: "a" }] }]))).toContain("forumTabs.aspect.s.options:not_allowed");
    expect(issues(withFields([{ type: "select", key: "s", label: "x", optionsFrom: "users" }]))[0]).toMatch(/optionsFrom/);
  });

  test("cheile repetate, intervalele și valorile implicite greșite", () => {
    const dup = forumManifest({ forumTabs: [TAB, { ...TAB, fields: [{ type: "text", key: "tag", label: "x" }] }] });
    expect(issues(dup)).toEqual(expect.arrayContaining(["forumTabs.aspect:duplicate_key", "forumTabs.fields.tag:duplicate_key"]));
    const range = forumManifest({ forumTabs: [{ ...TAB, fields: [{ type: "number", key: "n", label: "x", min: 5, max: 1 }, { type: "number", key: "m", label: "x", min: 0, max: 1, default: 3 }] }] });
    expect(issues(range)).toEqual(expect.arrayContaining(["forumTabs.aspect.n:invalid_range", "forumTabs.aspect.m.default:out_of_range"]));
    const choice = forumManifest({ forumTabs: [{ ...TAB, fields: [{ type: "select", key: "s", label: "x", options: [{ value: "a", label: "a" }], default: "b" }] }] });
    expect(issues(choice)).toContain("forumTabs.aspect.s.default:invalid_choice");
  });
});
