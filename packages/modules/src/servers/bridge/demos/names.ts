/**
 * Numele demo-urilor și potrivirea lor cu un meci mix (specul 2026-10-08-servere-hltv §4.4). Totul e pur (fără rețea):
 * sursele (FTP / SFTP / HTTP) dau doar lista fișierelor, iar aici se alege ce aparține meciului.
 */

/** Un fișier din folderul sursei: numele, mărimea și data modificării, dacă sursa le dă. */
export type GcsRemoteDemo = { name: string; size: number | null; modifiedAt: Date | null };

/** Ce trebuie știut despre meci pentru potrivire. */
export type GcsDemoMatch = { id: number; externalId: string; map: string; startedAt: Date; liveAt: Date | null; endedAt: Date };

/** `timeZone` = fusul orar al datelor din nume; `prefix` = filtrul numelor; `delaySec` = întârzierea transmisiei. */
export type GcsDemoPickOptions = { timeZone: string; prefix: string; delaySec: number };

export type GcsParsedDemoName = {
  prefix: string;
  /** Începutul înregistrării (UTC), din nume; `null` = numele nu are dată. */
  startedAt: Date | null;
  /** Harta din numele HLTV; `null` = numele nu o are pe o poziție cunoscută. */
  map: string | null;
  /** Numele GCS (`gcs-<externalId>` sau `gcs-m<id>`), dacă e unul. */
  gcs: string | null;
};

const SAFE_NAME = /^[A-Za-z0-9_.()+-]{1,196}\.dem$/i;
const HLTV_NAME = /^(.+?)-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-([a-z0-9_.-]+)$/i;
const GCS_RCON_NAME = /^gcs-m(\d{1,10})-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-([a-z0-9_.-]+)$/i;
const DATED_NAME = /(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})?(?![0-9])/;
/** Cel mult atâtea ore între începutul fișierului și începutul jocului. */
const LOOKBACK_MS = 12 * 3_600_000;
/** Data din nume are minutul: un fișier poate începe oricând în minutul acela. */
const MINUTE_MS = 60_000;
export const MAX_DEMO_PARTS = 10;

/** Un nume simplu de demo: `*.dem`, fără căi sau caractere ciudate, max 200 de caractere. */
export function isSafeDemoName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.startsWith(".") && !/^\.+dem$/i.test(name);
}

/** Decalajul fusului orar (ms, local − UTC) la momentul dat. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return local - Math.floor(utcMs / 1000) * 1000;
}

/** Fusul orar e unul cunoscut (IANA, ex. `Europe/Bucharest`, sau `UTC`). */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Ora locală din numele unui demo (în fusul dat) → momentul UTC, cu trecerile la ora de vară. */
export function localStampToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string, second = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - zoneOffset(guess, timeZone);
  const second2 = guess - zoneOffset(first, timeZone);
  return new Date(second2);
}

/** O dată validă (luna, ziua, ora); altfel `null`. */
function stamp(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return localStampToUtc(y, mo, d, h, mi, timeZone, s);
}

/** Baza numelui GCS al unui meci (modulul CS2 al pluginului): `gcs-<externalId>`, cu `[^A-Za-z0-9_-]` → `_`. */
export function gcsDemoBase(externalId: string): string {
  return `gcs-${externalId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** Desface numele unui demo (§4.4); `null` = nume nesigur sau fără nimic recunoscut. */
export function parseDemoName(name: string, timeZone: string): GcsParsedDemoName | null {
  if (!isSafeDemoName(name)) return null;
  const base = name.slice(0, -4);
  const rcon = GCS_RCON_NAME.exec(base);
  if (rcon) {
    const startedAt = stamp(2000 + Number(rcon[2]), Number(rcon[3]), Number(rcon[4]), Number(rcon[5]), Number(rcon[6]), 0, timeZone);
    return { prefix: `gcs-m${rcon[1]}`, startedAt, map: rcon[7]!.toLowerCase(), gcs: `gcs-m${rcon[1]}` };
  }
  if (/^gcs-/i.test(base)) return { prefix: "gcs", startedAt: null, map: null, gcs: base };
  const hltv = HLTV_NAME.exec(base);
  if (hltv) {
    const startedAt = stamp(2000 + Number(hltv[2]), Number(hltv[3]), Number(hltv[4]), Number(hltv[5]), Number(hltv[6]), 0, timeZone);
    if (startedAt) return { prefix: hltv[1]!, startedAt, map: hltv[7]!.toLowerCase(), gcs: null };
  }
  const dated = DATED_NAME.exec(base);
  if (dated) {
    const startedAt = stamp(Number(dated[1]), Number(dated[2]), Number(dated[3]), Number(dated[4]), Number(dated[5]), Number(dated[6] ?? 0), timeZone);
    // Potrivirea poate începe cu separatorul dinaintea datei (`auto0-2026…`): prefixul e textul de dinaintea lui.
    if (startedAt) return { prefix: base.slice(0, dated.index), startedAt, map: null, gcs: null };
  }
  return null;
}

/** Harta meciului apare în nume ca un cuvânt (precedată de început / `-` / `_` / `.`, urmată de `-` / `.` / sfârșit). */
function nameHasMap(name: string, map: string): boolean {
  const escaped = map.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[-_.])${escaped}(?:[-.]|$)`, "i").test(name.slice(0, -4));
}

/**
 * Fișierele unui meci, în ordinea părților (§4.4): numele GCS exacte au prioritate; altfel, după hartă și fereastra
 * jocului (plus întârzierea transmisiei): ultimul fișier început până la `T0` (cel mult 12 ore înainte) și cele începute
 * după el până la `T1` (demo-urile împărțite). Fără fișier înainte de `T0`, cele începute în fereastră. Max 10 părți.
 */
export function pickDemoFiles(files: GcsRemoteDemo[], match: GcsDemoMatch, opts: GcsDemoPickOptions): GcsRemoteDemo[] {
  const delay = Math.max(0, opts.delaySec) * 1000;
  const t0 = (match.liveAt ?? match.startedAt).getTime() + delay;
  const t1 = Math.max(match.endedAt.getTime() + delay, t0);
  const map = match.map.trim().toLowerCase();
  const prefix = opts.prefix.trim();
  const parsed = files
    .filter((f) => isSafeDemoName(f.name) && (prefix === "" || f.name.startsWith(prefix)))
    .map((f) => ({ file: f, info: parseDemoName(f.name, opts.timeZone) }))
    .filter((x): x is { file: GcsRemoteDemo; info: GcsParsedDemoName } => x.info !== null);

  // 1. Numele GCS: modulul CS2 (`gcs-<externalId>…`) sau rcon-ul HLTV (`gcs-m<id>-…`).
  const own = gcsDemoBase(match.externalId).toLowerCase();
  const exact = parsed.filter((x) => {
    const base = x.file.name.slice(0, -4).toLowerCase();
    return base === own || base.startsWith(`${own}-`) || x.info.gcs?.toLowerCase() === `gcs-m${match.id}`;
  });
  if (exact.length > 0) {
    return exact
      .sort((a, b) => (a.info.startedAt?.getTime() ?? 0) - (b.info.startedAt?.getTime() ?? 0) || a.file.name.localeCompare(b.file.name))
      .slice(0, MAX_DEMO_PARTS)
      .map((x) => x.file);
  }

  // 2. După hartă și fereastră.
  const candidates = parsed
    .filter((x) => x.info.gcs === null && x.info.startedAt !== null)
    .filter((x) => map === "" || (x.info.map !== null ? x.info.map === map : nameHasMap(x.file.name, map)))
    .filter((x) => x.file.modifiedAt === null || x.file.modifiedAt.getTime() >= t0 - MINUTE_MS)
    .map((x) => ({ file: x.file, at: x.info.startedAt!.getTime() }))
    .filter((x) => x.at <= t1 && x.at >= t0 - LOOKBACK_MS)
    .sort((a, b) => a.at - b.at || a.file.name.localeCompare(b.file.name));
  const before = candidates.filter((x) => x.at <= t0);
  const first = before.at(-1);
  const rest = candidates.filter((x) => x.at > t0);
  return [...(first ? [first] : []), ...rest].slice(0, MAX_DEMO_PARTS).map((x) => x.file);
}

/** Numele descărcării: `<hartă>-<AAAA-LL-ZZ>-m<id>[-p<parte>].dem` (harta lipsă → `mix`). */
export function demoDownloadName(match: { id: number; map: string; startedAt: Date }, part: number, parts: number): string {
  const map = /^[a-z0-9_.-]{1,64}$/.test(match.map) ? match.map : "mix";
  const day = match.startedAt.toISOString().slice(0, 10);
  return `${map}-${day}-m${match.id}${parts > 1 ? `-p${part}` : ""}.dem`;
}
