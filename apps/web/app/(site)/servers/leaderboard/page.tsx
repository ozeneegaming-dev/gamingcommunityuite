import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsPagination } from "../../_components/forum/GcsPagination";
import { GcsPlayerLink, playtimeText } from "../../_components/servers/GcsBridgeBits";
import { isBridgeGameKey } from "../../_components/servers/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bridge.board"))("title") };
}

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ server?: string; page?: string }> };

/**
 * `/servers/leaderboard` (specul 2026-10-08-servere-pagini §7): clasamentul ELO al meciurilor mix (implicit) sau, cu
 * `?server={id}`, clasamentul clasic al unui server (după loc: ucideri − decese − ucideri în echipă). Pagini de 50.
 */
export default async function ServersLeaderboardPage({ searchParams }: Props) {
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) notFound();
  const [sp, actor, t, td, format] = await Promise.all([searchParams, currentActor(), getTranslations("bridge.board"), getTranslations("bridge.duration"), getFormatter()]);
  if (!(await bridge.queries.canViewStats(actor))) notFound();
  const servers = (await serverQueries.list(actor)).filter((s) => isBridgeGameKey(s.game.key));
  const server = /^\d{1,9}$/.test(sp.server ?? "") ? (servers.find((s) => s.id === Number(sp.server)) ?? null) : null;
  if (sp.server && !server) notFound();
  const page = pageParam(sp.page);
  const num = (v: number) => format.number(v);
  const pct = (v: number | null) => (v === null ? "—" : format.number(v, { style: "percent", maximumFractionDigits: 1 }));
  const href = (serverId: number | null, p = 1) => {
    const params = new URLSearchParams();
    if (serverId) params.set("server", String(serverId));
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/servers/leaderboard?${qs}` : "/servers/leaderboard";
  };
  const rank = (n: number) => (
    <td className="gcs-board__rank" data-medal={n <= 3 ? n : undefined}>
      {num(n)}
    </td>
  );

  let body: React.ReactNode;
  let pagination: { page: number; pages: number; total: number } | null = null;
  if (server) {
    const board = await bridge.queries.leaderboard(actor, server.id, page);
    if (!board) notFound();
    pagination = board;
    body =
      board.items.length === 0 ? (
        <p className="gcs-emptyState" data-testid="gcs-board-empty">
          <GcsIcon name="fa-solid fa-ranking-star" className="gcs-emptyIcon" />
          {t("emptyClassic")}
        </p>
      ) : (
        <div className="gcs-dataScroll">
          <table className="gcs-board__table gcs-dataTable" data-testid="gcs-board-classic">
            <thead>
              <tr>
                <th scope="col">{t("rank")}</th>
                <th scope="col" className="gcs-dataTable__left">
                  {t("player")}
                </th>
                <th scope="col">{t("kills")}</th>
                <th scope="col">{t("deaths")}</th>
                <th scope="col">{t("kd")}</th>
                <th scope="col">{t("hs")}</th>
                <th scope="col">{t("playtime")}</th>
              </tr>
            </thead>
            <tbody>
              {board.items.map((r) => (
                <tr key={r.player.id}>
                  {rank(r.rank)}
                  <th scope="row">
                    <GcsPlayerLink player={r.player} />
                  </th>
                  <td>{num(r.kills)}</td>
                  <td>{num(r.deaths)}</td>
                  <td>{format.number(r.kd, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td>{pct(r.headshotRate)}</td>
                  <td>{playtimeText(r.playtime, td)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  } else {
    const board = await bridge.queries.mixLeaderboard(actor, page);
    if (!board) notFound();
    pagination = board;
    body =
      board.items.length === 0 ? (
        <p className="gcs-emptyState" data-testid="gcs-board-empty">
          <GcsIcon name="fa-solid fa-ranking-star" className="gcs-emptyIcon" />
          {t("emptyElo")}
        </p>
      ) : (
        <div className="gcs-dataScroll">
          <table className="gcs-board__table gcs-dataTable" data-testid="gcs-board-elo">
            <thead>
              <tr>
                <th scope="col">{t("rank")}</th>
                <th scope="col" className="gcs-dataTable__left">
                  {t("player")}
                </th>
                <th scope="col">{t("elo")}</th>
                <th scope="col">{t("peak")}</th>
                <th scope="col">{t("matches")}</th>
                <th scope="col">{t("record")}</th>
                <th scope="col">{t("winRate")}</th>
              </tr>
            </thead>
            <tbody>
              {board.items.map((r) => {
                const decided = r.wins + r.losses + r.draws;
                return (
                  <tr key={r.player.id}>
                    {rank(r.position)}
                    <th scope="row">
                      <GcsPlayerLink player={r.player} />
                    </th>
                    <td className="gcs-board__value">{format.number(r.elo, { useGrouping: false })}</td>
                    <td>{format.number(r.peak, { useGrouping: false })}</td>
                    <td>{num(r.matches)}</td>
                    <td>{t("recordValue", { wins: r.wins, losses: r.losses, draws: r.draws })}</td>
                    <td>{pct(decided > 0 ? r.wins / decided : null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
  }

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-ranking-star" className="gcs-hIcon" />
            {server ? t("classicTitle", { server: server.name }) : t("title")}
          </h1>
          <p className="gcs-pageHeader__desc">{server ? t("classicLead") : t("eloLead")}</p>
        </div>
      </header>
      <nav className="gcs-segLinks" aria-label={t("boardFilter")} data-testid="gcs-board-filter">
        <Link href={href(null)} className={`gcs-segLink${server === null ? " gcs-segLink--active" : ""}`} aria-current={server === null ? "page" : undefined}>
          <GcsIcon name="fa-solid fa-people-arrows" />
          {t("eloTab")}
        </Link>
        {servers.map((s) => (
          <Link key={s.id} href={href(s.id)} className={`gcs-segLink${server?.id === s.id ? " gcs-segLink--active" : ""}`} aria-current={server?.id === s.id ? "page" : undefined}>
            <GcsIcon name="fa-solid fa-server" />
            {s.name}
          </Link>
        ))}
      </nav>
      <GcsCard as="section" className="gcs-board" aria-label={t("title")}>
        {body}
      </GcsCard>
      {pagination && <GcsPagination pagination={{ ...pagination, perPage: 50 }} href={(p) => href(server?.id ?? null, p)} />}
    </>
  );
}
