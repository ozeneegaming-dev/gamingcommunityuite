/**
 * Rezumatul live al comunității (antetul, mega meniurile, consola Hero Cockpit): serverele online și jucătorii,
 * meciurile mix în desfășurare, membrii online, cine e în chat. Partea pură (insignele live, rândul de jos al mega
 * meniurilor, „Joacă acum”) se folosește și în browser.
 */

export type GcsLiveSummary = {
  servers: { enabled: boolean; online: number; total: number; players: number; slots: number };
  liveMatches: number;
  members: { total: number; online: number };
  /** Membrii din camerele publice de chat (`null` = aplicația Chat oprită). */
  chatOnline: number | null;
  vip: boolean;
};

export const EMPTY_SUMMARY: GcsLiveSummary = {
  servers: { enabled: false, online: 0, total: 0, players: 0, slots: 0 },
  liveMatches: 0,
  members: { total: 0, online: 0 },
  chatOnline: null,
  vip: false,
};

/** Insigna live a unui item de meniu („5 ONLINE”, „2 LIVE”), după adresa lui. */
export function liveBadge(href: string, s: GcsLiveSummary): { kind: "online" | "live"; count: number } | null {
  const path = href.split("#")[0]!;
  if (path === "/chat" && s.chatOnline) return { kind: "online", count: s.chatOnline };
  if ((path === "/servers" || path === "/servers?") && s.servers.online > 0) return { kind: "online", count: s.servers.online };
  if (path.startsWith("/servers/matches") && s.liveMatches > 0) return { kind: "live", count: s.liveMatches };
  if (path === "/members?online=1" && s.members.online > 0) return { kind: "online", count: s.members.online };
  return null;
}

export type GcsMegaFooter =
  | { kind: "servers"; servers: number; players: number; cta: { href: string; play: true } }
  | { kind: "community"; members: number; online: number; cta: { href: string } }
  | { kind: "vip"; cta: { href: string } };

const COMMUNITY = ["/members", "/staff", "/chat", "/activity", "/leaderboard", "/rules"];

/** Rândul de jos al unui mega meniu (o linie live și un îndemn), după itemii lui. */
export function megaFooter(children: readonly { href: string }[], s: GcsLiveSummary): GcsMegaFooter | null {
  const paths = children.map((c) => c.href.split(/[?#]/)[0]!);
  if (s.servers.enabled && paths.some((p) => p.startsWith("/servers") || p === "/bans")) {
    return { kind: "servers", servers: s.servers.online, players: s.servers.players, cta: { href: "/servers", play: true } };
  }
  if (paths.some((p) => COMMUNITY.includes(p))) return { kind: "community", members: s.members.total, online: s.members.online, cta: { href: "/members?online=1" } };
  if (s.vip && paths.some((p) => p.startsWith("/vip"))) return { kind: "vip", cta: { href: "/vip" } };
  return null;
}

export type GcsPlayable = { id: number; name: string; connectHref: string | null; online: boolean; players: number; maxPlayers: number };

/**
 * „Joacă acum”: un server bun pentru a intra acum. Online, cu adresă de conectare și locuri libere; câștigă cel mai
 * plin dintre cele care încă au loc (e mai multă acțiune), la egalitate primul din listă (ordinea din ACP).
 */
export function pickPlayNow(servers: readonly GcsPlayable[]): GcsPlayable | null {
  const open = servers.filter((s) => s.online && s.connectHref && s.maxPlayers > 0 && s.players < s.maxPlayers);
  if (open.length === 0) return null;
  return open.reduce((best, s) => (s.players / s.maxPlayers > best.players / best.maxPlayers ? s : best));
}

/** Gradul de ocupare (0–100) și „culoarea” benzii unui server: verde, portocaliu peste 75 %, roșu plin. */
export function occupancy(players: number, maxPlayers: number): { percent: number; tone: "ok" | "warm" | "full" | "off" } {
  if (maxPlayers <= 0) return { percent: 0, tone: "off" };
  const percent = Math.max(0, Math.min(100, Math.round((players / maxPlayers) * 100)));
  return { percent, tone: percent >= 100 ? "full" : percent >= 75 ? "warm" : "ok" };
}
