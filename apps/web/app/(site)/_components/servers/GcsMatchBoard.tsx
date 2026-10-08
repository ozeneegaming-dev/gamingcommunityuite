"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { mapImageHref, matchHref, playerHref } from "./types";

/** Un jucător pe tabela de scor (din starea live sau din meciul salvat). */
export type GcsBoardPlayer = {
  playerId: number | null;
  name: string;
  team: string;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  damage: number;
  mvps: number;
  eloBefore?: number | null;
  eloAfter?: number | null;
};

/** Starea afișată a unui meci mix: aceeași formă pentru meciul live (Redis) și pentru meciul salvat. */
export type GcsBoardState = {
  id: number | null;
  status: string;
  map: string | null;
  round: number;
  teams: { A: { name: string; score: number }; B: { name: string; score: number } };
  winner?: string | null;
  players: GcsBoardPlayer[];
  rounds?: { number: number; winner: string }[];
  startedAt?: string | null;
  updatedAt?: string;
};

const OPEN = new Set(["warmup", "live", "halftime"]);
const REFRESH_MS = 15_000;

type Props = {
  initial: GcsBoardState | null;
  game: string;
  server: { id: number; name: string; href: string };
  /** `match` = pagina meciului (camera `match:{id}`); `server` = pagina serverului (camera `servers:{id}`). */
  mode: "match" | "server";
};

/** Starea nouă peste cea veche: ELO-ul (doar în meciul salvat) rămâne pe jucătorii știuți. */
function merge(prev: GcsBoardState | null, next: GcsBoardState): GcsBoardState {
  const elo = new Map((prev?.players ?? []).map((p) => [p.playerId, p]));
  return {
    ...next,
    rounds: next.rounds ?? (prev?.id === next.id ? prev?.rounds : undefined),
    startedAt: next.startedAt ?? (prev?.id === next.id ? prev?.startedAt : null),
    players: next.players.map((p) => {
      const old = p.playerId === null ? undefined : elo.get(p.playerId);
      return { ...p, eloBefore: p.eloBefore ?? old?.eloBefore ?? null, eloAfter: p.eloAfter ?? old?.eloAfter ?? null };
    }),
  };
}

/**
 * Tabela de scor a unui meci mix (specul 2026-10-08-servere-pagini §7): echipele, scorul, starea și runda peste imaginea
 * hărții, banda rundelor și jucătorii fiecărei echipe. Live prin realtime (`match:state` pe pagina meciului,
 * `servers:match` pe pagina serverului); fără realtime, pagina meciului se reîmprospătează la 15 s cât timp meciul e
 * deschis, iar pagina serverului cere `/api/servers/live`. Numele vin din joc: doar text.
 */
export function GcsMatchBoard({ initial, game, server, mode }: Props) {
  const t = useTranslations("bridge.match");
  const format = useFormatter();
  const realtime = useRealtime();
  const router = useRouter();
  const [state, setState] = useState<GcsBoardState | null>(initial);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const open = state !== null && OPEN.has(state.status);
  const matchId = mode === "match" ? (initial?.id ?? null) : null;

  // Datele noi de la server (după reîmprospătare) înlocuiesc starea live.
  useEffect(() => {
    setState(initial);
  }, [initial]);

  useEffect(() => {
    if (!realtime.connected) return;
    const room = mode === "match" ? (matchId ? `match:${matchId}` : null) : `servers:${server.id}`;
    if (!room) return;
    void realtime.join(room);
    const off = realtime.on(mode === "match" ? "match:state" : "servers:match", (data) => {
      const next = data as (GcsBoardState & { serverId?: number }) | null;
      if (!next || typeof next !== "object" || !next.teams) return;
      if (mode === "match" && next.id !== matchId) return;
      if (mode === "server" && next.serverId !== server.id) return;
      setState((prev) => merge(prev, next));
      // Pagina meciului: rundele și ELO-ul vin din meciul salvat (reîmprospătarea, cu întârziere).
      if (mode === "match") {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => router.refresh(), 1500);
      }
    });
    const offResync = realtime.on("resync", () => (mode === "match" ? router.refresh() : undefined));
    return () => {
      off();
      offResync();
      // Camera serverului e și a statusului live (furnizorul serverului o părăsește el).
      if (mode === "match") realtime.leave(room);
    };
    // `realtime` se schimbă doar odată cu `connected`.
  }, [realtime.connected, mode, matchId, server.id, router]);

  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  // Fără realtime: pagina meciului se reîmprospătează cât timp meciul e deschis; pagina serverului cere starea live.
  useEffect(() => {
    if (realtime.connected) return;
    if (mode === "match" && !open) return;
    const timer = setInterval(async () => {
      if (mode === "match") return router.refresh();
      try {
        const res = await fetch(`/api/servers/live?server=${server.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const { match } = (await res.json()) as { match: GcsBoardState | null };
        setState((prev) => (match ? merge(prev, match) : prev && OPEN.has(prev.status) ? { ...prev, status: "ended" } : prev));
      } catch {
        // Rețeaua a căzut: rămâne starea de acum.
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [realtime.connected, mode, open, server.id, router]);

  if (!state) return null;
  const rounds = state.rounds ?? [];
  const label = t(`state.${state.status}`, { round: state.round });
  const teams = (["A", "B"] as const).map((team) => ({ team, info: state.teams[team], players: state.players.filter((p) => p.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths) }));
  const played = Math.max(1, rounds.length, state.teams.A.score + state.teams.B.score);
  const mapStyle = state.map ? ({ "--gcs-map-image": `url("${mapImageHref(game, state.map)}")` } as CSSProperties) : undefined;

  return (
    <div className={`gcs-matchView gcs-matchView--${mode}`} data-testid="gcs-match-board" data-status={state.status}>
      <section className="gcs-card gcs-matchBoard" aria-label={t("boardLabel", { a: state.teams.A.name, b: state.teams.B.name })}>
        <div className="gcs-matchBoard__stage" style={mapStyle}>
          {(["A", "B"] as const).map((team) => (
            <div key={team} className="gcs-matchBoard__team" data-team={team} data-won={state.winner === team ? "" : undefined}>
              <span className="gcs-matchBoard__side">
                {t(`team${team}`)}
                {state.winner === team && <span className="gcs-matchBoard__winner">{t("winner")}</span>}
              </span>
              <span className="gcs-display gcs-matchBoard__name">{state.teams[team].name}</span>
            </div>
          ))}
          <div className="gcs-matchBoard__center">
            <p className="gcs-display gcs-matchBoard__score" data-testid="gcs-match-score">
              <span data-team="A">{state.teams.A.score}</span>
              <span className="gcs-matchBoard__sep" aria-hidden="true">
                :
              </span>
              <span className="gcs-srOnly">{t("scoreSep")}</span>
              <span data-team="B">{state.teams.B.score}</span>
            </p>
            <p className="gcs-matchBoard__state" data-status={state.status} role="status" aria-live="polite">
              {OPEN.has(state.status) && <span className="gcs-liveDot" aria-hidden="true" />}
              {label}
            </p>
          </div>
        </div>
        <div className="gcs-matchBoard__meta">
          {state.map && (
            <span>
              <span className="gcs-muted">{t("map")}</span> {state.map}
            </span>
          )}
          <span>
            <span className="gcs-muted">{t("server")}</span> <Link href={server.href}>{server.name}</Link>
          </span>
          {state.startedAt && (
            <span>
              <span className="gcs-muted">{t("started")}</span> {format.dateTime(new Date(state.startedAt), { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
          {mode === "server" && state.id !== null && (
            <Link href={matchHref(state.id)} className="gcs-matchBoard__open" data-testid="gcs-live-match-link">
              {t("open")}
            </Link>
          )}
        </div>
        {rounds.length > 0 && (
          <ol className="gcs-roundStrip" aria-label={t("rounds")} data-testid="gcs-round-strip">
            {rounds.map((r) => (
              <li key={r.number} className="gcs-roundStrip__round" data-winner={r.winner} title={t("roundWon", { round: r.number, team: r.winner === "A" ? state.teams.A.name : r.winner === "B" ? state.teams.B.name : "—" })}>
                <span className="gcs-srOnly">{t("roundWon", { round: r.number, team: r.winner === "A" ? state.teams.A.name : r.winner === "B" ? state.teams.B.name : "—" })}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="gcs-matchTeams">
        {teams.map(({ team, info, players }) => (
          <section key={team} className="gcs-card gcs-matchTeam" data-team={team} aria-labelledby={`gcs-team-${mode}-${team}`}>
            <h2 id={`gcs-team-${mode}-${team}`} className="gcs-display gcs-titleBand gcs-matchTeam__title">
              <span className="gcs-matchTeam__swatch" aria-hidden="true" />
              {info.name}
              <span className="gcs-matchTeam__score">{info.score}</span>
            </h2>
            {players.length === 0 ? (
              <p className="gcs-serverNote" style={{ padding: "12px 16px" }}>
                {t("noPlayers")}
              </p>
            ) : (
              <div className="gcs-dataScroll">
                <table className="gcs-dataTable gcs-dataTable--board" data-testid={`gcs-match-team-${team}`}>
                  <thead>
                    <tr>
                      <th scope="col">{t("player")}</th>
                      <th scope="col">
                        <abbr title={t("kills")}>{t("killsShort")}</abbr>
                      </th>
                      <th scope="col">
                        <abbr title={t("deaths")}>{t("deathsShort")}</abbr>
                      </th>
                      <th scope="col">
                        <abbr title={t("assists")}>{t("assistsShort")}</abbr>
                      </th>
                      <th scope="col">{t("hs")}</th>
                      <th scope="col">
                        <abbr title={t("adrLong")}>{t("adr")}</abbr>
                      </th>
                      <th scope="col">{t("mvp")}</th>
                      {players.some((p) => p.eloAfter != null) && <th scope="col">{t("elo")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((p, i) => {
                      const delta = p.eloBefore != null && p.eloAfter != null ? p.eloAfter - p.eloBefore : null;
                      return (
                        <tr key={p.playerId ?? `n${i}`}>
                          <th scope="row">{p.playerId !== null ? <Link href={playerHref({ id: p.playerId, name: p.name })}>{p.name || `#${p.playerId}`}</Link> : p.name}</th>
                          <td>{p.kills}</td>
                          <td>{p.deaths}</td>
                          <td>{p.assists}</td>
                          <td>{p.kills > 0 ? format.number(p.headshots / p.kills, { style: "percent", maximumFractionDigits: 0 }) : "—"}</td>
                          <td>{format.number(p.damage / played, { maximumFractionDigits: 0 })}</td>
                          <td>{p.mvps}</td>
                          {players.some((x) => x.eloAfter != null) && (
                            <td>
                              {p.eloAfter != null ? (
                                <span className="gcs-eloCell">
                                  {p.eloAfter}
                                  {delta !== null && (
                                    <span className="gcs-eloDelta" data-sign={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>
                                      {delta > 0 ? `+${delta}` : delta}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
