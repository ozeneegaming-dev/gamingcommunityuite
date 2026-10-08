import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsPagination } from "../../_components/forum/GcsPagination";
import { GcsMatchRows } from "../../_components/servers/GcsMatchRows";
import { isBridgeGameKey } from "../../_components/servers/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bridge.matches"))("title") };
}

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ server?: string; page?: string }> };

/** `/servers/matches`: istoricul meciurilor mix (cele mai noi primele), filtrul pe server (specul 2026-10-08-servere-pagini §7). */
export default async function MatchesPage({ searchParams }: Props) {
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) notFound();
  const [sp, actor, t] = await Promise.all([searchParams, currentActor(), getTranslations("bridge.matches")]);
  if (!(await bridge.queries.canViewStats(actor))) notFound();
  const servers = (await serverQueries.list(actor)).filter((s) => isBridgeGameKey(s.game.key));
  const serverId = /^\d{1,9}$/.test(sp.server ?? "") && servers.some((s) => s.id === Number(sp.server)) ? Number(sp.server) : null;
  const page = pageParam(sp.page);
  const list = await bridge.queries.matches(actor, { ...(serverId ? { serverId } : {}), page });
  const href = (patch: { server?: number | null; page?: number }) => {
    const params = new URLSearchParams();
    const s = patch.server === undefined ? serverId : patch.server;
    if (s) params.set("server", String(s));
    if (patch.page && patch.page > 1) params.set("page", String(patch.page));
    const qs = params.toString();
    return qs ? `/servers/matches?${qs}` : "/servers/matches";
  };

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-crosshairs" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc">{t("lead")}</p>
        </div>
        <Link href="/servers/leaderboard" className="gcs-btn gcs-btn--ghost">
          <GcsIcon name="fa-solid fa-ranking-star" />
          {t("eloBoard")}
        </Link>
      </header>
      {servers.length > 1 && (
        <nav className="gcs-segLinks" aria-label={t("serverFilter")}>
          <Link href={href({ server: null })} className={`gcs-segLink${serverId === null ? " gcs-segLink--active" : ""}`} aria-current={serverId === null ? "page" : undefined}>
            {t("allServers")}
          </Link>
          {servers.map((s) => (
            <Link key={s.id} href={href({ server: s.id })} className={`gcs-segLink${serverId === s.id ? " gcs-segLink--active" : ""}`} aria-current={serverId === s.id ? "page" : undefined}>
              {s.name}
            </Link>
          ))}
        </nav>
      )}
      <GcsCard as="section" aria-label={t("title")} className="gcs-statBox">
        {list.items.length === 0 ? (
          <p className="gcs-emptyState" data-testid="gcs-matches-empty">
            <GcsIcon name="fa-solid fa-crosshairs" className="gcs-emptyIcon" />
            {t("empty")}
          </p>
        ) : (
          <GcsMatchRows matches={list.items} showServer={serverId === null} />
        )}
      </GcsCard>
      <GcsPagination pagination={{ page: list.page, pages: list.pages, perPage: 50, total: list.total }} href={(p) => href({ page: p })} />
    </>
  );
}
