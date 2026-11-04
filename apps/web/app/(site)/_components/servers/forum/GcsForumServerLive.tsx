"use client";

import { faCheck, faCopy, faRightToBracket } from "@fortawesome/free-solid-svg-icons";
import type { GcsServerFieldsShown, GcsServerListStyle, GcsServerLive } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";
import { GcsCopyAddressButton } from "../GcsServerAddress";
import { GcsMapPicture, mapPicture } from "../GcsMapPicture";
import { serverState, useServerStatus, useServerStatuses } from "../GcsServerLive";
import { countKey, fillPercent, isBridgeGameKey, type GcsServerCardData } from "../types";

/**
 * Serverele ca forumuri (macheta `ServerForum`), partea live: eticheta ON / OFF, bara compactă a rândului, cipurile
 * subforumurilor-server, sumarul din banda categoriei și bara din topicuri. Statusul vine din `GcsServerLiveProvider`
 * (camerele realtime ale serverelor sau, fără realtime, cererea periodică), deci se schimbă fără reîncărcarea paginii.
 */

/** Cât de plin e serverul: verde, portocaliu peste 70 %, roșu când e plin (nota machetei B). */
export function fillTone(status: GcsServerLive | null): "ok" | "warm" | "full" | "off" {
  if (!status?.online) return "off";
  if (status.maxPlayers > 0 && status.players >= status.maxPlayers) return "full";
  return fillPercent(status) > 70 ? "warm" : "ok";
}

function useCopied(text: string) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setOk(true);
      setTimeout(() => setOk(false), 2000);
    } catch {
      setOk(false);
    }
  }
  return { ok, copy };
}

/** Adresa cu iconița de copiere (un singur buton, cu textul adresei). */
function AddressChip({ address }: { address: string }) {
  const t = useTranslations("servers");
  const { ok, copy } = useCopied(address);
  return (
    <button type="button" className="gcsx-srv__addr" onClick={() => void copy()} aria-label={`${t("copyAddress")}: ${address}`} data-testid="gcs-forum-server-address">
      <span>{address}</span>
      <GcsIconSvg icon={ok ? faCheck : faCopy} />
      <span role="status" className="gcs-srOnly">
        {ok ? t("copied") : ""}
      </span>
    </button>
  );
}

/** Butonul principal: Conectează-te (Steam), Intră pe TeamSpeak / Mumble / Discord sau Copiază adresa. */
function MainAction({ server, online, small = false }: { server: GcsServerCardData; online: boolean; small?: boolean }) {
  const t = useTranslations("servers");
  const cls = `gcs-btn gcs-btn--primary gcs-btn--sm gcsx-srv__go${small ? " gcsx-srv__go--small" : ""}`;
  if (server.joinHref) {
    return (
      <a className={`${cls} gcsx-srv__go--${server.game}`} href={server.joinHref} data-testid="gcs-forum-server-join" {...(server.joinHref.startsWith("https://") ? { target: "_blank", rel: "noopener nofollow" } : {})}>
        {t(`joinVia.${server.game}` as never)}
      </a>
    );
  }
  if (server.connectHref) {
    return online ? (
      <a className={cls} href={server.connectHref} data-testid="gcs-forum-server-connect">
        {!small && <GcsIconSvg icon={faRightToBracket} />}
        {t("connectFull")}
      </a>
    ) : (
      <span className={`${cls} gcsx-srv__go--off`} aria-disabled="true">
        {t("connectFull")}
      </span>
    );
  }
  return server.address ? <GcsCopyAddressButton address={server.address} variant="ghost" /> : null;
}

/** Miniatura hărții curente (doar jocurile cu hărți), peste arta jocului. */
function MapThumb({ server, status }: { server: GcsServerCardData; status: GcsServerLive | null }) {
  const map = status?.online && status.map ? status.map : null;
  return (
    <span className="gcsx-srv__thumb" style={{ "--gcs-server-banner": server.bannerGradient } as CSSProperties} data-state={serverState(status)} aria-hidden="true">
      {map && isBridgeGameKey(server.game) && <GcsMapPicture key={map} image={mapPicture(server.game, map, server.mapImage)} />}
    </span>
  );
}

/** Eticheta ON / OFF de lângă titlul forumului (și a subforumurilor din rând). */
export function GcsServerStateChip({ server }: { server: GcsServerCardData }) {
  const t = useTranslations("servers.forumLive");
  const status = useServerStatus(server.id, server.status);
  const state = serverState(status);
  return (
    <span className={`gcs-slotChip gcs-slotTone--${state === "online" ? "ok" : state === "offline" ? "danger" : "neutral"} gcsx-srv__state`} data-state={state} data-testid="gcs-forum-server-state">
      {state === "online" ? t("on") : state === "offline" ? t("off") : t("unknown")}
    </span>
  );
}

/** „Ultima dată acum 2 ore” (un server căzut), din ultima interogare reușită. */
function LastSeen({ status }: { status: GcsServerLive | null }) {
  const t = useTranslations("servers.forumLive");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  if (!status?.lastOnlineAt) return null;
  return (
    <span className="gcsx-srv__kv">
      <span className="gcsx-srv__k">{t("lastSeen")}</span>
      <strong>{format.relativeTime(new Date(status.lastOnlineAt), now)}</strong>
    </span>
  );
}

/** Bara live din rândul forumului: Complet (miniatură, bară, hartă, adresă, buton) sau Compact (o linie). */
export function GcsServerStrip({ server, style, fields }: { server: GcsServerCardData; style: GcsServerListStyle; fields: GcsServerFieldsShown }) {
  const t = useTranslations("servers.forumLive");
  const ts = useTranslations("servers");
  const status = useServerStatus(server.id, server.status);
  const state = serverState(status);
  const online = state === "online";
  const pct = fillPercent(status);
  const detail = server.hasMap ? status?.map : server.kind === "game" ? status?.version : status?.channels !== undefined && status?.channels !== null ? String(status.channels) : null;
  const detailLabel = server.hasMap ? t("map") : server.kind === "game" ? t("version") : t("channels");
  const countLabel = server.kind === "voice" ? t("users") : server.kind === "community" ? t("membersOnline") : t("players");
  const compact = style === "compact";
  return (
    <div className={`gcsx-srv${compact ? " gcsx-srv--compact" : ""}`} data-state={state} data-kind={server.kind} data-testid="gcs-forum-server-strip" data-server={server.id}>
      {!compact && server.hasMap && <MapThumb server={server} status={status} />}
      {fields.status && (
        <span className="gcsx-srv__status">
          <span className="gcs-dot" aria-hidden="true" />
          {online ? ts("status.online") : state === "offline" ? ts("status.offline") : ts("status.unknown")}
        </span>
      )}
      {online && fields.players && (
        <span className="gcsx-srv__kv">
          {!compact && <span className="gcsx-srv__k">{countLabel}</span>}
          <strong className="gcsx-srv__count" data-fill={fillTone(status)}>
            {server.kind === "community" ? status!.players : `${status!.players}/${status!.maxPlayers}`}
          </strong>
          {!compact && server.kind !== "community" && (
            <span className="gcsx-srv__bar" data-fill={fillTone(status)} style={{ "--gcs-fill": `${pct}%` } as CSSProperties} aria-hidden="true">
              <span />
            </span>
          )}
        </span>
      )}
      {online && fields.map && detail && (
        <span className="gcsx-srv__kv">
          {!compact && <span className="gcsx-srv__k">{detailLabel}</span>}
          <strong className="gcsx-srv__detail">{detail}</strong>
        </span>
      )}
      {online && server.kind === "community" && status?.players ? <span className="gcsx-srv__faces" aria-hidden="true">{["#F2B33D", "#3DDC97", "#5EA2FF", "#FF6A8A", "#B48CFF"].map((c) => <i key={c} style={{ background: c }} />)}</span> : null}
      {state === "offline" && !compact && <LastSeen status={status} />}
      {fields.address && server.address && !compact && <AddressChip address={server.address} />}
      {fields.connect && <MainAction server={server} online={online} small={compact} />}
    </div>
  );
}

/** Cipurile compacte ale subforumurilor-server pe index: numele, jucătorii și harta; click = subforumul. */
export function GcsServerChips({ items }: { items: { server: GcsServerCardData; href: string; name: string }[] }) {
  const t = useTranslations("servers.forumLive");
  const statuses = useServerStatuses();
  return (
    <ul className="gcsx-srvChips" aria-label={t("chipsLabel")} data-testid="gcs-forum-server-chips">
      {items.map(({ server, href, name }) => {
        const status = server.id in statuses ? (statuses[server.id] ?? null) : server.status;
        const state = serverState(status);
        const detail = server.hasMap ? status?.map : status?.version;
        return (
          <li key={`${server.id}-${href}`}>
            <Link href={href} className="gcsx-srvChip" data-state={state} data-testid="gcs-forum-server-chip">
              <span className="gcs-dot" aria-hidden="true" />
              <span className="gcsx-srvChip__name">{name}</span>
              {state === "online" ? (
                <>
                  <strong className="gcsx-srv__count" data-fill={fillTone(status)}>
                    {status!.players}/{status!.maxPlayers}
                  </strong>
                  {detail && <span className="gcsx-srvChip__map">{detail}</span>}
                </>
              ) : (
                <span className="gcsx-srvChip__off">{state === "offline" ? t("offline") : t("unknown")}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Banda categoriei: câte servere are și sumarul live. Doar jocuri: „36 / 58 jucători online”; cu comunicare: „41
 * jucători · 18 pe TS · 312 pe Discord” (macheta F).
 */
export function GcsServerSummary({ servers }: { servers: GcsServerCardData[] }) {
  const t = useTranslations("servers.forumLive");
  const statuses = useServerStatuses();
  const live = servers.map((s) => ({ s, st: s.id in statuses ? (statuses[s.id] ?? null) : s.status }));
  const games = live.filter((x) => x.s.kind === "game");
  const players = games.reduce((n, x) => n + (x.st?.online ? x.st.players : 0), 0);
  const slots = games.reduce((n, x) => n + (x.st?.online ? x.st.maxPlayers : 0), 0);
  const voice = live.filter((x) => x.s.kind === "voice").reduce((n, x) => n + (x.st?.online ? x.st.players : 0), 0);
  const discord = live.filter((x) => x.s.kind === "community").reduce((n, x) => n + (x.st?.online ? x.st.players : 0), 0);
  const mixed = games.length < servers.length;
  const anyOnline = live.some((x) => x.st?.online);
  const parts = mixed
    ? [games.length > 0 ? t("summaryPlayers", { count: players }) : null, live.some((x) => x.s.kind === "voice") ? t("summaryVoice", { count: voice }) : null, live.some((x) => x.s.kind === "community") ? t("summaryDiscord", { count: discord }) : null].filter(Boolean)
    : [t("summarySlots", { players, slots })];
  return (
    <span className="gcsx-srvSummary" data-testid="gcs-forum-server-summary">
      <span className="gcsx-srvSummary__count">{mixed ? t("live") : t("serversCount", { count: servers.length })}</span>
      <span className="gcsx-srvSummary__pill" data-state={anyOnline ? "online" : "offline"}>
        <span className="gcs-dot" aria-hidden="true" />
        {parts.join(" · ")}
      </span>
    </span>
  );
}

/** Bara mică din paginile topicurilor forumului. */
export function GcsServerTopicBar({ server, fields }: { server: GcsServerCardData; fields: GcsServerFieldsShown }) {
  return (
    <div className="gcsx-srvTopicBar" data-testid="gcs-forum-server-topicbar">
      <Link href={server.href} className="gcsx-srvTopicBar__name">
        {server.name}
      </Link>
      <GcsServerStrip server={server} style="compact" fields={fields} />
    </div>
  );
}
