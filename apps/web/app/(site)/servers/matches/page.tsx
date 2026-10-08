import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { pageParam } from "@/lib/forum-page";
import { mapPictures } from "@/lib/servers";
import { services } from "@/lib/services";
import { GcsPagination } from "../../_components/forum/GcsPagination";
import { GcsMatchFeed, type GcsMixCardData } from "../../_components/servers/GcsMatchFeed";
import { isBridgeGameKey } from "../../_components/servers/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bridge.matches"))("title") };
}

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ server?: string; map?: string; status?: string; page?: string }> };
type Status = "live" | "ended";
const STATUSES: (Status | null)[] = [null, "live", "ended"];

/**
 * `/servers/matches` (specul 2026-10-08-servere-pagini §7): blocul filtrelor (tab-urile Toate / Live / Terminate cu
 * numărătorile, serverul și harta, „Actualizare live”), apoi meciurile mix ca carduri compacte (harta, serverul,
 * formatul, scorul, starea, ELO-ul mediu, durata), cele mai noi primele, paginate. Filtrele merg și fără JavaScript.
 */
export default async function MatchesPage({ searchParams }: Props) {
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) notFound();
  const [sp, actor, t] = await Promise.all([searchParams, currentActor(), getTranslations("bridge.matches")]);
  if (!(await bridge.queries.canViewStats(actor))) notFound();
  const servers = (await serverQueries.list(actor)).filter((s) => isBridgeGameKey(s.game.key));
  const serverId = /^\d{1,9}$/.test(sp.server ?? "") && servers.some((s) => s.id === Number(sp.server)) ? Number(sp.server) : null;
  const status: Status | null = sp.status === "live" || sp.status === "ended" ? sp.status : null;
  const page = pageParam(sp.page);
  const scope = serverId ? { serverId } : {};
  const maps = await bridge.queries.matchMaps(actor, scope);
  const map = maps.some((m) => m.map === sp.map) ? sp.map! : null;
  const filter = { ...scope, ...(map ? { map } : {}) };
  const [list, counts] = await Promise.all([bridge.queries.matches(actor, { ...filter, ...(status ? { status } : {}), page, withStats: true }), bridge.queries.matchCounts(actor, filter)]);
  // „Urmărește live” pe cardurile meciurilor deschise (serverele cu adresa HLTV / GOTV, specul servere-hltv §3).
  const OPEN = new Set(["warmup", "live", "halftime"]);
  const watch = await bridge.queries.watch(actor, list.items.filter((m) => OPEN.has(m.status)).map((m) => m.server.id));

  // Imaginile hărților, rezolvate aici (o citire pe joc): browserul nu mai trece prin redirect.
  const byGame = new Map<string, string[]>();
  for (const m of list.items) if (m.map) byGame.set(m.server.game, [...(byGame.get(m.server.game) ?? []), m.map]);
  const pictures = new Map(await Promise.all([...byGame].map(async ([game, names]) => [game, await mapPictures(game, names)] as const)));
  const items: GcsMixCardData[] = list.items.map((m) => ({
    id: m.id,
    status: m.status,
    map: m.map,
    game: m.server.game,
    mapImage: (m.map && pictures.get(m.server.game)?.get(m.map)) || null,
    server: { id: m.server.id, name: m.server.name },
    teams: m.teams,
    winner: m.winner,
    round: m.round,
    startedAt: m.startedAt,
    liveAt: m.liveAt,
    endedAt: m.endedAt,
    players: m.stats?.players ?? { A: 0, B: 0 },
    avgElo: m.stats?.avgElo ?? null,
    tv: watch.get(m.server.id) ?? null,
  }));

  const href = (patch: { server?: number | null; map?: string | null; status?: Status | null; page?: number }) => {
    const params = new URLSearchParams();
    const s = patch.server === undefined ? serverId : patch.server;
    const mp = patch.map === undefined ? map : patch.map;
    const st = patch.status === undefined ? status : patch.status;
    if (s) params.set("server", String(s));
    if (mp) params.set("map", mp);
    if (st) params.set("status", st);
    if (patch.page && patch.page > 1) params.set("page", String(patch.page));
    const qs = params.toString();
    return qs ? `/servers/matches?${qs}` : "/servers/matches";
  };

  const tabs = (
    <nav className="gcs-segLinks gcs-mixTabs" aria-label={t("statusFilter")} data-testid="gcs-mix-tabs">
      {STATUSES.map((s) => {
        const active = s === status;
        const count = s === "live" ? counts.live : s === "ended" ? counts.ended : counts.all;
        return (
          <Link key={s ?? "all"} href={href({ status: s, page: 1 })} className={`gcs-segLink gcs-mixTabs__tab${active ? " gcs-segLink--active" : ""}`} aria-current={active ? "page" : undefined} data-tab={s ?? "all"}>
            {s === "live" && counts.live > 0 && <span className="gcs-liveDot gcs-mixTabs__dot" aria-hidden="true" />}
            {t(`tabs.${s ?? "all"}`)}
            <span className="gcs-mixTabs__count" data-testid={`gcs-mix-count-${s ?? "all"}`}>
              {count}
            </span>
          </Link>
        );
      })}
    </nav>
  );

  const filters = (
    <form method="get" action="/servers/matches" className="gcs-mixFilters__form" data-testid="gcs-mix-filter-form">
      {status && <input type="hidden" name="status" value={status} />}
      {servers.length > 1 && (
        <label className="gcs-field gcs-mixFilters__field">
          <span className="gcs-field__label">{t("serverFilter")}</span>
          <select className="gcs-input" name="server" defaultValue={serverId ? String(serverId) : ""} data-testid="gcs-mix-filter-server">
            <option value="">{t("allServers")}</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {maps.length > 0 && (
        <label className="gcs-field gcs-mixFilters__field">
          <span className="gcs-field__label">{t("mapFilter")}</span>
          <select className="gcs-input" name="map" defaultValue={map ?? ""} data-testid="gcs-mix-filter-map">
            <option value="">{t("allMaps")}</option>
            {maps.map((m) => (
              <option key={m.map} value={m.map}>
                {m.map} ({m.count})
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className="gcs-btn gcs-btn--ghost gcs-mixFilters__submit">
        <GcsIcon name="fa-solid fa-filter" />
        {t("filterSubmit")}
      </button>
      {(serverId || map) && (
        <Link href={href({ server: null, map: null, page: 1 })} className="gcs-mixFilters__reset">
          {t("filterReset")}
        </Link>
      )}
    </form>
  );

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
      <GcsMatchFeed
        items={items}
        serverIds={serverId ? [serverId] : servers.map((s) => s.id)}
        renderedAt={Date.now()}
        tabs={tabs}
        filters={filters}
        empty={counts.all === 0 ? t("empty") : t("emptyFiltered")}
      />
      <GcsPagination pagination={{ page: list.page, pages: list.pages, perPage: 50, total: list.total }} href={(p) => href({ page: p })} />
    </>
  );
}
