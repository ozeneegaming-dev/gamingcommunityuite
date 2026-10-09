import { beforeEach, describe, expect, test, vi } from "vitest";

// Sugestiile @mențiunilor, cu actorul și serviciile înlocuite (căutarea: `GcsMentionQueries`, testată în @gcs/modules).
const mocks = vi.hoisted(() => ({
  actor: { userId: "u1" as string | null, groupIds: [5], primaryGroupId: 5, isBanned: false, ip: "1.1.1.1" },
  users: vi.fn(),
  groups: vi.fn(),
  tagsFor: vi.fn(),
  allowed: true,
}));
vi.mock("@/lib/actor", () => ({ currentActor: async () => mocks.actor }));
vi.mock("@/lib/services", () => ({
  services: () => ({
    rateLimiter: { consume: async () => ({ allowed: mocks.allowed, retryAfter: mocks.allowed ? null : 30 }) },
    mentionQueries: { users: mocks.users, groups: mocks.groups },
    clanQueries: { tagsFor: mocks.tagsFor },
  }),
}));

const { GET } = await import("./route");
const call = (qs: string) => GET(new Request(`http://x/api/forums/mentions?${qs}`));

const ana = { id: "a1", name: "Ana", image: "/files/av", groupKey: "member", nameKey: "member", frameKey: null, online: true };

beforeEach(() => {
  mocks.actor.userId = "u1";
  mocks.allowed = true;
  mocks.users.mockReset().mockResolvedValue([ana]);
  mocks.groups.mockReset().mockResolvedValue([{ id: 5, key: "moderator", name: "Moderator", color: "#5EA2FF", icon: "fa-solid fa-shield" }]);
  mocks.tagsFor.mockReset().mockResolvedValue(new Map([["a1", { tag: "AAA", name: "Alfa", color: "#D62839", color2: "#1B1E26", ink: "#FFFFFF", href: "/clans/1", id: 1, logoUrl: null, role: "MEMBER" }]]));
});

describe("GET /api/forums/mentions", () => {
  test("membrii cu avatar, stil, online și tagul clanului; grupurile doar cu `groups=1`", async () => {
    const body = await (await call("q=an&groups=1")).json();
    expect(body.users).toEqual([{ id: "a1", name: "Ana", image: "/files/av", nameKey: "member", online: true, clan: { tag: "AAA", name: "Alfa", color: "#D62839", color2: "#1B1E26", ink: "#FFFFFF" } }]);
    expect(body.groups).toEqual([{ id: 5, name: "Moderator", color: "#5EA2FF", icon: expect.objectContaining({ path: expect.any(String) }) }]);
    expect(mocks.groups).toHaveBeenCalledWith(mocks.actor, "an");
    expect(mocks.tagsFor).toHaveBeenCalledWith(["a1"], "hovercard");

    // Celelalte câmpuri cu sugestii (destinatari, ignorați) nu cer grupuri.
    mocks.groups.mockClear();
    expect((await (await call("q=an")).json()).groups).toEqual([]);
    expect(mocks.groups).not.toHaveBeenCalled();
  });

  test("vizitatorii primesc 401; peste limită, 429", async () => {
    mocks.actor.userId = null;
    expect((await call("q=an")).status).toBe(401);
    mocks.actor.userId = "u1";
    mocks.allowed = false;
    expect((await call("q=an")).status).toBe(429);
    expect(mocks.users).not.toHaveBeenCalled();
  });
});
