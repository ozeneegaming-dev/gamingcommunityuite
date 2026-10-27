import { describe, expect, test } from "vitest";
import type { GcsPluginForumNode } from "../../../src/index";
import { autoBadgeForums, inheritedStyle, subBadge } from "../src/aspect";

const node = (over: Partial<GcsPluginForumNode> = {}): GcsPluginForumNode => ({ id: 2, type: "FORUM", parentId: 1, name: "Configuri", slug: "configuri", data: { bg: "" }, ...over });

describe("Aspect forumuri: fundalul moștenit", () => {
  test("subforumul fără imagine primește imaginea, stilul, punctul de interes și voalul părintelui", () => {
    const parent = { id: 1, type: "FORUM" as const, data: { bg: "bgMain", bgLight: "bgLight1", bgStyle: "right", bgFocus: "left", veil: 70, veilHover: 55, inherit: true, noMobile: true } };
    expect(inheritedStyle(node({ parent }))).toEqual({
      classes: ["gcs-forumRow--image", "gcs-forumRow--image-right", "gcs-forumRow--imageDesktop"],
      vars: {
        "--gcs-forum-row-image": 'url("/files/bgMain")',
        "--gcs-forum-row-veil": "70%",
        "--gcs-forum-row-veil-hover": "55%",
        "--gcs-forum-row-image-light": 'url("/files/bgLight1")',
        "--gcs-forum-row-image-pos": "left",
      },
    });
  });

  test("nimic de moștenit: imagine proprie, moștenirea oprită, părinte categorie sau fără imagine", () => {
    const parent = { id: 1, type: "FORUM" as const, data: { bg: "bgMain", inherit: true } };
    expect(inheritedStyle(node({ parent, data: { bg: "own1" } }))).toBeNull();
    expect(inheritedStyle(node({ parent: { ...parent, data: { bg: "bgMain", inherit: false } } }))).toBeNull();
    expect(inheritedStyle(node({ parent: { ...parent, type: "CATEGORY" } }))).toBeNull();
    expect(inheritedStyle(node({ parent: { ...parent, data: { bg: "" } } }))).toBeNull();
    expect(inheritedStyle(node({ parent: null }))).toBeNull();
    expect(inheritedStyle(node({ parent: { ...parent, data: { bg: 'x")' } } }))).toBeNull();
  });
});

describe("Aspect forumuri: insignele subforumurilor", () => {
  const server = { serverId: 3, name: "Public 128 tick", online: true, players: 18, maxPlayers: 32 };

  test("manual ON / OFF / NOU, nimic; automat după starea serverului legat", () => {
    expect(subBadge({ badge: "on" }, undefined)).toEqual({ label: "badge.on", tone: "ok", server: null });
    expect(subBadge({ badge: "off" }, server)).toEqual({ label: "badge.off", tone: "neutral", server: null });
    expect(subBadge({ badge: "new" }, undefined)).toEqual({ label: "badge.new", tone: "accent", server: null });
    expect(subBadge({ badge: "none" }, server)).toBeNull();
    expect(subBadge({ badge: "auto" }, server)).toEqual({ label: "badge.on", tone: "ok", server });
    expect(subBadge({}, { ...server, online: false })).toEqual({ label: "badge.off", tone: "neutral", server: { ...server, online: false } });
    expect(subBadge({ badge: "auto" }, undefined)).toBeNull();
  });

  test("o singură cerere a stării: doar subforumurile pe „automat”, fără dubluri", () => {
    const nodes = [
      node({ id: 10, children: [{ id: 11, type: "FORUM", name: "a", slug: "a", data: { badge: "auto" } }, { id: 12, type: "FORUM", name: "b", slug: "b", data: { badge: "on" } }] }),
      node({ id: 20, children: [{ id: 11, type: "FORUM", name: "a", slug: "a", data: {} }, { id: 21, type: "FORUM", name: "c", slug: "c", data: { badge: "none" } }] }),
    ];
    expect(autoBadgeForums(nodes)).toEqual([11]);
  });
});
