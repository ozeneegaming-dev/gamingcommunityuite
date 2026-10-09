/**
 * Panoul de căutare din antet (specul 2026-10-10-hero-cockpit §1): domeniile (doar ale aplicațiilor instalate),
 * filtrele, adresa „Căutare avansată” și căutările recente. Fără dependențe de server: se folosește și în browser.
 */

export const SEARCH_SCOPES = ["all", "topics", "posts", "members", "servers", "players", "clans"] as const;
export type GcsSearchScope = (typeof SEARCH_SCOPES)[number];
export const SEARCH_PERIODS = ["any", "day", "week", "month", "year"] as const;
export type GcsSearchPeriod = (typeof SEARCH_PERIODS)[number];

export type GcsQuickResultType = "topic" | "post" | "member" | "server" | "player" | "clan";
export type GcsQuickResult = {
  type: GcsQuickResultType;
  title: string;
  href: string;
  /** Linia mică din dreapta (forumul, harta și jucătorii, grupul…). */
  meta: string | null;
  /** Membrii: datele numelui stilizat. */
  user?: { id: string; name: string; nameKey: string };
};

export type GcsSearchFilters = { forum: number | null; author: string; period: GcsSearchPeriod; titles: boolean };
export const NO_FILTERS: GcsSearchFilters = { forum: null, author: "", period: "any", titles: false };

/** Domeniile disponibile: forumul mereu; membrii cu lista de membri; serverele, jucătorii și clanurile cu aplicațiile lor. */
export function availableScopes(can: { members: boolean; servers: boolean; players: boolean; clans: boolean }): GcsSearchScope[] {
  return SEARCH_SCOPES.filter((s) => (s === "members" ? can.members : s === "servers" ? can.servers : s === "players" ? can.players : s === "clans" ? can.clans : true));
}

const DAY = 86_400_000;
const PERIOD_DAYS: Record<Exclude<GcsSearchPeriod, "any">, number> = { day: 1, week: 7, month: 30, year: 365 };

/** Data de la care se caută (`YYYY-MM-DD`), pentru perioada aleasă. */
export function periodSince(period: GcsSearchPeriod, now = Date.now()): string | null {
  return period === "any" ? null : new Date(now - PERIOD_DAYS[period] * DAY).toISOString().slice(0, 10);
}

/** „Căutare avansată” / Enter: pagina completă a domeniului, cu termenul și filtrele. */
export function advancedSearchHref(scope: GcsSearchScope, q: string, f: GcsSearchFilters = NO_FILTERS, now = Date.now()): string {
  const term = q.trim();
  const params = new URLSearchParams();
  switch (scope) {
    case "members":
      if (term) params.set("q", term);
      return term ? `/members?${params}` : "/members";
    case "clans":
      if (term) params.set("q", term);
      return term ? `/clans?${params}` : "/clans";
    case "servers":
      return "/servers";
    case "players":
      return "/servers/leaderboard";
    default: {
      if (term) params.set("q", term);
      params.set("type", scope === "posts" && !f.titles ? "posts" : "topics");
      if (f.forum) params.set("forum", String(f.forum));
      if (f.author.trim()) params.set("author", f.author.trim());
      const since = periodSince(f.period, now);
      if (since) params.set("since", since);
      return `/search?${params}`;
    }
  }
}

/** Căutările recente (în browser, pe viewer): cea nouă prima, fără dubluri, cel mult 6. */
export function pushRecent(list: readonly string[], q: string, max = 6): string[] {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [...list];
  return [term, ...list.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, max);
}
