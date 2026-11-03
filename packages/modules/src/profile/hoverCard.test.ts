import type { GcsActor, GcsPermissionService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { describe, expect, test, vi } from "vitest";
import { eloTier, GcsHoverCardLoader, memberStatus, rankEmblemOf, type GcsMemberChip } from "./hoverCard";
import type { GcsCardView } from "./queries";

const viewer: GcsActor = { userId: "viewer00001", groupIds: [3], primaryGroupId: 3, isBanned: false, ip: "" };
const guest: GcsActor = { userId: null, groupIds: [1], primaryGroupId: 1, isBanned: false, ip: "" };

function card(patch: Partial<GcsCardView> = {}): GcsCardView {
  return {
    user: {
      id: "target00001",
      name: "BL1NG",
      image: null,
      nameKey: "admin",
      frameKey: null,
      groupKey: "admin",
      group: { name: "Admin", color: "#FF4D57" },
      slug: "bl1ng",
      bio: "",
      accentColor: null,
      cover: null,
      coverPositionY: 50,
      rank: null,
    } as GcsCardView["user"],
    stats: { posts: 120, reputation: 30, followers: 4, joinedAt: "2020-01-01T00:00:00.000Z", points: 300 },
    online: { online: true, hidden: false, lastActiveAt: "2026-10-16T10:00:00.000Z" },
    badges: [],
    fields: [],
    viewer: { isSelf: false, isFollowing: false, canMessage: true, canFollow: true },
    rankId: null,
    ...patch,
  };
}

const ladder = [
  { id: 1, name: "Recrut", position: 0, minPosts: 0, minPoints: null, minReputation: null },
  { id: 2, name: "Jucător", position: 1, minPosts: 10, minPoints: null, minReputation: null },
  { id: 3, name: "Activ", position: 2, minPosts: 50, minPoints: null, minReputation: null },
  { id: 4, name: "Veteran", position: 3, minPosts: 250, minPoints: null, minReputation: null },
];

function loader(opts: { card?: GcsCardView | null; enabled?: string[]; staff?: boolean; ignoring?: boolean } = {}) {
  const db = {
    rank: { findMany: vi.fn(async () => ladder) },
    user: { findUnique: vi.fn(async () => ({ id: "target00001", primaryGroupId: 4, groups: [] })) },
  } as unknown as PrismaClient;
  const permissions = { can: vi.fn(async () => opts.staff ?? false) } as unknown as GcsPermissionService;
  const l = new GcsHoverCardLoader({
    db,
    permissions,
    queries: { card: vi.fn(async () => (opts.card === undefined ? card() : opts.card)) },
    social: { isIgnoring: vi.fn(async () => opts.ignoring ?? false) },
    apps: { enabledFilter: async () => (key: string) => (opts.enabled ?? ["clans", "servers", "vip"]).includes(key) },
  });
  return l;
}

const clan: GcsMemberChip = { kind: "clan", tag: "GCS", name: "Fondatori", color: "#FF8A3D", href: "/clans/1-fondatori" };
const elo: GcsMemberChip = { kind: "elo", elo: 1320, tier: "platinum", href: null };
const vip: GcsMemberChip = { kind: "vip", name: "VIP Gold", color: "#FFD36A" };

describe("hover card v2: încărcarea datelor", () => {
  test("nivelul și XP-ul din scara rangurilor; linkurile profilului și ale conținutului", async () => {
    const data = await loader().load(viewer, "target00001");
    // 120 de postări: rangul „Activ” (nivelul 3), spre „Veteran” (250): (120 − 50) / 200 = 35 %.
    expect(data?.level).toEqual({ level: 3, rank: "Activ", percent: 35, next: { level: 4, name: "Veteran" }, xp: 300 });
    expect(data?.profileHref).toBe("/members/target00001-bl1ng");
    expect(data?.contentHref).toBe("/members/target00001-bl1ng?tab=activity");
    // Emblema rangului atins (plăcuța din cardul v3): insigna desenată pentru locul lui în scară.
    expect(data?.rankEmblem).toEqual({ art: expect.stringMatching(/^\/badge-art\/v1\/.+\.svg$/), image: null });
  });

  test("emblema rangului: imaginea încărcată în ACP are prioritate; fără rang (sau cu un rang șters), nimic", () => {
    const withImage = [...ladder.slice(0, 2), { ...ladder[2]!, imageAttachmentId: "rankimg1" }, ladder[3]!];
    expect(rankEmblemOf(withImage, 3)?.image).toBe("/files/rankimg1");
    expect(rankEmblemOf(ladder, 1)).toEqual({ art: expect.stringMatching(/^\/badge-art\/v1\/.+\.svg$/), image: null });
    expect(rankEmblemOf(ladder, null)).toBeNull();
    expect(rankEmblemOf(ladder, 99)).toBeNull();
  });

  test("cipurile aplicațiilor, în ordinea fixă; o aplicație oprită nu-și arată cipul; o eroare nu strică cardul", async () => {
    const l = loader({ enabled: ["clans", "vip"] });
    l.addChip({ app: "vip", load: async () => vip });
    l.addChip({ app: "servers", load: async () => elo });
    l.addChip({ app: "clans", load: async () => clan });
    l.addChip({ app: "clans", load: async () => Promise.reject(new Error("boom")) });
    const data = await l.load(viewer, "target00001");
    expect(data?.chips).toEqual([clan, vip]);
  });

  test("statusul: „Joacă pe <server>” are prioritate față de online; fără aplicația Servere, doar online", async () => {
    const playing = { serverId: 7, server: "Public #1", href: "/servers/7-public-1" };
    const on = loader();
    on.addPlaying({ app: "servers", load: async () => playing });
    expect((await on.load(viewer, "target00001"))?.status).toEqual({ kind: "playing", ...playing });
    const off = loader({ enabled: [] });
    off.addPlaying({ app: "servers", load: async () => playing });
    expect((await off.load(viewer, "target00001"))?.status).toEqual({ kind: "online" });
  });

  test("prezența ascunsă ascunde și serverul (contribuția nici nu se cere)", async () => {
    const l = loader({ card: card({ online: { online: false, hidden: true, lastActiveAt: null } }) });
    const load = vi.fn(async () => ({ serverId: 7, server: "Public #1", href: "/servers/7-public-1" }));
    l.addPlaying({ app: "servers", load });
    expect((await l.load(viewer, "target00001"))?.status).toEqual({ kind: "hidden" });
    expect(load).not.toHaveBeenCalled();
  });

  test("Ignoră: doar membrii, nu pe sine, nu staff-ul; vizitatorul nu poate ignora", async () => {
    expect((await loader({ ignoring: true }).load(viewer, "target00001"))?.viewer).toMatchObject({ isIgnored: true, canIgnore: true });
    expect((await loader({ staff: true }).load(viewer, "target00001"))?.viewer.canIgnore).toBe(false);
    expect((await loader().load(guest, "target00001"))?.viewer).toMatchObject({ isIgnored: false, canIgnore: false });
    expect((await loader({ card: card({ viewer: { isSelf: true, isFollowing: false, canMessage: false, canFollow: false } }) }).load(viewer, "target00001"))?.viewer.canIgnore).toBe(false);
  });

  test("un profil invizibil dă `null`", async () => {
    expect(await loader({ card: null }).load(viewer, "target00001")).toBeNull();
  });
});

describe("hover card v2: statusul și treptele ELO", () => {
  test("ultima vizită când nu e online; ascuns fără dată", () => {
    expect(memberStatus({ online: false, hidden: false, lastActiveAt: "2026-10-01T00:00:00.000Z" }, null)).toEqual({ kind: "lastVisit", at: "2026-10-01T00:00:00.000Z" });
    expect(memberStatus({ online: false, hidden: false, lastActiveAt: null }, null)).toEqual({ kind: "hidden" });
  });

  test("treptele ELO pe praguri", () => {
    expect([0, 799, 800, 1000, 1100, 1260, 1450, 2100].map(eloTier)).toEqual(["iron", "iron", "bronze", "silver", "gold", "platinum", "diamond", "elite"]);
  });
});
