"use client";

import { faRightToBracket } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { GcsCopyAddressButton } from "./GcsServerAddress";
import { GcsServerBar } from "./GcsServerGrid";
import { serverState, useServerStatus } from "./GcsServerLive";
import type { GcsServerCardData } from "./types";

function Row({ server }: { server: GcsServerCardData }) {
  const t = useTranslations("servers");
  const status = useServerStatus(server.id, server.status);
  const state = serverState(status);
  const detail = server.hasMap ? status?.map : status?.version;
  return (
    <li className="gcs-serverRow" data-state={state} data-testid="gcs-widget-server" data-server={server.id}>
      <div className="gcs-serverRow__main">
        <span className="gcs-serverRow__name">
          <span className="gcs-dot" aria-hidden="true" />
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
      <div className="gcs-serverRow__actions">
        <GcsCopyAddressButton address={server.address} compact />
        {server.connectHref && (
          <a className="gcs-iconBtn" href={server.connectHref} aria-label={`${t("connect")}: ${server.name}`} title={t("connect")}>
            <GcsIconSvg icon={faRightToBracket} />
          </a>
        )}
      </div>
      <div className="gcs-serverRow__bar">
        <GcsServerBar status={status} thin />
      </div>
    </li>
  );
}

/** Lista compactă din widget-ul „Servere”: statusul, numele, jucătorii, harta, copierea adresei și Connect. */
export function GcsServerWidgetList({ servers }: { servers: GcsServerCardData[] }) {
  return (
    <ul className="gcs-serverList">
      {servers.map((s) => (
        <Row key={s.id} server={s} />
      ))}
    </ul>
  );
}
