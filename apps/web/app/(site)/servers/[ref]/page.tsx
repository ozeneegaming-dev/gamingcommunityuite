import { GCS_HISTORY_RANGES, POLL_INTERVAL_SETTING, type GcsHistoryRange } from "@gcs/modules";
import { parseRef } from "@gcs/modules/slug";
import { GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumHref, memberHref } from "@/lib/forum-urls";
import { cardData } from "@/lib/servers";
import { services } from "@/lib/services";
import { GcsCopyAddressButton, GcsServerAddress } from "../../_components/servers/GcsServerAddress";
import { GcsServerChart } from "../../_components/servers/GcsServerChart";
import { GcsServerBanner, GcsServerHeadStatus } from "../../_components/servers/GcsServerGrid";
import { GcsServerLiveProvider } from "../../_components/servers/GcsServerLive";
import { GcsServerPlayers } from "../../_components/servers/GcsServerPlayers";
import { GcsPlayerLink, playtimeText } from "../../_components/servers/GcsBridgeBits";
import { GcsMatchBoard } from "../../_components/servers/GcsMatchBoard";
import { GcsMatchRows } from "../../_components/servers/GcsMatchRows";
import { isBridgeGameKey, mapImageHref, serverHref } from "../../_components/servers/types";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ range?: string }> };

export const dynamic = "force-dynamic";

async function load(ref: string) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const { serverQueries } = services();
  if (!(await serverQueries.appEnabled())) return null;
  return serverQueries.details(await currentActor(), parsed.id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const server = await load((await params).ref);
  return { title: server?.name ?? (await getTranslations("servers"))("title") };
}

/**
 * `/servers/{id}-{slug}` (specul 2026-10-07-servere §5.2): statusul live, graficul jucătorilor (24 h / 7 zile / 30 de
 * zile), uptime-ul, hărțile jucate, lista jucătorilor (cu dreptul de a o vedea), adminii, forumul și descrierea.
 */
export default async function ServerPage({ params, searchParams }: Props) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const server = await load(ref);
  if (!server) notFound();
  if (ref !== `${server.id}-${server.slug}`) permanentRedirect(`${serverHref(server)}${sp.range ? `?range=${encodeURIComponent(sp.range)}` : ""}`);
  const range: GcsHistoryRange = GCS_HISTORY_RANGES.includes(sp.range as GcsHistoryRange) ? (sp.range as GcsHistoryRange) : "24h";
  const { serverQueries, settings, bridge } = services();
  const actor = await currentActor();
  const bridgeGame = isBridgeGameKey(server.game.key);
  const [t, tb, td, format, history, interval, counts, live, board, matches, gameAdmins] = await Promise.all([
    getTranslations("servers"),
    getTranslations("bridge.server"),
    getTranslations("bridge.duration"),
    getFormatter(),
    serverQueries.history(server.id, range),
    settings.get<number>(POLL_INTERVAL_SETTING),
    // Puntea (jocurile cu pluginuri): adminii online, meciul live, clasamentul, meciurile recente, adminii din joc.
    bridgeGame ? bridge.queries.adminsOnlineCounts(actor, [server.id]) : Promise.resolve(new Map<number, number>()),
    bridgeGame ? bridge.queries.liveMatch(actor, server.id) : Promise.resolve(null),
    bridgeGame ? bridge.queries.leaderboard(actor, server.id, 1) : Promise.resolve(null),
    bridgeGame ? bridge.queries.matches(actor, { serverId: server.id }) : Promise.resolve(null),
    bridgeGame ? bridge.queries.serverAdmins(actor, server.id) : Promise.resolve(null),
  ]);
  const card = cardData(server, counts.get(server.id) ?? 0);
  const top = board?.items.slice(0, 10) ?? [];
  const recent = matches?.items.slice(0, 5) ?? [];
  const admins = [...(gameAdmins ?? [])].sort((a, b) => Number(b.online !== null) - Number(a.online !== null) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "")).slice(0, 12);
  const pct = (v: number | null) => (v === null ? t("facts.none") : format.number(v, { style: "percent", maximumFractionDigits: 1 }));
  const uptimeRange = range === "24h" ? server.uptime.d1 : range === "7d" ? server.uptime.d7 : server.uptime.d30;
  const rangeHref = (r: GcsHistoryRange) => (r === "24h" ? serverHref(server) : `${serverHref(server)}?range=${r}`);
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });

  return (
    <GcsServerLiveProvider initial={{ [server.id]: server.status }} pollSeconds={interval} players={{ initial: server.players }}>
      <header className="gcs-pageHeader">
        <nav aria-label={t("title")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/servers">
                <GcsIcon name="fa-solid fa-server" className="gcs-breadcrumb__home" />
                {t("title")}
              </Link>
            </li>
            <li aria-current="page">{server.name}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name={server.game.icon} className="gcs-hIcon" />
            {server.name}
          </h1>
          <GcsServerHeadStatus server={card} />
        </div>
        <div className="gcs-pageHeader__actions">
          {server.connectHref && (
            <a className="gcs-btn gcs-btn--primary" href={server.connectHref} data-testid="gcs-server-connect">
              <GcsIcon name="fa-solid fa-right-to-bracket" />
              {t("connect")}
            </a>
          )}
          <GcsCopyAddressButton address={server.address} variant={server.connectHref ? "ghost" : "primary"} />
        </div>
      </header>

      <GcsServerBanner server={card} hero />

      <div className="gcs-serverLayout">
        <div className="gcs-serverLayout__main">
          <section className="gcs-card gcs-titledBox" aria-labelledby="gcs-server-chart-title" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="gcs-titleBand gcs-serverBox__head">
              <h2 id="gcs-server-chart-title" className="gcs-display gcs-serverBox__title">
                <GcsIcon name="fa-solid fa-chart-column" className="gcs-hIcon" />
                {t(`chart.title.${range}`)}
              </h2>
              <nav className="gcs-segLinks" aria-label={t("chart.rangeLabel")} data-testid="gcs-server-ranges">
                {GCS_HISTORY_RANGES.map((r) => (
                  <Link key={r} href={rangeHref(r)} className={`gcs-segLink${r === range ? " gcs-segLink--active" : ""}`} aria-current={r === range ? "page" : undefined} scroll={false}>
                    {t(`chart.ranges.${r}`)}
                  </Link>
                ))}
              </nav>
            </div>
            <GcsServerChart history={history} />
            <dl className="gcs-serverFacts" data-testid="gcs-server-facts">
              <div>
                <dt>{t("facts.peak")}</dt>
                <dd>{server.peak24 ? t("facts.peakValue", { players: server.peak24.players, max: history.maxPlayers || server.peak24.players, time: time(server.peak24.at) }) : t("facts.none")}</dd>
              </div>
              <div>
                <dt>{t("facts.average")}</dt>
                <dd>{server.avg24 === null ? t("facts.none") : format.number(server.avg24, { maximumFractionDigits: 0 })}</dd>
              </div>
              {range !== "30d" && (
                <div>
                  <dt>{t(range === "24h" ? "facts.uptime24" : "facts.uptime7")}</dt>
                  <dd>{pct(uptimeRange)}</dd>
                </div>
              )}
              <div>
                <dt>{t("facts.uptime30")}</dt>
                <dd>{pct(server.uptime.d30)}</dd>
              </div>
            </dl>
          </section>

          {bridgeGame && <GcsMatchBoard initial={live} game={server.game.key} server={{ id: server.id, name: server.name, href: serverHref(server) }} mode="server" />}

          {top.length > 0 && (
            <section className="gcs-card gcs-titledBox gcs-statBox" aria-labelledby="gcs-server-board">
              <div className="gcs-titleBand gcs-serverBox__head">
                <h2 id="gcs-server-board" className="gcs-display gcs-serverBox__title">
                  <GcsIcon name="fa-solid fa-ranking-star" className="gcs-hIcon" />
                  {tb("top")}
                </h2>
                <Link href={`/servers/leaderboard?server=${server.id}`} className="gcs-statBox__more">
                  {tb("fullBoard")}
                </Link>
              </div>
              <div className="gcs-dataScroll">
                <table className="gcs-dataTable" data-testid="gcs-server-board">
                  <thead>
                    <tr>
                      <th scope="col">{tb("rank")}</th>
                      <th scope="col" className="gcs-dataTable__left">
                        {tb("player")}
                      </th>
                      <th scope="col">{tb("kills")}</th>
                      <th scope="col">{tb("kd")}</th>
                      <th scope="col">{tb("playtime")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((r) => (
                      <tr key={r.player.id}>
                        <td className="gcs-board__rank" data-medal={r.rank <= 3 ? r.rank : undefined}>
                          {r.rank}
                        </td>
                        <th scope="row">
                          <GcsPlayerLink player={r.player} />
                        </th>
                        <td>{format.number(r.kills)}</td>
                        <td>{format.number(r.kd, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td>{playtimeText(r.playtime, td)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {recent.length > 0 && (
            <section className="gcs-card gcs-titledBox gcs-statBox" aria-labelledby="gcs-server-matches">
              <div className="gcs-titleBand gcs-serverBox__head">
                <h2 id="gcs-server-matches" className="gcs-display gcs-serverBox__title">
                  <GcsIcon name="fa-solid fa-crosshairs" className="gcs-hIcon" />
                  {tb("matches")}
                </h2>
                <Link href={`/servers/matches?server=${server.id}`} className="gcs-statBox__more">
                  {tb("allMatches")}
                </Link>
              </div>
              <GcsMatchRows matches={recent} showServer={false} />
            </section>
          )}

          <section className="gcs-card gcs-titledBox" aria-labelledby="gcs-server-about" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="gcs-server-about" className="gcs-display gcs-titleBand gcs-serverBox__title">
              <GcsIcon name="fa-solid fa-circle-info" className="gcs-hIcon" />
              {t("about")}
            </h2>
            {server.description && <p className="gcs-serverAbout__text">{server.description}</p>}
            <GcsServerAddress address={server.address} />
            <dl className="gcs-serverDl" data-testid="gcs-server-about">
              <dt>{t("game")}</dt>
              <dd>{server.game.name}</dd>
              {server.status?.name && (
                <>
                  <dt>{t("reportedName")}</dt>
                  <dd>{server.status.name}</dd>
                </>
              )}
              {server.status?.version && (
                <>
                  <dt>{t("version")}</dt>
                  <dd>{server.status.version}</dd>
                </>
              )}
              {server.status?.online && server.status.bots > 0 && (
                <>
                  <dt>{t("bots")}</dt>
                  <dd>{server.status.bots}</dd>
                </>
              )}
              {server.status?.updatedAt && (
                <>
                  <dt>{t("ping")}</dt>
                  <dd>{server.status.ping === null ? t("facts.none") : t("pingValue", { ms: server.status.ping })} · {t("updated", { time: time(server.status.updatedAt) })}</dd>
                </>
              )}
            </dl>
          </section>
        </div>

        <aside className="gcs-serverLayout__side">
          <section className="gcs-card gcs-titledBox" aria-labelledby="gcs-server-players" style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-server-players">
            <GcsServerPlayers serverId={server.id} hidden={server.playersHidden} headingId="gcs-server-players" />
          </section>

          <section className="gcs-card gcs-titledBox" aria-labelledby="gcs-server-admins" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 id="gcs-server-admins" className="gcs-display gcs-titleBand gcs-serverBox__title">
              <GcsIcon name="fa-solid fa-user-shield" className="gcs-hIcon" />
              {t("admins")}
            </h2>
            {server.admins.length === 0 ? (
              <p className="gcs-serverNote">{t("noAdmins")}</p>
            ) : (
              <p style={{ margin: 0, lineHeight: 1.8 }} data-testid="gcs-server-admins">
                {server.admins.map((a, i) => (
                  <span key={a.id}>
                    <GcsUserLink userId={a.id} name={a.name} nameKey={a.nameKey} href={memberHref(a)} />
                    {i < server.admins.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            )}
            {server.forum && (
              <Link href={forumHref(server.forum)} className="gcs-btn gcs-btn--ghost" data-testid="gcs-server-forum">
                <GcsIcon name="fa-solid fa-comments" />
                {t("forum")}
              </Link>
            )}
          </section>

          {admins.length > 0 && (
            <section className="gcs-card gcs-titledBox" aria-labelledby="gcs-server-game-admins" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="gcs-titleBand gcs-serverBox__head">
                <h2 id="gcs-server-game-admins" className="gcs-display gcs-serverBox__title">
                  <GcsIcon name="fa-solid fa-shield-halved" className="gcs-hIcon" />
                  {tb("gameAdmins")}
                </h2>
                <Link href={`/servers/admins?server=${server.id}`} className="gcs-statBox__more">
                  {tb("allAdmins")}
                </Link>
              </div>
              <ul className="gcs-adminRows" data-testid="gcs-server-game-admins">
                {admins.map((a) => (
                  <li key={a.id} className="gcs-adminRow" data-state={a.online ? "online" : "away"}>
                    <span className="gcs-dot" aria-hidden="true" />
                    <span className="gcs-adminRow__name">{a.user ? <Link href={memberHref(a.user)}>{a.name}</Link> : a.name}</span>
                    <span className="gcs-adminRow__meta">
                      {a.online && a.online.serverId === server.id
                        ? a.online.since
                          ? tb("onlineSince", { time: format.relativeTime(new Date(a.online.since)) })
                          : tb("onlineNow")
                        : a.lastSeenAt
                          ? tb("lastSeen", { time: format.relativeTime(new Date(a.lastSeenAt)) })
                          : tb("neverSeen")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {server.game.hasMap && (
            <section className="gcs-card gcs-titledBox" aria-labelledby="gcs-server-maps" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 id="gcs-server-maps" className="gcs-display gcs-titleBand gcs-serverBox__title">
                <GcsIcon name="fa-solid fa-map" className="gcs-hIcon" />
                {t("maps")}
              </h2>
              {server.maps.length === 0 ? (
                <p className="gcs-serverNote">{t("mapsEmpty")}</p>
              ) : (
                <ul className="gcs-serverMaps" data-testid="gcs-server-maps">
                  {server.maps.map((m, i) => (
                    <li key={`${m.from}-${m.map}`}>
                      <span className="gcs-serverMaps__name">
                        {bridgeGame && <img className="gcs-serverMaps__thumb" src={mapImageHref(server.game.key, m.map)} alt="" loading="lazy" />}
                        {m.map}
                      </span>
                      <span>
                        {time(m.from)}–{i === 0 && server.status?.online && server.status.map === m.map ? t("mapNow") : time(m.to)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>
    </GcsServerLiveProvider>
  );
}
