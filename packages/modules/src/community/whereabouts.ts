import { PRESENCE_WINDOW_MS, type GcsKv, type GcsPresenceViewer } from "@gcs/core";

const WHERE_KEY = "gcs:presence:where";
const WHERE_TIMES_KEY = "gcs:presence:where:t";
const PATH_MAX = 300;
const TITLE_MAX = 160;

/** Unde e un vizitator pe site (pagina „Cine e online”, /online). */
export type GcsWhereEntry = {
  kind: "user" | "guest";
  /** Id-ul membrului sau id-ul de prezență al vizitatorului. */
  id: string;
  path: string;
  title: string;
  ip: string | null;
  at: number;
};

/** Ce face vizitatorul, dedus din calea paginii (textul îl alege site-ul). */
export type GcsLocation =
  | { kind: "index" }
  | { kind: "topic"; id: number }
  | { kind: "forum"; id: number }
  | { kind: "profile"; ref: string }
  | { kind: "members" }
  | { kind: "staff" }
  | { kind: "online" }
  | { kind: "chat" }
  | { kind: "messages" }
  | { kind: "search" }
  | { kind: "settings" }
  | { kind: "app"; app: string }
  | { kind: "page" };

const APP_PREFIXES: [RegExp, string][] = [
  [/^\/servers(\/|$)/, "servers"],
  [/^\/clans(\/|$)/, "clans"],
  [/^\/vip(\/|$)/, "vip"],
  [/^\/leaderboard(\/|$)/, "leaderboard"],
  [/^\/activity(\/|$)/, "activity"],
  [/^\/p\/[a-z0-9-]+/, "plugin"],
];

/** Calea unei pagini → ce face vizitatorul (topicul X, forumul Y, profilul lui Z…). Mesajele private nu dau detalii. */
export function describeLocation(rawPath: string): GcsLocation {
  const path = (rawPath.split(/[?#]/)[0] ?? "/").replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/forum") return { kind: "index" };
  let m = /^\/topic\/(\d+)/.exec(path);
  if (m) return { kind: "topic", id: Number(m[1]) };
  m = /^\/forum\/(\d+)/.exec(path);
  if (m) return { kind: "forum", id: Number(m[1]) };
  if (path === "/members" || path.startsWith("/members/groups")) return { kind: "members" };
  m = /^\/members\/([^/]+)/.exec(path);
  if (m) return { kind: "profile", ref: decodeURIComponent(m[1]!) };
  if (path === "/staff") return { kind: "staff" };
  if (path === "/online") return { kind: "online" };
  if (path.startsWith("/chat")) return { kind: "chat" };
  if (path.startsWith("/messages")) return { kind: "messages" };
  if (path.startsWith("/search")) return { kind: "search" };
  if (path.startsWith("/settings")) return { kind: "settings" };
  for (const [re, app] of APP_PREFIXES) if (re.test(path)) return { kind: "app", app };
  return { kind: "page" };
}

/** O cale internă de pagină, curățată (fără origine, fără `//`, scurtată). */
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (raw.startsWith("/admin") || raw.startsWith("/api")) return null;
  return raw.slice(0, PATH_MAX);
}

/**
 * Locul fiecărui vizitator pe site (/online, Membri v2), în `GcsKv`: ultima pagină văzută (calea, titlul), ora și IP-ul
 * (afișat doar staff-ului). Intrările mai vechi decât fereastra de prezență (5 minute) se curăță la citire.
 */
export class GcsWhereabouts {
  constructor(private readonly deps: { kv: GcsKv }) {}

  async note(viewer: GcsPresenceViewer, input: { path: string; title: string; ip: string | null }, now = Date.now()): Promise<void> {
    const path = cleanPath(input.path);
    if (!path) return;
    const id = "userId" in viewer ? `u:${viewer.userId}` : `g:${viewer.guestId}`;
    const value = JSON.stringify({ p: path, t: input.title.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, TITLE_MAX), ip: input.ip, at: now });
    await this.deps.kv.hset(WHERE_KEY, { [id]: value });
    await this.deps.kv.zadd(WHERE_TIMES_KEY, now, id);
  }

  /** Cine e unde acum, cei mai recenți primii. */
  async list(now = Date.now()): Promise<GcsWhereEntry[]> {
    const { kv } = this.deps;
    const cutoff = now - PRESENCE_WINDOW_MS;
    const stale = await kv.zrangeByScore(WHERE_TIMES_KEY, -Infinity, cutoff, { maxExclusive: true });
    if (stale.length > 0) {
      await kv.hdel(WHERE_KEY, stale);
      await kv.zrem(WHERE_TIMES_KEY, stale);
    }
    const ids = await kv.zrangeByScore(WHERE_TIMES_KEY, cutoff, Infinity, { rev: true });
    if (ids.length === 0) return [];
    const values = await kv.hmget(WHERE_KEY, ids);
    const out: GcsWhereEntry[] = [];
    ids.forEach((key, i) => {
      const raw = values[i];
      if (!raw) return;
      try {
        const v = JSON.parse(raw) as { p: string; t: string; ip: string | null; at: number };
        out.push({ kind: key.startsWith("u:") ? "user" : "guest", id: key.slice(2), path: v.p, title: v.t, ip: v.ip, at: v.at });
      } catch {
        // O intrare stricată se ignoră.
      }
    });
    return out;
  }
}
