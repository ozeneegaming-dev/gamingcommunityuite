import { describe, expect, test } from "vitest";
import { foldsOnPhone, onlinePreview, PHONE_QUERY, playersOnline, serverFill } from "./home-widgets";

describe("prima pagină nouă: widget-urile din coloana îngustă", () => {
  test("pe telefon se strâng doar widget-urile coloanei din dreapta a primei pagini, în afară de servere și shoutbox", () => {
    for (const type of ["core.online", "core.ranking", "forums.recentPosts", "servers.liveMatches", "profile.recentBadges", "clans.top"]) {
      expect(foldsOnPhone("index", "sidebar", type), type).toBe(true);
    }
    expect(foldsOnPhone("index", "sidebar", "servers.list")).toBe(false);
    expect(foldsOnPhone("index", "sidebar", "chat.shoutbox")).toBe(false);
    // Zonele de sus / jos și celelalte pagini rămân ca până acum.
    expect(foldsOnPhone("index", "top", "core.online")).toBe(false);
    expect(foldsOnPhone("index", "bottom", "core.statsPanel")).toBe(false);
    expect(foldsOnPhone("forum", "sidebar", "core.online")).toBe(false);
    expect(foldsOnPhone("topic", "sidebar", "forums.recentPosts")).toBe(false);
    expect(PHONE_QUERY).toBe("(max-width: 767px)");
  });

  test("„Cine e online”: primii 5 membri și „și încă N” (inclusiv cei cu statusul ascuns)", () => {
    const members = ["a", "b", "c", "d", "e", "f", "g"];
    expect(onlinePreview(members, 14)).toEqual({ shown: ["a", "b", "c", "d", "e"], more: 9 });
    expect(onlinePreview(members.slice(0, 3), 3)).toEqual({ shown: ["a", "b", "c"], more: 0 });
    // Doar membri ascunși: niciun nume, toți la „și încă”.
    expect(onlinePreview([], 4)).toEqual({ shown: [], more: 4 });
    expect(onlinePreview(members, 7, 2)).toEqual({ shown: ["a", "b"], more: 5 });
    expect(onlinePreview(members, 0, 0)).toEqual({ shown: [], more: 0 });
  });

  test("jucătorii de pe servere: doar serverele online, fără valori stricate", () => {
    expect(playersOnline([{ online: true, players: 32 }, { online: true, players: 9 }, { online: false, players: 5 }, null, undefined])).toBe(41);
    expect(playersOnline([{ online: true, players: Number.NaN }, { online: true, players: -2 }])).toBe(0);
    expect(playersOnline([])).toBe(0);
  });

  test("starea în bara compactă: plin (roșu) la sloturi ocupate, offline fără status", () => {
    expect(serverFill({ online: true, players: 32, maxPlayers: 32 })).toBe("full");
    expect(serverFill({ online: true, players: 33, maxPlayers: 32 })).toBe("full");
    expect(serverFill({ online: true, players: 9, maxPlayers: 14 })).toBe("online");
    expect(serverFill({ online: true, players: 0, maxPlayers: 0 })).toBe("online");
    expect(serverFill({ online: false, players: 0, maxPlayers: 14 })).toBe("offline");
    expect(serverFill(null)).toBe("offline");
  });
});
