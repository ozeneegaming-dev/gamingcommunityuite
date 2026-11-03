import "server-only";
import { GCS_STATS_REPORTS, STATS_REPORT_APP, type GcsStatsConfig, type GcsStatsGroup, type GcsStatsReportKey } from "@gcs/modules";
import { services } from "@/lib/services";

export type GcsStatsSearch = { days?: string; from?: string; to?: string; group?: string };
export const STATS_RANGES = [7, 30, 90, 365] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Diferența fusului față de UTC (ms) într-un moment. */
function offsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - at.getTime();
}

/** Miezul nopții unei zile (`YYYY-MM-DD`) în fusul site-ului. */
function midnight(ymd: string, timeZone: string): Date {
  const guess = new Date(`${ymd}T00:00:00Z`);
  return new Date(guess.getTime() - offsetMs(guess, timeZone));
}

const today = (timeZone: string, now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Raportul cerut, dacă există și aplicația lui e pornită. */
export async function reportOf(key: string): Promise<GcsStatsReportKey | null> {
  if (!(GCS_STATS_REPORTS as readonly string[]).includes(key)) return null;
  const app = STATS_REPORT_APP[key as GcsStatsReportKey];
  if (app && !(await services().apps.enabled(app))) return null;
  return key as GcsStatsReportKey;
}

/**
 * Perioada din adresă: `days` (7 / 30 / 90 / 365) sau `from` + `to` (cel mult 2 ani), gruparea (`group`, implicit după
 * lungime: zile până la o lună, săptămâni până la 4 luni, apoi luni). Capetele sunt miezurile nopții în fusul site-ului.
 */
export function statsQuery(sp: GcsStatsSearch, cfg: GcsStatsConfig, timeZone: string, now = new Date()) {
  const custom = sp.from && sp.to && YMD.test(sp.from) && YMD.test(sp.to) && sp.from <= sp.to;
  let from: Date;
  let to: Date;
  let days: number | null;
  if (custom) {
    from = midnight(sp.from!, timeZone);
    to = new Date(midnight(sp.to!, timeZone).getTime() + DAY_MS);
    if (to.getTime() - from.getTime() > 731 * DAY_MS) from = new Date(to.getTime() - 731 * DAY_MS);
    days = null;
  } else {
    const d = Number(sp.days);
    days = (STATS_RANGES as readonly number[]).includes(d) ? d : cfg.defaultDays;
    to = new Date(midnight(today(timeZone, now), timeZone).getTime() + DAY_MS);
    from = new Date(to.getTime() - days * DAY_MS);
  }
  const span = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  const group: GcsStatsGroup = sp.group === "day" || sp.group === "week" || sp.group === "month" ? sp.group : span <= 31 ? "day" : span <= 120 ? "week" : "month";
  return { from, to, group, days, custom: Boolean(custom) };
}
