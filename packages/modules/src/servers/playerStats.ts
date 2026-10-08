/**
 * Statisticile de joc ale membrilor, ale aplicației Servere (specul 2026-10-08-clanuri §15, partea care privește
 * serverele): interfața de citire pe care o va implementa sistemul de statistici al serverelor comunității (pluginurile
 * de server trimit statisticile pe SteamID; un SteamID se leagă de un membru prin contul Steam conectat). Până atunci,
 * implementarea implicită nu are statistici. Alte aplicații (ex. Clanuri) doar citesc prin `GcsServerService.playerStats`,
 * și doar cu aplicația Servere activă.
 */

/** Ce cuprind statisticile: toate serverele, meciurile mix (5v5) sau un singur server (`game_servers.id`). */
export type GcsPlayerStatsScope = "all" | "mix" | number;

/** Statisticile de joc ale unui membru, adunate pe conturile lui Steam. */
export type GcsPlayerStatsAggregate = {
  kills: number;
  deaths: number;
  headshots: number;
  /** Acuratețea (0–1), dacă serverul o raportează. */
  accuracy: number | null;
  playtimeSeconds: number;
  lastSeenAt: string | null;
  lastServerId: number | null;
  /** Locul membrului în clasamentul serverului (în scope-ul unui server). */
  serverRank: number | null;
  mixPlayed: number;
  mixWon: number;
  elo: number | null;
  mvps: number;
};

/** Furnizorul statisticilor de joc (doar citire). Membrii fără statistici lipsesc din rezultat. */
export interface GcsPlayerStatsProvider {
  forUsers(userIds: string[], opts: { scope: GcsPlayerStatsScope }): Promise<Map<string, GcsPlayerStatsAggregate>>;
  /** Membrii dați care au cel puțin o identitate de joc legată (Steam sau prin cod); opțional. */
  linkedUsers?(userIds: string[]): Promise<Set<string>>;
}

/** Implementarea implicită: niciun membru nu are statistici. */
export const noPlayerStats: GcsPlayerStatsProvider = {
  forUsers: async () => new Map(),
};

/**
 * Punctul de legare al statisticilor în aplicația Servere: sistemul de statistici își înregistrează furnizorul cu
 * `use()`; cine citește (pagina clanului, clasamentul clanurilor) trece mereu prin acest obiect.
 */
export class GcsPlayerStatsHub implements GcsPlayerStatsProvider {
  private provider: GcsPlayerStatsProvider = noPlayerStats;

  use(provider: GcsPlayerStatsProvider | null): void {
    this.provider = provider ?? noPlayerStats;
  }

  /** Există un furnizor real (altul decât cel implicit)? */
  get active(): boolean {
    return this.provider !== noPlayerStats;
  }

  async forUsers(userIds: string[], opts: { scope: GcsPlayerStatsScope }): Promise<Map<string, GcsPlayerStatsAggregate>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    return this.provider.forUsers(ids, opts);
  }

  /** Membrii cu identități de joc legate (indicația „leagă-ți contul” din clanuri); fără furnizor: niciunul. */
  async linkedUsers(userIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0 || !this.provider.linkedUsers) return new Set();
    return this.provider.linkedUsers(ids);
  }
}

/** K/D: ucideri / decese (decese 0 → ucideri). */
export const kdRatio = (s: Pick<GcsPlayerStatsAggregate, "kills" | "deaths">): number => (s.deaths > 0 ? s.kills / s.deaths : s.kills);

/** Totalurile unui grup de membri (ex. un clan): sumele, K/D-ul total, procentul de headshot-uri, ELO-ul mediu. */
export type GcsGroupGameStats = {
  /** Câți membri au statistici. */
  players: number;
  kills: number;
  deaths: number;
  headshots: number;
  kd: number;
  /** Headshot-urile din ucideri (0–1). */
  headshotRate: number | null;
  accuracy: number | null;
  playtimeSeconds: number;
  mixPlayed: number;
  mixWon: number;
  /** Media ELO a membrilor care au ELO. */
  elo: number | null;
  mvps: number;
  lastSeenAt: string | null;
};

/** Totalurile statisticilor date; `null` dacă niciun membru nu are statistici. */
export function sumPlayerStats(list: GcsPlayerStatsAggregate[]): GcsGroupGameStats | null {
  if (list.length === 0) return null;
  const sum = (f: (s: GcsPlayerStatsAggregate) => number) => list.reduce((n, s) => n + f(s), 0);
  const kills = sum((s) => s.kills);
  const deaths = sum((s) => s.deaths);
  const headshots = sum((s) => s.headshots);
  const elos = list.flatMap((s) => (s.elo === null ? [] : [s.elo]));
  const accuracies = list.flatMap((s) => (s.accuracy === null ? [] : [s.accuracy]));
  const seen = list.flatMap((s) => (s.lastSeenAt ? [s.lastSeenAt] : [])).sort();
  return {
    players: list.length,
    kills,
    deaths,
    headshots,
    kd: kdRatio({ kills, deaths }),
    headshotRate: kills > 0 ? headshots / kills : null,
    accuracy: accuracies.length > 0 ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null,
    playtimeSeconds: sum((s) => s.playtimeSeconds),
    mixPlayed: sum((s) => s.mixPlayed),
    mixWon: sum((s) => s.mixWon),
    elo: elos.length > 0 ? elos.reduce((a, b) => a + b, 0) / elos.length : null,
    mvps: sum((s) => s.mvps),
    lastSeenAt: seen.at(-1) ?? null,
  };
}
