"use client";

import { faChartSimple, faGamepad, faPlay } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { playersOnline, serverFill } from "@/lib/home-widgets";
import { GcsCopyAddressButton } from "./GcsServerAddress";
import { GcsServerBar } from "./GcsServerGrid";
import { serverState, useServerStatus, useServerStatuses } from "./GcsServerLive";
import { fillPercent, type GcsServerCardData } from "./types";

/** Inelul de umplere a sloturilor (procentul în mijloc, pentru cititoare un `meter`). */
function FillRing({ pct, state, label }: { pct: number; state: string; label: string }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="gcs-serverRing" data-state={state} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="gcs-serverRing__track" cx="18" cy="18" r={r} />
        <circle className="gcs-serverRing__value" cx="18" cy="18" r={r} strokeDasharray={`${(c * pct) / 100} ${c}`} />
      </svg>
      <span className="gcs-serverRing__text">{pct}%</span>
    </span>
  );
}

function Row({ server }: { server: GcsServerCardData }) {
  const t = useTranslations("servers");
  const status = useServerStatus(server.id, server.status);
  const state = serverState(status);
  const detail = server.hasMap ? status?.map : status?.version;
  const pct = fillPercent(status);
  return (
    <li className="gcs-serverRow" data-state={state} data-testid="gcs-widget-server" data-server={server.id}>
      <div className="gcs-serverRow__main">
        <span className="gcs-serverRow__name">
          <span className="gcs-dot" aria-hidden="true" />
          <span className="gcs-serverRow__game" title={server.gameName}>
            <GcsIconSvg icon={server.gameIcon ?? faGamepad} />
          </span>
          <Link href={server.href}>{server.name}</Link>
        </span>
        <span className="gcs-serverRow__meta">
          <span className="gcs-serverRow__count" data-testid="gcs-widget-server-players">
            {status?.online ? `${status.players} / ${status.maxPlayers}` : t(`status.${state}`)}
          </span>
          {status?.online && detail && <span aria-hidden="true">·</span>}
          {status?.online && detail && <span>{detail}</span>}
        </span>
      </div>
      {(server.connectHref ?? server.joinHref) && (
        <a className="gcs-serverRow__connect" href={(server.connectHref ?? server.joinHref)!} aria-label={`${t("connect")}: ${server.name}`} {...(server.joinHref?.startsWith("https://") ? { target: "_blank", rel: "noopener nofollow" } : {})}>
          {t("join")}
          <GcsIconSvg icon={faPlay} />
        </a>
      )}
      <span className="gcs-serverRow__address" title={server.address}>
        {server.address}
      </span>
      <FillRing pct={pct} state={state} label={t("capacity", { value: `${pct}%` })} />
      <div className="gcs-serverRow__actions">
        {server.address && <GcsCopyAddressButton address={server.address} compact />}
        <Link className="gcs-iconBtn" href={server.href} aria-label={`${t("details")}: ${server.name}`} title={t("details")}>
          <GcsIconSvg icon={faChartSimple} />
        </Link>
      </div>
      <div className="gcs-serverRow__bar">
        <GcsServerBar status={status} thin />
      </div>
    </li>
  );
}

/**
 * Rândul compact (coloana îngustă a primei pagini): numele, jucătorii (roșu când e plin), harta dedesubt și bara
 * subțire de ocupare; offline = estompat. Click pe nume = pagina serverului.
 */
function CompactRow({ server }: { server: GcsServerCardData }) {
  const t = useTranslations("servers");
  const status = useServerStatus(server.id, server.status);
  const state = serverState(status);
  const detail = server.hasMap ? status?.map : status?.version;
  const fill = serverFill(status);
  return (
    <li className="gcs-serverRow gcs-serverRow--compact" data-state={state} data-fill={fill} data-testid="gcs-widget-server" data-server={server.id}>
      <Link href={server.href} className="gcs-serverRow__title" title={server.name}>
        {server.name}
      </Link>
      <span className="gcs-serverRow__count" data-testid="gcs-widget-server-players">
        {status?.online ? `${status.players}/${status.maxPlayers}` : t(`status.${state}`)}
      </span>
      {status?.online && detail && <span className="gcs-serverRow__detail">{detail}</span>}
      <div className="gcs-serverRow__bar">
        <GcsServerBar status={status} thin />
      </div>
    </li>
  );
}

/** Jucătorii de pe toate serverele listei, live (în dreapta titlului widget-ului „Servere” compact). */
export function GcsServerPlayersTotal({ ids }: { ids: number[] }) {
  const t = useTranslations("widgets.home");
  const statuses = useServerStatuses();
  return <span data-testid="gcs-widget-server-total">{t("players", { count: playersOnline(ids.map((id) => statuses[id])) })}</span>;
}

/** Totalurile listei (live): serverele, jucătorii (din sloturi) și ocuparea. */
function Totals({ servers }: { servers: GcsServerCardData[] }) {
  const t = useTranslations("servers");
  const statuses = useServerStatuses();
  let players = 0;
  let slots = 0;
  for (const s of servers) {
    const live = s.id in statuses ? statuses[s.id] : s.status;
    if (live?.online) {
      players += live.players;
      slots += live.maxPlayers;
    }
  }
  const pct = slots > 0 ? Math.min(100, Math.round((players / slots) * 100)) : 0;
  return (
    <div className="gcs-serverTotals" data-testid="gcs-widget-server-totals">
      <span className="gcs-serverTotals__item">
        <strong className="gcs-serverTotals__value">{servers.length}</strong>
        {t("totals.servers", { count: servers.length })}
      </span>
      <span className="gcs-serverTotals__item">
        <strong className="gcs-serverTotals__value gcs-serverTotals__value--ok">
          {players} / {slots}
        </strong>
        {t("totals.players")}
      </span>
      <span className="gcs-serverTotals__item">
        <strong className="gcs-serverTotals__value gcs-serverTotals__value--info">{pct}%</strong>
        {t("totals.fill")}
      </span>
    </div>
  );
}

/**
 * Lista din widget-ul „Servere”: statusul, iconița jocului, numele, „Conectează-te”, adresa, inelul de ocupare,
 * jucătorii și butoanele rapide (copiere, pagina serverului), apoi rândul cu totalurile. Pe o coloană îngustă
 * (bara laterală) rândul se strânge pe două linii. Aspectul `compact`: doar numele, jucătorii și bara de ocupare
 * (totalul jucătorilor stă în dreapta titlului, vezi `GcsServerPlayersTotal`).
 */
export function GcsServerWidgetList({ servers, variant = "full" }: { servers: GcsServerCardData[]; variant?: "full" | "compact" }) {
  if (variant === "compact") {
    return (
      <div className="gcs-serverWidget gcs-serverWidget--compact">
        <ul className="gcs-serverList">
          {servers.map((s) => (
            <CompactRow key={s.id} server={s} />
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="gcs-serverWidget">
      <ul className="gcs-serverList">
        {servers.map((s) => (
          <Row key={s.id} server={s} />
        ))}
      </ul>
      <Totals servers={servers} />
    </div>
  );
}
