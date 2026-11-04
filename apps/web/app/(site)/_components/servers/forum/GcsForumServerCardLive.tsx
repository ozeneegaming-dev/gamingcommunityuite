"use client";

import { faRightToBracket } from "@fortawesome/free-solid-svg-icons";
import type { GcsServerFieldsShown, GcsServerPlayer } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useNow, useTranslations } from "next-intl";
import { useId, type CSSProperties } from "react";
import { GcsCopyAddressButton, GcsServerAddress } from "../GcsServerAddress";
import { GcsMapPicture, mapPicture } from "../GcsMapPicture";
import { serverState, useServerPlayers, useServerStatus } from "../GcsServerLive";
import { fillPercent, isBridgeGameKey, type GcsServerCardData } from "../types";
import { fillTone } from "./GcsForumServerLive";

/** Durata „1 h 12 m” / „58 m” din secunde. */
function duration(sec: number | null): string {
  if (sec === null || sec < 0) return "";
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${String(m % 60).padStart(2, "0")} m` : `${m} m`;
}

/** Graficul jucătorilor pe 24 h: o singură serie (media pe oră), zona cu o spălare ușoară și linia în accent. */
function Spark({ points, max, label }: { points: (number | null)[]; max: number; label: string }) {
  const id = useId().replace(/:/g, "");
  const W = 300;
  const H = 96;
  const top = Math.max(1, max, ...points.map((p) => p ?? 0));
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const xy = points.map((p, i) => [i * step, H - 4 - ((p ?? 0) / top) * (H - 12)] as const);
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className="gcsx-srvCard__spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--gcs-accent)" stopOpacity=".28" />
          <stop offset="1" stopColor="var(--gcs-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke="var(--gcs-accentInk, var(--gcs-accent))" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type Props = {
  server: GcsServerCardData;
  fields: GcsServerFieldsShown;
  /** Media jucătorilor pe fiecare oră din ultimele 24 (`null` = fără interogări). */
  history: (number | null)[];
  /** Vârful de azi (de la miezul nopții, în fusul vizitatorului). */
  peakToday: number | null;
  /** Lista jucătorilor are voie să se vadă (setarea + dreptul `servers.view_players`). */
  playersAllowed: boolean;
};

/**
 * Cardul mare din capul subforumului unui server (macheta D): harta curentă, numele și „online de”, jucătorii,
 * ocuparea, maximul de azi, adresa cu Conectează-te, graficul pe 24 h și cine e pe server acum (ucideri, timp).
 */
export function GcsForumServerCardLive({ server, fields, history, peakToday, playersAllowed }: Props) {
  const t = useTranslations("servers.forumLive");
  const ts = useTranslations("servers");
  const now = useNow({ updateInterval: 60_000 });
  const status = useServerStatus(server.id, server.status);
  const listed = useServerPlayers();
  const state = serverState(status);
  const online = state === "online";
  const pct = fillPercent(status);
  const map = online && status?.map ? status.map : null;
  const players: GcsServerPlayer[] = playersAllowed && online && listed ? [...listed].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : [];
  const top = players.slice(0, 5);
  // „Online de 6 zile” (macheta D): durata de la pornire, în cea mai mare unitate întreagă.
  const upMin = online && status?.onlineSince ? Math.max(0, Math.floor((now.getTime() - Date.parse(status.onlineSince)) / 60_000)) : null;
  const since = upMin === null ? null : upMin >= 1440 ? t("upDays", { count: Math.floor(upMin / 1440) }) : upMin >= 60 ? t("upHours", { count: Math.floor(upMin / 60) }) : t("upMinutes", { count: Math.max(1, upMin) });
  const countLabel = server.kind === "voice" ? t("users") : server.kind === "community" ? t("membersOnline") : t("players");
  return (
    <section className="gcs-card gcsx-srvCard" data-state={state} data-testid="gcs-forum-server-card" data-server={server.id}>
      <div className="gcsx-srvCard__map" style={{ "--gcs-server-banner": server.bannerGradient } as CSSProperties}>
        {server.bannerUrl ? <img src={server.bannerUrl} alt="" /> : map && isBridgeGameKey(server.game) ? <GcsMapPicture key={map} image={mapPicture(server.game, map, server.mapImage)} eager frame /> : null}
        {server.hasMap && map && (
          <span className="gcsx-srvCard__mapName">
            <span>{t("currentMap")}</span>
            <strong>{map}</strong>
          </span>
        )}
      </div>

      <div className="gcsx-srvCard__main">
        <div className="gcsx-srvCard__head">
          <h2 className="gcs-display gcsx-srvCard__name">
            <Link href={server.href}>{server.name}</Link>
          </h2>
          {fields.status && (
            <span className="gcsx-srvCard__sub">
              <span className="gcsx-srv__status" data-state={state}>
                <span className="gcs-dot" aria-hidden="true" />
                {online ? (since ? t("onlineSince", { since }) : ts("status.online")) : state === "offline" ? ts("status.offline") : ts("status.unknown")}
              </span>
              <span aria-hidden="true">·</span>
              <span>{server.gameName}</span>
            </span>
          )}
        </div>
        <div className="gcsx-srvCard__facts">
          {fields.players && (
            <div>
              <span className="gcsx-srv__k">{countLabel}</span>
              <strong className="gcsx-srvCard__big" data-fill={fillTone(status)}>
                {online ? status!.players : 0}
                {server.kind !== "community" && <small> / {online ? status!.maxPlayers : 0}</small>}
              </strong>
            </div>
          )}
          {fields.players && server.kind !== "community" && (
            <div className="gcsx-srvCard__occ">
              <span className="gcsx-srv__k">{t("occupancy")}</span>
              <span className="gcsx-srvCard__occRow">
                <span className="gcsx-srv__bar" data-fill={fillTone(status)} style={{ "--gcs-fill": `${pct}%` } as CSSProperties} aria-hidden="true">
                  <span />
                </span>
                <strong>{pct}%</strong>
              </span>
            </div>
          )}
          {fields.players && peakToday !== null && server.kind !== "community" && (
            <div>
              <span className="gcsx-srv__k">{t("peakToday")}</span>
              <strong>
                {peakToday} / {online ? status!.maxPlayers : peakToday}
              </strong>
            </div>
          )}
          {fields.map && !server.hasMap && online && status?.version && (
            <div>
              <span className="gcsx-srv__k">{t("version")}</span>
              <strong>{status.version}</strong>
            </div>
          )}
        </div>
        <div className="gcsx-srvCard__actions">
          {fields.address && server.address && <GcsServerAddress address={server.address} />}
          {fields.connect &&
            (server.joinHref ? (
              <a className="gcs-btn gcs-btn--primary" href={server.joinHref} {...(server.joinHref.startsWith("https://") ? { target: "_blank", rel: "noopener nofollow" } : {})}>
                <GcsIconSvg icon={faRightToBracket} />
                {ts(`joinVia.${server.game}` as never)}
              </a>
            ) : server.connectHref ? (
              <a className={`gcs-btn gcs-btn--primary${online ? "" : " gcsx-srv__go--off"}`} href={server.connectHref} data-testid="gcs-forum-server-card-connect">
                <GcsIconSvg icon={faRightToBracket} />
                {ts("connectFull")}
              </a>
            ) : server.address ? (
              <GcsCopyAddressButton address={server.address} />
            ) : null)}
        </div>
      </div>

      {fields.top && (
        <div className="gcsx-srvCard__chart">
          <span className="gcsx-srv__k">{t("last24h")}</span>
          <Spark points={history} max={online ? status!.maxPlayers : 0} label={t("last24h")} />
        </div>
      )}

      {fields.top && (
        <div className="gcsx-srvCard__now">
          <span className="gcsx-srv__k">{t("onServerNow")}</span>
          {top.length > 0 ? (
            <ol className="gcsx-srvCard__players" data-testid="gcs-forum-server-players">
              {top.map((p, i) => (
                <li key={`${p.name}-${i}`}>
                  <span className="gcsx-srvCard__rank">{i + 1}</span>
                  <span className="gcsx-srvCard__pname">{p.name}</span>
                  {p.score !== null && <span className="gcsx-srvCard__kills">{t("kills", { count: p.score })}</span>}
                  <span className="gcsx-srvCard__time">{duration(p.time)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="gcs-muted gcsx-srvCard__empty">{!playersAllowed ? t("playersHidden") : online ? t("noPlayerList") : t("nobody")}</p>
          )}
          {online && status!.players > 0 && (
            <Link href={server.href} className="gcsx-srvCard__all">
              {t("allPlayers", { count: online ? status!.players : players.length })} →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
