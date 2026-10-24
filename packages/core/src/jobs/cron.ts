import { createHmac, timingSafeEqual } from "node:crypto";

/** Când a rulat ultima dată cron-ul (ms), pentru pasul „Cron” al instalării și ACP. */
export const CRON_LAST_KEY = "gcs:cron:last";
/** Fără o rulare de cron de atâta timp, ediția Lite o semnalează în ACP (joburile rulează doar cât procesul trăiește). */
export const CRON_STALE_MS = 15 * 60_000;

/**
 * Tokenul adresei de cron (`/api/cron?token=…`, ediția Lite), derivat din secretul aplicației: nu se salvează nicăieri,
 * se schimbă odată cu `GCS_SECRET`.
 */
export function cronToken(secret: string): string {
  return createHmac("sha256", secret).update("gcs-cron").digest("hex").slice(0, 40);
}

export function verifyCronToken(given: unknown, secret: string): boolean {
  if (typeof given !== "string" || given.length === 0) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(cronToken(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Valorile permise ale unui câmp cron: steluța, intervale `a-b`, pași (`/n`), liste cu virgulă. */
function cronField(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range = "*", stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    const bounds = range === "*" ? [min, max] : range.split("-").map(Number);
    const lo = bounds[0]!;
    const hi = bounds[1] ?? (stepRaw === undefined ? lo : max);
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || !Number.isInteger(step) || step < 1 || lo < min || hi > max || lo > hi) {
      throw new Error(`Expresie cron invalidă: „${spec}”`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/**
 * Următorul moment (ms, la minut fix, în UTC — ca programările BullMQ fără fus orar) după `after` care se potrivește
 * expresiei cron cu 5 câmpuri (minut, oră, zi, lună, zi a săptămânii; 0 și 7 = duminică).
 */
export function nextCronTime(pattern: string, after: number): number {
  const fields = pattern.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Expresie cron invalidă: „${pattern}”`);
  const [mi, h, dom, mon, dow] = fields as [string, string, string, string, string];
  const minutes = cronField(mi, 0, 59);
  const hours = cronField(h, 0, 23);
  const days = cronField(dom, 1, 31);
  const months = cronField(mon, 1, 12);
  const weekdays = cronField(dow, 0, 7);
  if (weekdays.has(7)) weekdays.add(0);
  // Ca în cron: dacă ambele câmpuri de zi sunt restrânse, ajunge una dintre ele.
  const bothDays = dom !== "*" && dow !== "*";
  const t = new Date(Math.floor(after / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dayOk = bothDays ? days.has(t.getUTCDate()) || weekdays.has(t.getUTCDay()) : days.has(t.getUTCDate()) && weekdays.has(t.getUTCDay());
    if (months.has(t.getUTCMonth() + 1) && dayOk && hours.has(t.getUTCHours()) && minutes.has(t.getUTCMinutes())) return t.getTime();
    t.setTime(t.getTime() + 60_000);
  }
  throw new Error(`Expresia cron „${pattern}” nu se potrivește în următorul an`);
}
