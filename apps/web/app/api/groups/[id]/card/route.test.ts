import type { GcsGroupCard } from "@gcs/modules";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Ruta cardului unui grup, cu actorul și citirile înlocuite (logica și confidențialitatea: `GcsMentionQueries.card`).
const mocks = vi.hoisted(() => ({ card: vi.fn(), actor: { userId: "u1", groupIds: [5], primaryGroupId: 5, isBanned: false, ip: "1.1.1.1" } }));
vi.mock("@/lib/actor", () => ({ currentActor: async () => mocks.actor }));
vi.mock("@/lib/services", () => ({ services: () => ({ mentionQueries: { card: mocks.card } }) }));

const { GET } = await import("./route");
const call = (id: string) => GET(new Request(`http://x/api/groups/${id}/card`), { params: Promise.resolve({ id }) });

const card: GcsGroupCard = {
  id: 5,
  key: "moderator",
  name: "Moderator",
  title: "Echipa de moderare",
  color: "#5EA2FF",
  icon: "fa-solid fa-shield",
  banner: "linear-gradient(135deg, #D62839, #8B0F1C)",
  memberCount: 3,
  onlineCount: 1,
  members: [{ id: "m1", name: "Ana Maria", image: null, groupKey: "moderator", nameKey: "moderator", frameKey: null, online: true }],
  canListMembers: true,
};

beforeEach(() => {
  mocks.card.mockReset();
});

describe("GET /api/groups/{id}/card", () => {
  test("cardul: iconița ca date SVG, banner-ul validat, linkurile spre membri și spre lista filtrată", async () => {
    mocks.card.mockResolvedValue(card);
    const res = await call("5");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=30");
    const body = await res.json();
    expect(mocks.card).toHaveBeenCalledWith(mocks.actor, 5);
    expect(body).toMatchObject({
      group: { id: 5, key: "moderator", name: "Moderator", title: "Echipa de moderare", color: "#5EA2FF", banner: card.banner },
      memberCount: 3,
      onlineCount: 1,
      members: [{ id: "m1", name: "Ana Maria", nameKey: "moderator", href: "/members/m1-ana-maria", online: true }],
      canListMembers: true,
      href: "/members?group=5",
    });
    expect(body.group.icon).toMatchObject({ width: expect.any(Number), height: expect.any(Number), path: expect.stringMatching(/^M/) });
  });

  test("un banner nevalidat nu ajunge în răspuns; fără iconiță, iconița generică", async () => {
    mocks.card.mockResolvedValue({ ...card, banner: "url(javascript:alert(1))", icon: null });
    const body = await (await call("5")).json();
    expect(body.group.banner).toBeNull();
    expect(body.group.icon).not.toBeNull();
  });

  test("grupul care nu se expune (nementionabil, în afara legendei) sau un id invalid → 404", async () => {
    mocks.card.mockResolvedValue(null);
    expect((await call("7")).status).toBe(404);
    expect((await call("abc")).status).toBe(404);
    expect((await call("1e3")).status).toBe(404);
    expect(mocks.card).toHaveBeenCalledTimes(1);
  });
});
