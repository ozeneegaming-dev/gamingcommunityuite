"use client";

import { faRightToBracket } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { GcsCopyAddressButton, GcsServerAddress } from "./GcsServerAddress";
import { serverState, useServerStatus, useServerStatuses } from "./GcsServerLive";
import { fillPercent, type GcsServerCardData } from "./types";

/** Eticheta de status de pe banner: punctul și textul (culoarea nu e niciodată singură). */
export function GcsServerStatusBadge({ state }: { state: "online" | "offline" | "unknown" }) {
  const t = useTranslations("servers.status");
  return (
    <span className="gcs-serverStatus" data-state={state} data-testid="gcs-server-status">
      <span className="gcs-dot" aria-hidden="true" />
      {t(state)}
    </span>
  );
}

/** Bara de umplere a sloturilor (jucători / sloturi). */
export function GcsServerBar({ status, thin = false }: { status: GcsServerCardData["status"]; thin?: boolean }) {
  const t = useTranslations("servers");
  const pct = fillPercent(status);
  return (
    <div
      className={`gcs-serverBar${thin ? " gcs-serverBar--thin" : ""}`}
      data-state={serverState(status)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={t("capacity", { value: `${pct}%` })}
      style={{ "--gcs-fill": `${pct}%` } as CSSProperties}
    >
      <div className="gcs-serverBar__fill" />
    </div>
  );
}

/** Bannerul: imaginea încărcată sau degradeul jocului, cu eticheta jocului (și statusul, pe carduri). */
export function GcsServerBanner({ server, hero = false, state }: { server: GcsServerCardData; hero?: boolean; state?: "online" | "offline" | "unknown" }) {
  return (
    <div className={`gcs-serverBanner${hero ? " gcs-serverBanner--hero" : ""}`} style={{ "--gcs-server-banner": server.bannerGradient } as CSSProperties}>
      {server.bannerUrl && <img className="gcs-serverBanner__img" src={server.bannerUrl} alt="" loading={hero ? "eager" : "lazy"} />}
      <span className="gcs-serverGame">
        {server.gameIcon && <GcsIconSvg icon={server.gameIcon} />}
        {server.gameName}
      </span>
      {state && <GcsServerStatusBadge state={state} />}
    </div>
  );
}

function GcsServerCard({ server }: { server: GcsServerCardData }) {
  const t = useTranslations("servers");
  const format = useFormatter();
  const status = useServerStatus(server.id, server.status);
  const state = serverState(status);
  const headingId = `gcs-server-${server.id}`;
  const detail = server.hasMap ? status?.map : status?.version;
  return (
    <li>
      <article className="gcs-card gcs-serverCard" aria-labelledby={headingId} data-testid="gcs-server-card" data-server={server.id} data-state={state}>
        <GcsServerBanner server={server} state={state} />
        <header className="gcs-serverCard__head">
          <h2 id={headingId} className="gcs-display gcs-serverCard__name">
            <Link href={server.href}>{server.name}</Link>
          </h2>
          <span className="gcs-serverCard__map" data-testid="gcs-server-map">
            {state === "online" && detail ? detail : state === "unknown" ? t("unknownStatus") : t("status.offline")}
          </span>
        </header>
        <div className="gcs-serverCard__body">
          <div className="gcs-serverCard__players">
            <strong data-testid="gcs-server-players">{status?.online ? t("players", { players: status.players, max: status.maxPlayers }) : t("playersZero")}</strong>
            {server.uptime30 !== null && <span className="gcs-serverCard__uptime">{t("uptime", { value: format.number(server.uptime30, { style: "percent", maximumFractionDigits: 1 }) })}</span>}
          </div>
          <GcsServerBar status={status} />
          {/* Jocurile fără Connect (Minecraft): acțiunea principală e chiar copierea, deci banda nu mai are butonul ei. */}
          <GcsServerAddress address={server.address} copy={server.connectHref !== null} />
          <div className="gcs-serverCard__actions">
            {server.connectHref ? (
              <a className="gcs-btn gcs-btn--primary" href={server.connectHref} data-testid="gcs-server-connect">
                <GcsIconSvg icon={faRightToBracket} />
                {t("connect")}
              </a>
            ) : (
              <GcsCopyAddressButton address={server.address} />
            )}
            <Link className="gcs-btn gcs-btn--ghost" href={server.href} aria-label={`${t("details")}: ${server.name}`}>
              {t("details")}
            </Link>
          </div>
        </div>
      </article>
    </li>
  );
}

/** Grila de pe `/servers` (macheta aprobată): un card pe server, actualizat live. */
export function GcsServerGrid({ servers }: { servers: GcsServerCardData[] }) {
  return (
    <ul className="gcs-serverGrid" data-testid="gcs-server-grid">
      {servers.map((s) => (
        <GcsServerCard key={s.id} server={s} />
      ))}
    </ul>
  );
}

/** Sumarul din antet: jucătorii online acum, pe câte servere (live). */
export function GcsServerSummary({ ids }: { ids: number[] }) {
  const t = useTranslations("servers");
  const statuses = useServerStatuses();
  const players = ids.reduce((n, id) => n + (statuses[id]?.online ? statuses[id]!.players : 0), 0);
  return (
    <span className="gcs-serverLead__count" data-testid="gcs-servers-summary">
      {t("lead", { players, servers: ids.length })}
    </span>
  );
}

/** Statusul din antetul paginii unui server: online / offline, harta (sau versiunea), jucătorii, ping-ul. */
export function GcsServerHeadStatus({ server }: { server: GcsServerCardData }) {
  const t = useTranslations("servers");
  const status = useServerStatus(server.id, server.status);
  const state = serverState(status);
  const detail = server.hasMap ? status?.map : status?.version;
  return (
    <p className="gcs-serverHeadStatus" data-testid="gcs-server-head-status">
      <span className="gcs-serverHeadStatus__state" data-state={state}>
        <span className="gcs-dot" aria-hidden="true" />
        {state === "unknown" ? t("unknownStatus") : t(`status.${state}`)}
      </span>
      {status?.online && (
        <>
          {detail && <span>{detail}</span>}
          <span data-testid="gcs-server-head-players">{t("players", { players: status.players, max: status.maxPlayers })}</span>
          {status.ping !== null && <span>{t("pingValue", { ms: status.ping })}</span>}
        </>
      )}
    </p>
  );
}
