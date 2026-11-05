import type { GcsForumSlotContext, GcsForumSlotNode } from "@gcs/core";
import { describe, expect, test } from "vitest";
import { listStyle, resolveServer, serverForumPage, serverListSlots, serversForumExtension, serverTopicBar, shownFields } from "./forum";

const links = [
  { id: 1, forumId: 11, game: "cs2" },
  { id: 2, forumId: 12, game: "cs2" },
  { id: 3, forumId: null, game: "teamspeak" },
];

function ctx(rows = links): GcsForumSlotContext {
  const store = new Map<string, unknown>();
  return {
    db: { gameServer: { findMany: async () => rows } } as never,
    cache: { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: unknown) => void store.set(k, v) } as never,
    actor: { userId: null, groupIds: [], ip: null } as never,
    locale: "ro",
    surface: "index",
  };
}

const node = (id: number, data: Record<string, unknown> = {}, extra: Partial<GcsForumSlotNode> = {}): GcsForumSlotNode => ({ id, type: "FORUM", parentId: 100, name: `F${id}`, slug: `f${id}`, data, ...extra });

describe("serverele ca forumuri: legătura forum ↔ server", () => {
  test("serverul ales în tab are prioritate; altfel serverul care are forumul; un server oprit / inexistent = niciunul", () => {
    expect(resolveServer(11, {}, links)?.id).toBe(1);
    expect(resolveServer(11, { server: "3" }, links)?.id).toBe(3);
    expect(resolveServer(11, { server: "99" }, links)).toBeNull();
    expect(resolveServer(50, { server: "x" }, links)).toBeNull();
  });

  test("valorile implicite: stil complet, toate câmpurile vizibile", () => {
    expect(listStyle({})).toBe("full");
    expect(listStyle({ style: "status" })).toBe("status");
    expect(shownFields({ map: false })).toEqual({ status: true, players: true, map: false, address: true, connect: true, top: true });
  });
});

describe("sloturile listei", () => {
  test("rândul unui forum-server: eticheta ON / OFF + bara live; „Doar ON/OFF” = fără bară; „row” oprit = nimic", async () => {
    const out = await serverListSlots(ctx(), [node(11), node(12, { style: "status" }), node(13, { server: "3", row: false })]);
    expect(out[11]?.title?.[0]).toMatchObject({ kind: "component", component: "servers.state", props: { serverId: 1 } });
    expect(out[11]?.meta?.[0]).toMatchObject({ component: "servers.strip", props: { serverId: 1, style: "full" } });
    expect(out[12]?.meta).toBeUndefined();
    expect(out[12]?.title).toHaveLength(1);
    expect(out[13]).toBeUndefined();
  });

  test("forumul cu toate subforumurile servere: cipurile compacte și lista obișnuită ascunsă (clasa)", async () => {
    const parent = node(10, {}, { children: [{ id: 11, type: "FORUM", name: "Deathrun", slug: "deathrun", data: {} }, { id: 12, type: "FORUM", name: "ZP", slug: "zp", data: {} }] });
    const out = await serverListSlots(ctx(), [parent]);
    expect(out[10]?.meta?.[0]).toMatchObject({ component: "servers.chips", props: { items: [{ serverId: 1, forumId: 11, name: "Deathrun" }, { serverId: 2, forumId: 12 }] } });
    expect(out[10]?.style?.classes).toContain("gcsx-servers--chips");
  });

  test("subforumuri amestecate: doar eticheta ON / OFF lângă subforumul-server", async () => {
    const parent = node(10, {}, { children: [{ id: 11, type: "FORUM", name: "Deathrun", slug: "deathrun", data: {} }, { id: 20, type: "FORUM", name: "Reguli", slug: "reguli", data: {} }] });
    const out = await serverListSlots(ctx(), [parent]);
    expect(out[10]?.subs?.[11]?.[0]).toMatchObject({ component: "servers.state" });
    expect(out[10]?.meta).toBeUndefined();
  });

  test("banda categoriei: sumarul tuturor serverelor de sub ea (directe și din subforumuri)", async () => {
    const cat: GcsForumSlotNode = { id: 100, type: "CATEGORY", parentId: null, name: "Servere", slug: "servere", data: {} };
    const parent = node(10, {}, { children: [{ id: 12, type: "FORUM", name: "ZP", slug: "zp", data: {} }] });
    const out = await serverListSlots(ctx(), [cat, node(11), parent]);
    expect(out[100]?.header?.[0]).toMatchObject({ component: "servers.summary", props: { serverIds: [1, 2] } });
  });

  test("fără servere: nicio contribuție și nicio interogare în plus", async () => {
    expect(await serverListSlots(ctx([]), [node(11)])).toEqual({});
  });
});

describe("pagina forumului și topicurile", () => {
  test("cardul mare implicit pornit; bara din topicuri implicit oprită", async () => {
    expect(await serverForumPage(ctx(), node(11))).toMatchObject([{ component: "servers.card", props: { serverId: 1 } }]);
    expect(await serverForumPage(ctx(), node(11, { card: false }))).toBeNull();
    expect(await serverTopicBar(ctx(), node(11))).toBeNull();
    expect(await serverTopicBar(ctx(), node(11, { topic: true }))).toMatchObject([{ component: "servers.bar" }]);
  });

  test("tabul „Server”: doar la forumuri și Q&A, cu formularul desenat de componentă", () => {
    const tab = serversForumExtension.tabs![0]!;
    expect(tab).toMatchObject({ key: "server", types: ["FORUM", "QA"], component: "servers.forumTab", customForm: true });
    expect(tab.fields!.map((f) => f.key)).toEqual(["server", "style", "row", "parent", "card", "topic", "status", "players", "map", "address", "connect", "top"]);
  });
});
