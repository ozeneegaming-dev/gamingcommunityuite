import { PRESENCE_WINDOW_MS } from "@gcs/core";
import { testKv } from "@gcs/core/test/kv";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanPath, describeLocation, GcsWhereabouts } from "./whereabouts";

const kv = testKv();
let where: GcsWhereabouts;

beforeEach(async () => {
  await kv.flushAll();
  where = new GcsWhereabouts({ kv });
});

afterAll(() => {
  kv.disconnect();
});

describe("locul vizitatorilor (/online)", () => {
  test("calea paginii → ce face vizitatorul", () => {
    expect(describeLocation("/")).toEqual({ kind: "index" });
    expect(describeLocation("/topic/42-salut-lume?page=2")).toEqual({ kind: "topic", id: 42 });
    expect(describeLocation("/forum/7-cs16/")).toEqual({ kind: "forum", id: 7 });
    expect(describeLocation("/members/abc123-krypt")).toEqual({ kind: "profile", ref: "abc123-krypt" });
    expect(describeLocation("/members")).toEqual({ kind: "members" });
    expect(describeLocation("/messages/12")).toEqual({ kind: "messages" });
    expect(describeLocation("/servers/3")).toEqual({ kind: "app", app: "servers" });
    expect(describeLocation("/tags/cs")).toEqual({ kind: "page" });
  });

  test("căile externe, ACP-ul și API-ul nu se notează", () => {
    expect(cleanPath("https://evil.example/x")).toBeNull();
    expect(cleanPath("//evil.example")).toBeNull();
    expect(cleanPath("/admin/members")).toBeNull();
    expect(cleanPath("/api/presence")).toBeNull();
    expect(cleanPath("/topic/1")).toBe("/topic/1");
  });

  test("ultima pagină a fiecăruia, cei mai recenți primii; intrările vechi dispar", async () => {
    const now = Date.now();
    await where.note({ userId: "u1" }, { path: "/topic/1-a", title: "Topic A", ip: "10.0.0.1" }, now - 2000);
    await where.note({ guestId: "g1" }, { path: "/", title: "Acasă", ip: "10.0.0.2" }, now - 1000);
    await where.note({ userId: "u1" }, { path: "/forum/2-b", title: "Forum\nB", ip: "10.0.0.1" }, now);
    await where.note({ userId: "old" }, { path: "/", title: "x", ip: null }, now - PRESENCE_WINDOW_MS - 1000);
    await where.note({ userId: "bad" }, { path: "https://x.ro", title: "x", ip: null }, now);

    const list = await where.list(now);
    expect(list.map((e) => [e.kind, e.id, e.path, e.title])).toEqual([
      ["user", "u1", "/forum/2-b", "Forum B"],
      ["guest", "g1", "/", "Acasă"],
    ]);
    expect(list[0]!.ip).toBe("10.0.0.1");
    expect(await kv.hmget("gcs:presence:where", ["u:old"])).toEqual([null]);
  });
});
