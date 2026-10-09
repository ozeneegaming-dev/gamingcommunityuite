/**
 * Zilele și perioadele clasamentului Chat Pro. O zi e `YYYY-MM-DD` în fusul orar al site-ului (`site.timezone`), deci
 * „azi”, săptămâna și resetarea urmează ceasul comunității, nu UTC. Calculele pe zile se fac pe date UTC (fără ore).
 */

export type GcsRankingKind = "month" | "week";
export type GcsRankingPeriod = { kind: GcsRankingKind; start: string; end: string; next: string };

const DAY_MS = 86_400_000;

/** Ziua (`YYYY-MM-DD`) unui moment în fusul orar dat (un fus invalid → UTC). */
export function dayKey(at: Date, timeZone: string): string {
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  try {
    return fmt(timeZone);
  } catch {
    return fmt("UTC");
  }
}

/** Secundele trecute de la miezul nopții în fusul orar dat. */
export function secondsSinceMidnight(at: Date, timeZone: string): number {
  const parts = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  let list: Intl.DateTimeFormatPart[];
  try {
    list = parts(timeZone);
  } catch {
    list = parts("UTC");
  }
  const get = (type: string) => Number(list.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);

/** Ziua de după (sau de dinainte, cu `n` negativ). */
export function addDays(day: string, n: number): string {
  return toDay(new Date(toDate(day).getTime() + n * DAY_MS));
}

/** Zilele dintre două zile (`b - a`). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);
}

/** Ziua săptămânii, 1 = luni … 7 = duminică. */
export function isoWeekday(day: string): number {
  const w = toDate(day).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Luna care începe în ziua `resetDay` a lunii lui `day` (1–28: există în orice lună). */
function monthStart(year: number, month: number, resetDay: number): string {
  return toDay(new Date(Date.UTC(year, month, resetDay)));
}

/**
 * Perioada clasamentului care conține ziua `today`: lunară (începe în ziua `resetDay` a lunii, 1–28) sau săptămânală
 * (începe în ziua `resetDay` a săptămânii, 1 = luni). `end` e ultima zi inclusă, `next` prima zi a perioadei următoare.
 */
export function rankingPeriod(today: string, kind: GcsRankingKind, resetDay: number): GcsRankingPeriod {
  if (kind === "week") {
    const w = Math.min(7, Math.max(1, Math.trunc(resetDay) || 1));
    const start = addDays(today, -((isoWeekday(today) - w + 7) % 7));
    const next = addDays(start, 7);
    return { kind, start, end: addDays(next, -1), next };
  }
  const d = Math.min(28, Math.max(1, Math.trunc(resetDay) || 1));
  const t = toDate(today);
  const [y, m] = [t.getUTCFullYear(), t.getUTCMonth()];
  const start = t.getUTCDate() >= d ? monthStart(y, m, d) : monthStart(y, m - 1, d);
  const s = toDate(start);
  const next = monthStart(s.getUTCFullYear(), s.getUTCMonth() + 1, d);
  return { kind, start, end: addDays(next, -1), next };
}

/** Perioada dinaintea celei date. */
export function previousPeriod(p: GcsRankingPeriod, resetDay: number): GcsRankingPeriod {
  return rankingPeriod(addDays(p.start, -1), p.kind, resetDay);
}

/** Prima zi a săptămânii (luni) care conține ziua dată: statistica „săptămâna aceasta”. */
export function weekStart(day: string): string {
  return addDays(day, -(isoWeekday(day) - 1));
}
