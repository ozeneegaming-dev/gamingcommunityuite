import type { GcsKv, GcsSettingDef, GcsSettingsService } from "@gcs/core";

/** Secțiunea ACP (ACP › Sistem › Descoperire › Căutare). */
export const SEARCH_ACP_SECTION = "system.search";
export const SEARCH_SETTING = "search.config";
/** Ultimele căutări (fără cine a căutat): termenul, câte rezultate și momentul, pentru ACP. */
export const SEARCH_LOG_KEY = "gcs:search:log";
const SEARCH_LOG_MAX = 1000;

export type GcsSearchConfig = {
  /** Vizitatorii pot căuta (altfel doar membrii). */
  guests: boolean;
  /** Lungimea minimă a termenului. */
  minLength: number;
  /** Câte căutări pe minut are un membru / IP. */
  perMinute: number;
  /** Rezultate pe pagină (0 = ca listele de topicuri, `forums.topics_per_page`). */
  perPage: number;
  /** Ce caută implicit pagina de căutare. */
  defaultType: "topics" | "posts";
  /** Doar conținutul din ultimele N zile (0 = tot). */
  maxAgeDays: number;
  /** Notează termenii căutați (anonim) pentru ACP. */
  logTerms: boolean;
};

export const DEFAULT_SEARCH: GcsSearchConfig = { guests: true, minLength: 2, perMinute: 20, perPage: 0, defaultType: "topics", maxAgeDays: 0, logTerms: true };

const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function searchConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsSearchConfig>;
  if (typeof c.guests !== "boolean" || typeof c.logTerms !== "boolean" || (c.defaultType !== "topics" && c.defaultType !== "posts")) return "invalid";
  if (!int(c.minLength, 2, 10) || !int(c.perMinute, 5, 120) || (c.perPage !== 0 && !int(c.perPage, 10, 50)) || !int(c.maxAgeDays, 0, 3650)) return "invalid_range";
  return null;
}

export const searchSetting: GcsSettingDef = { key: SEARCH_SETTING, type: "json", default: DEFAULT_SEARCH, section: "search", labelKey: "settings.search.config", validate: searchConfigError };

export async function loadSearchConfig(settings: Pick<GcsSettingsService, "get">): Promise<GcsSearchConfig> {
  const v = await settings.get<GcsSearchConfig | null>(SEARCH_SETTING).catch(() => null);
  return v && searchConfigError(v) === null ? v : DEFAULT_SEARCH;
}

export async function logSearch(kv: Pick<GcsKv, "listPush">, q: string, total: number, at = Date.now()): Promise<void> {
  await kv.listPush(SEARCH_LOG_KEY, JSON.stringify({ q: q.toLowerCase().slice(0, 100), n: total, at }), SEARCH_LOG_MAX);
}

export type GcsSearchTerm = { q: string; count: number; zero: number; lastAt: number };

/** Termenii din jurnal, cei mai căutați primii; `zero` = de câte ori n-au avut rezultate. */
export async function searchTerms(kv: Pick<GcsKv, "listRange">, sinceMs: number): Promise<{ total: number; terms: GcsSearchTerm[] }> {
  const raw = await kv.listRange(SEARCH_LOG_KEY, SEARCH_LOG_MAX).catch(() => [] as string[]);
  const by = new Map<string, GcsSearchTerm>();
  let total = 0;
  for (const line of raw) {
    let e: { q?: unknown; n?: unknown; at?: unknown };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    if (typeof e.q !== "string" || typeof e.at !== "number" || e.at < sinceMs) continue;
    total++;
    const cur = by.get(e.q) ?? { q: e.q, count: 0, zero: 0, lastAt: 0 };
    cur.count++;
    if (e.n === 0) cur.zero++;
    cur.lastAt = Math.max(cur.lastAt, e.at);
    by.set(e.q, cur);
  }
  return { total, terms: [...by.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt) };
}
