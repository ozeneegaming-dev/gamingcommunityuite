"use client";

import { faClock, faRankingStar, faServer, faUsers } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { GcsMapPicture, mapPicture, type GcsMapPictureData } from "./GcsMapPicture";
import { matchHref } from "./types";

/** Un meci pe cardul listei (date simple, rezolvate pe server; scorul și starea se actualizează live). */
export type GcsMixCardData = {
  id: number;
  status: string;
  map: string;
  game: string;
  mapImage: GcsMapPictureData | null;
  server: { id: number; name: string };
  teams: { A: { name: string; score: number }; B: { name: string; score: number } };
  winner: string | null;
  round: number;
  startedAt: string;
  liveAt: string | null;
  endedAt: string | null;
  players: { A: number; B: number };
  avgElo: number | null;
};

/** Starea live a unui meci (evenimentul `servers:match` din camera serverului). */
type LivePayload = {
  id: number | null;
  serverId: number;
  status: string;
  map: string | null;
  round: number;
  teams: { A: { name: string; score: number }; B: { name: string; score: number } };
  players?: { team: string }[];
};

const OPEN = new Set(["warmup", "live", "halftime"]);
const POLL_MS = 15_000;
/** Reîmprospătarea listei după un meci nou / încheiat (numărătorile, ordinea, ELO-ul), adunată. */
const REFRESH_DELAY_MS = 1500;
const STORAGE_KEY = "gcs:mix-live";

type Props = {
  items: GcsMixCardData[];
  /** Serverele urmărite live (camerele `servers:{id}`): cele din filtru. */
  serverIds: number[];
  /** Momentul randării pe server (timpii relativi, fără diferențe la hidratare). */
  renderedAt: number;
  /** Tab-urile (starea, cu numărătorile) și filtrele, randate pe server (merg și fără JavaScript). */
  tabs: ReactNode;
  filters: ReactNode;
  /** Mesajul listei goale (după filtre). */
  empty: string;
};

/** Citirea / scrierea preferinței „Actualizare live” (doar comoditate: fără stocare, rămâne pornită). */
function readLivePref(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeLivePref(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Stocarea blocată: preferința ține doar pe pagină.
  }
}

/**
 * Lista meciurilor mix (`/servers/matches`, specul 2026-10-08-servere-pagini §7): blocul filtrelor (tab-urile pe stare
 * cu numărătorile, serverul, harta) cu comutatorul „Actualizare live” (pornit implicit), apoi cardurile compacte. Live:
 * camerele serverelor (`servers:match`) actualizează scorul și starea pe loc; un meci nou sau încheiat reîncarcă lista;
 * fără realtime, lista se reîmprospătează la 15 s cât timp pagina e vizibilă.
 */
export function GcsMatchFeed({ items: initial, serverIds, renderedAt, tabs, filters, empty }: Props) {
  const t = useTranslations("bridge.matches");
  const realtime = useRealtime();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [live, setLive] = useState(true);
  const [now, setNow] = useState(renderedAt);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const known = useRef(new Set(initial.map((m) => m.id)));
  /** Perechile (meci, stare) pentru care lista s-a reîncărcat deja. */
  const seen = useRef(new Set<string>());
  const key = serverIds.join(",");

  // Datele noi de la server (după reîmprospătare) înlocuiesc lista.
  useEffect(() => {
    setItems(initial);
    known.current = new Set(initial.map((m) => m.id));
  }, [initial]);

  // Preferința salvată (după hidratare, ca randarea inițială să fie aceeași pe server și în browser).
  useEffect(() => setLive(readLivePref()), []);

  // Ceasul timpilor relativi („acum 5 min”) și al duratelor.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refreshSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
  }, [router]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Realtime: camerele serverelor din filtru.
  useEffect(() => {
    if (!live || !realtime.connected || key === "") return;
    const ids = key.split(",").map(Number);
    for (const id of ids) void realtime.join(`servers:${id}`);
    const off = realtime.on("servers:match", (data) => {
      const next = data as LivePayload | null;
      // Fără id: meciul nu e încă salvat (vine un eveniment cu id când e creat).
      if (!next || typeof next !== "object" || !next.teams || !ids.includes(next.serverId) || next.id === null) return;
      // O reîncărcare pe pereche (meci, stare): heartbeat-urile repetă starea unui meci din afara listei (alt tab, altă pagină).
      const pair = `${next.id}:${next.status}`;
      const once = () => {
        if (seen.current.has(pair)) return;
        seen.current.add(pair);
        refreshSoon();
      };
      if (!known.current.has(next.id)) return once();
      setItems((prev) =>
        prev.map((m) => {
          if (m.id !== next.id) return m;
          const players = next.players ? { A: next.players.filter((p) => p.team === "A").length, B: next.players.filter((p) => p.team === "B").length } : m.players;
          return { ...m, status: next.status, round: next.round, teams: next.teams, map: next.map ?? m.map, players: players.A + players.B > 0 ? players : m.players };
        }),
      );
      // Un meci încheiat sau anulat schimbă numărătorile, ordinea filtrelor și ELO-ul: lista se reîncarcă.
      if (!OPEN.has(next.status)) once();
    });
    const offResync = realtime.on("resync", () => refreshSoon());
    return () => {
      off();
      offResync();
      for (const id of ids) realtime.leave(`servers:${id}`);
    };
    // `realtime` se schimbă doar odată cu `connected`.
  }, [live, realtime.connected, key, refreshSoon]);

  // Fără realtime: reîmprospătarea la 15 s, doar cu pagina vizibilă.
  useEffect(() => {
    if (!live || realtime.connected) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [live, realtime.connected, router]);

  function toggle(on: boolean) {
    setLive(on);
    writeLivePref(on);
    // Repornită: lista se aduce la zi imediat.
    if (on) router.refresh();
  }

  return (
    <>
      <section className="gcs-card gcs-mixFilters" aria-label={t("filtersLabel")} data-testid="gcs-mix-filters">
        <div className="gcs-mixFilters__top">
          {tabs}
          <label className="gcs-mixLive" data-on={live ? "" : undefined}>
            <input type="checkbox" role="switch" className="gcs-switch" checked={live} onChange={(e) => toggle(e.target.checked)} data-testid="gcs-mix-live" />
            <span className="gcs-mixLive__label">{t("liveUpdates")}</span>
            <span className="gcs-mixLive__state" data-testid="gcs-mix-live-state">
              {!live ? t("liveOff") : realtime.connected ? t("liveRealtime") : t("livePolling")}
            </span>
          </label>
        </div>
        {filters}
      </section>
      {items.length === 0 ? (
        <p className="gcs-card gcs-emptyState gcs-mixEmpty" data-testid="gcs-matches-empty">
          {empty}
        </p>
      ) : (
        <ul className="gcs-mixGrid" data-testid="gcs-mix-grid">
          {items.map((m) => (
            <GcsMixCard key={m.id} match={m} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}

/** Durata: de la începutul jocului (după încălzire) până la final sau acum. */
function durationMinutes(m: GcsMixCardData, now: number): number | null {
  const from = Date.parse(m.liveAt ?? m.startedAt);
  const to = m.endedAt ? Date.parse(m.endedAt) : OPEN.has(m.status) ? now : null;
  if (!Number.isFinite(from) || to === null) return null;
  return Math.max(0, Math.floor((to - from) / 60_000));
}

/**
 * Cardul compact al unui meci: imaginea hărții (cu numele ei), starea (live cu punctul pulsând sau terminat cu timpul
 * relativ) și formatul, echipele cu scorul mare în culorile echipelor, apoi serverul, ELO-ul mediu și durata. Tot cardul
 * duce la pagina meciului printr-o singură legătură (numele echipelor și scorul), întinsă peste card.
 */
function GcsMixCard({ match: m, now }: { match: GcsMixCardData; now: number }) {
  const t = useTranslations("bridge.matches");
  const tm = useTranslations("bridge.match");
  const td = useTranslations("bridge.duration");
  const format = useFormatter();
  const open = OPEN.has(m.status);
  const minutes = durationMinutes(m, now);
  const mode = m.players.A + m.players.B > 0 ? t("mode", { a: m.players.A, b: m.players.B }) : null;
  const picture = m.map ? mapPicture(m.game, m.map, m.mapImage) : null;
  const finishedAt = m.endedAt ?? m.startedAt;
  const headingId = `gcs-mix-${m.id}`;
  return (
    <li>
      <article className="gcs-mixCard" data-status={m.status} data-testid="gcs-mix-card" data-match={m.id} aria-labelledby={headingId}>
        <div className="gcs-mixCard__media">
          {picture ? <GcsMapPicture className="gcs-mixCard__map" image={picture} /> : <span className="gcs-mixCard__map gcs-mixCard__map--none" aria-hidden="true" />}
          <span className="gcs-mixCard__status" data-status={m.status} data-testid="gcs-mix-card-status">
            {open && <span className="gcs-liveDot" aria-hidden="true" />}
            {open ? (m.status === "warmup" ? t("status.warmup") : t("statusRound", { status: t(`status.${m.status}`), round: m.round })) : t("statusAgo", { status: t(`status.${m.status}`), ago: format.relativeTime(new Date(finishedAt), now) })}
          </span>
          {mode && (
            <span className="gcs-mixCard__mode" data-testid="gcs-mix-card-mode">
              <GcsIconSvg icon={faUsers} />
              {mode}
            </span>
          )}
          {m.map && <span className="gcs-display gcs-mixCard__mapName">{m.map}</span>}
        </div>
        <div className="gcs-mixCard__body">
          <h2 id={headingId} className="gcs-mixCard__heading">
            <Link href={matchHref(m.id)} className="gcs-mixCard__link" data-testid="gcs-mix-card-link">
              <span className="gcs-mixCard__team" data-team="A" data-won={m.winner === "A" ? "" : undefined}>
                {m.teams.A.name}
              </span>
              <span className="gcs-display gcs-mixCard__score" data-testid="gcs-mix-card-score">
                <span data-team="A">{m.teams.A.score}</span>
                <span className="gcs-mixCard__sep" aria-hidden="true">
                  :
                </span>
                <span className="gcs-srOnly">{t("scoreSep")}</span>
                <span data-team="B">{m.teams.B.score}</span>
              </span>
              <span className="gcs-mixCard__team" data-team="B" data-won={m.winner === "B" ? "" : undefined}>
                {m.teams.B.name}
              </span>
            </Link>
          </h2>
          <ul className="gcs-mixCard__meta">
            <li>
              <GcsIconSvg icon={faServer} />
              <span className="gcs-srOnly">{tm("server")}</span>
              <span className="gcs-mixCard__server">{m.server.name}</span>
            </li>
            <li data-testid="gcs-mix-card-elo">
              <GcsIconSvg icon={faRankingStar} />
              {m.avgElo !== null ? t("avgElo", { elo: String(m.avgElo) }) : t("avgEloNone")}
            </li>
            {minutes !== null && (
              <li data-testid="gcs-mix-card-duration">
                <GcsIconSvg icon={faClock} />
                <span className="gcs-srOnly">{t("duration")}</span>
                {minutes >= 60 ? td("hours", { h: Math.floor(minutes / 60), m: minutes % 60 }) : td("minutes", { m: minutes })}
              </li>
            )}
          </ul>
        </div>
      </article>
    </li>
  );
}
