import { describe, expect, test } from "vitest";
import { EMPTY_SUMMARY, liveBadge, megaFooter, occupancy, pickPlayNow, type GcsLiveSummary } from "./live-summary";

const s: GcsLiveSummary = {
  servers: { enabled: true, online: 5, total: 6, players: 66, slots: 120 },
  liveMatches: 2,
  members: { total: 1284, online: 38 },
  chatOnline: 24,
  vip: true,
};

describe("insignele live din mega meniuri", () => {
  test("chat, servere, meciuri mix și membrii online", () => {
    expect(liveBadge("/chat", s)).toEqual({ kind: "online", count: 24 });
    expect(liveBadge("/servers", s)).toEqual({ kind: "online", count: 5 });
    expect(liveBadge("/servers/matches", s)).toEqual({ kind: "live", count: 2 });
    expect(liveBadge("/members?online=1", s)).toEqual({ kind: "online", count: 38 });
    expect(liveBadge("/members", s)).toBeNull();
    expect(liveBadge("/servers/matches", { ...s, liveMatches: 0 })).toBeNull();
    expect(liveBadge("/chat", EMPTY_SUMMARY)).toBeNull();
  });

  test("rândul de jos: servere (cu „Joacă acum”), comunitate sau VIP, după itemii meniului", () => {
    expect(megaFooter([{ href: "/servers" }, { href: "/servers/matches" }], s)).toEqual({ kind: "servers", servers: 5, players: 66, cta: { href: "/servers", play: true } });
    expect(megaFooter([{ href: "/members" }, { href: "/staff" }], s)).toEqual({ kind: "community", members: 1284, online: 38, cta: { href: "/members?online=1" } });
    expect(megaFooter([{ href: "/vip" }], s)).toEqual({ kind: "vip", cta: { href: "/vip" } });
    expect(megaFooter([{ href: "https://discord.gg/x" }], s)).toBeNull();
    expect(megaFooter([{ href: "/servers" }], { ...s, servers: { ...s.servers, enabled: false } })).toBeNull();
  });
});

describe("„Joacă acum” și benzile serverelor", () => {
  const srv = (id: number, players: number, max: number, extra: Partial<{ online: boolean; connectHref: string | null }> = {}) => ({
    id,
    name: `S${id}`,
    connectHref: "steam://connect/1.2.3.4:27015",
    online: true,
    players,
    maxPlayers: max,
    ...extra,
  });
  test("cel mai plin server care mai are loc; fără locuri sau fără conectare nu se alege", () => {
    expect(pickPlayNow([srv(1, 4, 12), srv(2, 19, 32), srv(3, 10, 10)])?.id).toBe(2);
    expect(pickPlayNow([srv(1, 4, 12, { connectHref: null }), srv(2, 1, 10, { online: false })])).toBeNull();
    expect(pickPlayNow([])).toBeNull();
  });
  test("ocuparea", () => {
    expect(occupancy(19, 32)).toEqual({ percent: 59, tone: "ok" });
    expect(occupancy(9, 10)).toEqual({ percent: 90, tone: "warm" });
    expect(occupancy(10, 10)).toEqual({ percent: 100, tone: "full" });
    expect(occupancy(0, 0)).toEqual({ percent: 0, tone: "off" });
  });
});
