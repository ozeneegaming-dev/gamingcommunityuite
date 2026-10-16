import { dayKey } from "../chat-pro/period";

/**
 * Perioadele donațiilor (obiectivele, clasamentele „lună / an / tot” și insigna „Sponsor”), după ceasul comunității
 * (`site.timezone`): o lună începe la miezul nopții din fusul orar al site-ului, nu în UTC. Zilele sunt `YYYY-MM-DD`.
 */

export type GcsDonationRangeKind = "month" | "year" | "all";
/** Un interval `[start, end)` de momente; `null` = fără limită. */
export type GcsDonationRange = { start: Date | null; end: Date | null };

export type GcsGoalPeriodInput = { period: "MONTHLY" | "CUSTOM"; startsOn: Date | string; endsOn: Date | string | null; autoRenew: boolean };
/** Perioada curentă a unui obiectiv: zilele (prima și cea de după ultima), momentele lor și starea față de acum. */
export type GcsGoalPeriod = { startDay: string; nextDay: string; start: Date; end: Date; state: "upcoming" | "active" | "ended" };

export const DONATION_RANGES: readonly GcsDonationRangeKind[] = ["month", "year", "all"];

const toDay = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** Diferența (ms) dintre ora locală din fusul dat și UTC, în momentul `at` (un fus invalid → UTC). */
function zoneOffset(at: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  } catch {
    return 0;
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** Momentul în care începe ziua `day` în fusul orar dat (ține cont de ora de vară). */
export function zonedDayStart(day: string, timeZone: string): Date {
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  const first = midnightUtc - zoneOffset(new Date(midnightUtc), timeZone);
  return new Date(midnightUtc - zoneOffset(new Date(first), timeZone));
}

/** Prima zi a lunii (sau a lunii cu `delta` luni mai târziu) zilei date. */
export function monthStartDay(day: string, delta = 0): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** Intervalul lunii / anului curent (după ceasul site-ului) sau tot timpul. */
export function donationRange(kind: GcsDonationRangeKind, now: Date, timeZone: string): GcsDonationRange {
  if (kind === "all") return { start: null, end: null };
  const today = dayKey(now, timeZone);
  if (kind === "month") return { start: zonedDayStart(monthStartDay(today), timeZone), end: zonedDayStart(monthStartDay(today, 1), timeZone) };
  const year = Number(today.slice(0, 4));
  return { start: zonedDayStart(`${year}-01-01`, timeZone), end: zonedDayStart(`${year + 1}-01-01`, timeZone) };
}

/**
 * Perioada curentă a unui obiectiv:
 * - lunar, cu reînnoire: luna de acum (de la luna de start încolo; înainte de ea, obiectivul e „în curând”);
 * - lunar, fără reînnoire: doar luna de start;
 * - interval: de la prima la ultima zi, inclusiv.
 */
export function goalPeriod(goal: GcsGoalPeriodInput, now: Date, timeZone: string): GcsGoalPeriod {
  const today = dayKey(now, timeZone);
  const startsOn = toDay(goal.startsOn);
  let startDay: string;
  let nextDay: string;
  if (goal.period === "CUSTOM") {
    startDay = startsOn;
    const last = goal.endsOn ? toDay(goal.endsOn) : startsOn;
    nextDay = new Date(Date.parse(`${last < startsOn ? startsOn : last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  } else {
    const first = monthStartDay(startsOn);
    startDay = goal.autoRenew && today >= first ? monthStartDay(today) : first;
    nextDay = monthStartDay(startDay, 1);
  }
  const state = today < startDay ? "upcoming" : today >= nextDay ? "ended" : "active";
  return { startDay, nextDay, start: zonedDayStart(startDay, timeZone), end: zonedDayStart(nextDay, timeZone), state };
}
