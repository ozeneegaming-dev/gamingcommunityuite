import { GcsQueryFailure } from "./reader";

/**
 * Interogarea TeamSpeak 3 (documentația publică ServerQuery): textul liniilor, escaparea valorilor și citirea
 * răspunsurilor. Totul e pur (fără rețea); transportul e în `query.ts` (ServerQuery pe TCP sau WebQuery pe HTTP).
 */

/** Răspunsul unui ServerQuery are cel mult atâția octeți (`clientlist` pe un server plin are câteva zeci de KB). */
export const TS_MAX_BYTES = 512 * 1024;
/** Câte nume de utilizatori se păstrează din `clientlist`. */
const MAX_CLIENTS = 128;

const ESCAPES: [string, string][] = [
  ["\\", "\\\\"],
  ["/", "\\/"],
  [" ", "\\s"],
  ["|", "\\p"],
  ["\u0007", "\\a"],
  ["\b", "\\b"],
  ["\f", "\\f"],
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
  ["\u000B", "\\v"],
];

/** Escaparea unei valori ServerQuery (spațiile, barele și caracterele de control nu mai pot începe o comandă nouă). */
export function tsEscape(value: string): string {
  let out = "";
  for (const ch of value) out += ESCAPES.find(([c]) => c === ch)?.[1] ?? ch;
  return out;
}

/** Inversul lui `tsEscape`. */
export function tsUnescape(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => {
    const hit = ESCAPES.find(([, e]) => e === `\\${c}`);
    return hit ? hit[0] : c;
  });
}

/** O linie de răspuns (`a=1 b=x|a=2 b=y`) în înregistrări cu chei și valori. */
export function tsParseRecords(line: string): Record<string, string>[] {
  if (line.trim() === "") return [];
  return line
    .trim()
    .split("|")
    .map((entry) => {
      const rec: Record<string, string> = {};
      for (const part of entry.split(" ")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        if (eq === -1) rec[part] = "";
        else rec[part.slice(0, eq)] = tsUnescape(part.slice(eq + 1));
      }
      return rec;
    });
}

/** Linia de stare `error id=0 msg=ok`: codul (0 = reușit) și mesajul. */
export function tsParseError(line: string): { id: number; msg: string } | null {
  if (!line.startsWith("error ")) return null;
  const rec = tsParseRecords(line.slice(6))[0] ?? {};
  const id = Number(rec.id);
  return Number.isInteger(id) ? { id, msg: rec.msg ?? "" } : null;
}

/** Codurile TeamSpeak care înseamnă „cont sau permisiune greșită”: 520 (login greșit), 2568 (permisiune lipsă). */
const AUTH_ERRORS = new Set([520, 2568]);

/** O eroare ServerQuery în codul interogării: login / permisiune → `auth_failed`, server inexistent → `not_found`. */
export function tsFailure(error: { id: number }): GcsQueryFailure {
  if (AUTH_ERRORS.has(error.id)) return new GcsQueryFailure("auth_failed");
  if (error.id === 1024 || error.id === 1033) return new GcsQueryFailure("not_found");
  return new GcsQueryFailure("invalid_response");
}

export type GcsTsInfo = { name: string; version: string; clients: number; maxClients: number; channels: number; names: string[] | null };

const count = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 1_000_000) : 0;
};

/**
 * Starea serverului din `serverinfo` (și numele din `clientlist`, dacă a venit): utilizatorii online fără clienții de
 * interogare (`virtualserver_queryclientsonline`, ca în clientul TeamSpeak), sloturile, canalele, numele și versiunea.
 */
export function tsServerInfo(info: Record<string, string>, clients: Record<string, string>[] | null): GcsTsInfo {
  const online = count(info.virtualserver_clientsonline);
  const query = count(info.virtualserver_queryclientsonline);
  const names = clients
    ? clients
        .filter((c) => c.client_type === undefined || c.client_type === "0")
        .map((c) => c.client_nickname ?? "")
        .filter((n) => n !== "")
        .slice(0, MAX_CLIENTS)
    : null;
  return {
    name: info.virtualserver_name ?? "",
    version: (info.virtualserver_version ?? "").split(" ")[0] ?? "",
    clients: Math.max(0, online - query),
    maxClients: count(info.virtualserver_maxclients),
    channels: count(info.virtualserver_channelsonline),
    names,
  };
}

/**
 * Răspunsul JSON al WebQuery (`{ body: [...], status: { code, message } }`): înregistrările sau eroarea interogării.
 * Valorile vin ca text, la fel ca în ServerQuery.
 */
export function tsWebBody(json: unknown): Record<string, string>[] {
  if (!json || typeof json !== "object") throw new GcsQueryFailure("invalid_response");
  const status = (json as { status?: { code?: unknown } }).status;
  const code = typeof status?.code === "number" ? status.code : 0;
  if (code !== 0) throw tsFailure({ id: code });
  const body = (json as { body?: unknown }).body;
  if (!Array.isArray(body)) throw new GcsQueryFailure("invalid_response");
  return body.filter((r): r is Record<string, unknown> => !!r && typeof r === "object").map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")])));
}

/**
 * Cititorul răspunsurilor ServerQuery pe TCP: adună liniile (`\n\r`), sare peste bannerul de început (`TS3`,
 * `Welcome…`) și dă, la fiecare `error id=…`, liniile de date dinaintea lui.
 */
export class GcsTsLineReader {
  private buffer = "";
  private bytes = 0;
  private data: string[] = [];
  private readonly done: { error: { id: number; msg: string }; lines: string[] }[] = [];

  push(chunk: Buffer): void {
    this.bytes += chunk.length;
    if (this.bytes > TS_MAX_BYTES) throw new GcsQueryFailure("too_large");
    this.buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).replace(/\r/g, "");
      this.buffer = this.buffer.slice(nl + 1);
      if (line === "" || line === "TS3" || line.startsWith("Welcome to the TeamSpeak") || line.startsWith("TeamSpeak 3 ServerQuery")) continue;
      const error = tsParseError(line);
      if (error) {
        this.done.push({ error, lines: this.data });
        this.data = [];
      } else if (line.startsWith("notify")) {
        // Notificările nu țin de comenzile noastre.
      } else {
        this.data.push(line);
      }
    }
  }

  /** Bannerul a venit (primul rând `TS3`): serverul e un ServerQuery TeamSpeak. */
  get greeted(): boolean {
    return this.bytes > 0;
  }

  /** Răspunsul următor gata (în ordinea comenzilor), sau `null`. */
  shift(): { error: { id: number; msg: string }; lines: string[] } | null {
    return this.done.shift() ?? null;
  }
}
