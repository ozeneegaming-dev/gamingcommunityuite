import { BRIDGE_SETTING, type GcsPlayerProfile } from "@gcs/modules";
import { parseRef } from "@gcs/modules/slug";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { cache } from "react";
import { currentActor } from "@/lib/actor";
import { pageParam } from "@/lib/forum-page";
import { memberHref } from "@/lib/forum-urls";
import { mapPictures } from "@/lib/servers";
import { services } from "@/lib/services";
import { GcsPagination } from "../../../_components/forum/GcsPagination";
import { GcsEloChart, GcsFormGuide, GcsIdentityTag, GcsSanctionStatus, GcsSanctionType, matchResult, playtimeText } from "../../../_components/servers/GcsBridgeBits";
import { GcsMatchRows } from "../../../_components/servers/GcsMatchRows";
import { GcsMapPicture, mapPicture } from "../../../_components/servers/GcsMapPicture";
import { playerHref, sanctionHref } from "../../../_components/servers/types";
import { GcsMemberLink } from "@/lib/member-names";

const TABS = ["overview", "classic", "mix", "matches", "weapons", "maps", "sanctions"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, string> = {
  overview: "fa-solid fa-id-card",
  classic: "fa-solid fa-server",
  mix: "fa-solid fa-people-arrows",
  matches: "fa-solid fa-list",
  weapons: "fa-solid fa-crosshairs",
  maps: "fa-solid fa-map",
  sanctions: "fa-solid fa-gavel",
};

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ tab?: string; page?: string }> };

export const dynamic = "force-dynamic";

/** Un singur apel pe request (metadata + pagina). */
const load = cache(async (ref: string) => {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) return null;
  const actor = await currentActor();
  const profile = await bridge.queries.playerProfile(actor, parsed.id);
  return profile ? { parsed, actor, profile } : null;
});

const displayName = (p: GcsPlayerProfile["player"]) => p.name || p.value;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).ref);
  if (!data) return {};
  const name = displayName(data.profile.player);
  return { title: name, alternates: { canonical: playerHref({ id: data.profile.player.id, name }) } };
}

/**
 * Profilul jucătorului (specul 2026-10-08-servere-pagini §3): „cartea jucătorului” (numele, identitatea cu tipul și
 * încrederea, membrul legat, ultima apariție, ELO-ul și forma), banda cifrelor și tab-urile Prezentare, Clasic, Mix,
 * Meciuri, Arme, Hărți, Sancțiuni (doar cu dreptul de a vedea bannurile). Există și pentru jucătorii fără cont pe site.
 */
export default async function PlayerProfilePage({ params, searchParams }: Props) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const data = await load(ref);
  if (!data) notFound();
  const { parsed, actor, profile } = data;
  const name = displayName(profile.player);
  const tabs = TABS.filter((k) => k !== "sanctions" || profile.sanctions !== null);
  const tab: Tab = tabs.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const canonical = playerHref({ id: profile.player.id, name });
  if (`${parsed.id}-${parsed.slug}` !== canonical.split("/").pop()) permanentRedirect(playerHref({ id: profile.player.id, name }, tab));

  const { bridge, settings } = services();
  const [t, td, format, eloStart, abilities] = await Promise.all([
    getTranslations("bridge.player"),
    getTranslations("bridge.duration"),
    getFormatter(),
    settings.get<number>(BRIDGE_SETTING.eloStart),
    bridge.sanctions.abilities(actor),
  ]);
  const canSanction = abilities.staff || abilities.grants.length > 0;
  const s = profile.summary;
  const num = (v: number) => format.number(v);
  // ELO-ul e un rating, nu o cantitate: fără separatorul miilor (1018, nu 1.018).
  const elo = (v: number) => format.number(v, { useGrouping: false });
  const pct = (v: number | null) => (v === null ? "—" : format.number(v, { style: "percent", maximumFractionDigits: 1 }));
  const kd = (v: number) => format.number(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hours = (sec: number) => playtimeText(sec, td);
  const tabHref = (k: Tab) => playerHref({ id: profile.player.id, name }, k);
  const recent = profile.matches.slice(0, 10).reverse();

  const header = (
    <section className="gcs-card gcs-playerHead" aria-labelledby="gcs-player-name" data-testid="gcs-player-profile" data-kind={profile.player.kind}>
      <div className="gcs-playerHead__main">
        <span className="gcs-playerHead__mark" aria-hidden="true">
          {[...name][0]?.toUpperCase() ?? "?"}
        </span>
        <div className="gcs-playerHead__id">
          <h1 id="gcs-player-name" className="gcs-display gcs-playerHead__name" data-testid="gcs-player-name">
            {name}
          </h1>
          <GcsIdentityTag kind={profile.player.kind} trust={profile.player.trust} value={profile.player.value} />
          <dl className="gcs-playerHead__facts">
            <div>
              <dt>{t("member")}</dt>
              <dd data-testid="gcs-player-member">
                {profile.user ? (
                  <>
                    <GcsIcon name="fa-solid fa-user" className="gcs-hIcon" />
                    <GcsMemberLink user={profile.user} />
                  </>
                ) : (
                  <span className="gcs-muted">{t("noAccount")}</span>
                )}
              </dd>
            </div>
            <div>
              <dt>{t("lastSeen")}</dt>
              <dd>
                {s.lastSeenAt ? format.relativeTime(new Date(s.lastSeenAt)) : t("never")}
                {s.lastServer && (
                  <>
                    {" "}
                    {t("onServer")} <Link href={`/servers/${s.lastServer.id}`}>{s.lastServer.name}</Link>
                  </>
                )}
              </dd>
            </div>
          </dl>
        </div>
        {profile.mix.elo !== null && (
          <div className="gcs-playerHead__elo" data-testid="gcs-player-elo">
            <span className="gcs-playerHead__eloLabel">{t("elo")}</span>
            <strong className="gcs-display gcs-playerHead__eloValue">{elo(profile.mix.elo)}</strong>
            {profile.mix.peak !== null && <span className="gcs-playerHead__eloPeak">{t("peak", { value: elo(profile.mix.peak) })}</span>}
            <GcsFormGuide results={recent.map((m) => matchResult(m.player?.team, m.winner))} label={t("form")} />
          </div>
        )}
        {canSanction && (
          <Link href={`/bans/new?player=${profile.player.id}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-playerHead__action" data-testid="gcs-player-sanction">
            <GcsIcon name="fa-solid fa-gavel" />
            {t("sanction")}
          </Link>
        )}
      </div>
      <dl className="gcs-statStrip" data-testid="gcs-player-stats">
        {[
          [t("stats.kd"), kd(s.kd)],
          [t("stats.kills"), num(s.kills)],
          [t("stats.headshots"), pct(s.headshotRate)],
          [t("stats.accuracy"), pct(s.accuracy)],
          [t("stats.playtime"), hours(s.playtime)],
          [t("stats.bestRank"), s.bestRank === null ? "—" : `#${num(s.bestRank)}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="gcs-display">{value}</dd>
          </div>
        ))}
      </dl>
      <nav aria-label={t("tabsLabel")} className="gcs-tabs" data-testid="gcs-player-tabs">
        {tabs.map((k) => (
          <Link key={k} href={tabHref(k)} className={`gcs-tab${k === tab ? " gcs-tab--active" : ""}`} aria-current={k === tab ? "page" : undefined} scroll={false}>
            <GcsIcon name={TAB_ICONS[k]} className="gcs-tab__icon" />
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>
    </section>
  );

  const box = (id: string, icon: string, title: string, children: ReactNode, extra?: ReactNode) => (
    <section className="gcs-card gcs-titledBox gcs-statBox" aria-labelledby={id}>
      <div className="gcs-titleBand gcs-serverBox__head">
        <h2 id={id} className="gcs-display gcs-serverBox__title">
          <GcsIcon name={icon} className="gcs-hIcon" />
          {title}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
  const empty = (text: string) => <p className="gcs-serverNote">{text}</p>;

  const weaponTable = (list: GcsPlayerProfile["weapons"]) => {
    const top = Math.max(1, ...list.map((w) => w.kills));
    return (
      <div className="gcs-dataScroll">
        <table className="gcs-dataTable" data-testid="gcs-player-weapons">
          <thead>
            <tr>
              <th scope="col">{t("weapon")}</th>
              <th scope="col">{t("stats.kills")}</th>
              <th scope="col" className="gcs-dataTable__wide">
                <span className="gcs-srOnly">{t("share")}</span>
              </th>
              <th scope="col">{t("hs")}</th>
              <th scope="col">{t("stats.accuracy")}</th>
              <th scope="col">{t("damage")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.weapon}>
                <th scope="row">{w.weapon}</th>
                <td>{num(w.kills)}</td>
                <td className="gcs-dataTable__wide">
                  <span className="gcs-killBar" style={{ ["--gcs-fill" as string]: `${Math.round((w.kills / top) * 100)}%` }} aria-hidden="true" />
                </td>
                <td>{pct(w.kills > 0 ? w.headshots / w.kills : null)}</td>
                <td>{pct(w.accuracy)}</td>
                <td>{num(w.damage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const mapCards = (list: GcsPlayerProfile["maps"], game: string) => (
    <ul className="gcs-mapCards" data-testid="gcs-player-maps">
      {list.map((m) => (
        <li key={m.map} className="gcs-mapCard">
          <span className="gcs-mapCard__art">
            <GcsMapPicture className="gcs-mapCard__pic" image={mapPicture(game, m.map, pictures.get(m.map))} />
            <span className="gcs-mapCard__name">{m.map}</span>
          </span>
          <dl className="gcs-mapCard__stats">
            <div>
              <dt>{t("stats.kd")}</dt>
              <dd>{kd(m.kills / Math.max(1, m.deaths))}</dd>
            </div>
            <div>
              <dt>{t("roundsWon")}</dt>
              <dd>{pct(m.rounds > 0 ? m.roundsWon / m.rounds : null)}</dd>
            </div>
            <div>
              <dt>{t("stats.playtime")}</dt>
              <dd>{hours(m.playtime)}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );

  // Jocul hărților: al serverului cu cel mai mult timp de joc (imaginile hărților sunt pe joc).
  const game = profile.classic[0]?.server.game ?? "cs2";
  const pictures = await mapPictures(game, profile.maps.map((m) => m.map));

  let main: ReactNode;
  if (tab === "overview") {
    main = (
      <div className="gcs-playerGrid">
        {box(
          "gcs-player-recent",
          "fa-solid fa-clock-rotate-left",
          t("recentMatches"),
          profile.matches.length === 0 ? empty(t("noMatches")) : <GcsMatchRows matches={profile.matches.slice(0, 5)} perspective />,
          profile.matches.length > 5 ? (
            <Link href={tabHref("matches")} className="gcs-statBox__more">
              {t("allMatches")}
            </Link>
          ) : undefined,
        )}
        {box("gcs-player-elo-box", "fa-solid fa-chart-line", t("eloTitle"), <GcsEloChart history={profile.mix.history} start={eloStart} height={150} />)}
        {box("gcs-player-top-weapons", TAB_ICONS.weapons, t("topWeapons"), profile.weapons.length === 0 ? empty(t("noWeapons")) : weaponTable(profile.weapons.slice(0, 3)))}
        {box("gcs-player-top-maps", TAB_ICONS.maps, t("topMaps"), profile.maps.length === 0 ? empty(t("noMaps")) : mapCards(profile.maps.slice(0, 3), game))}
        {profile.identities.length > 0 &&
          box(
            "gcs-player-identities",
            "fa-solid fa-fingerprint",
            t("identities"),
            <ul className="gcs-identityList" data-testid="gcs-player-identities">
              {profile.identities.map((i) => (
                <li key={i.id}>
                  <Link href={playerHref({ id: i.id, name: i.name || i.value })} className="gcs-identityList__name">
                    {i.name || i.value}
                  </Link>
                  <GcsIdentityTag kind={i.kind} trust={i.trust} value={i.value} compact />
                </li>
              ))}
            </ul>,
          )}
      </div>
    );
  } else if (tab === "classic") {
    main = box(
      "gcs-player-classic",
      TAB_ICONS.classic,
      t("tabs.classic"),
      profile.classic.length === 0 ? (
        empty(t("noClassic"))
      ) : (
        <div className="gcs-dataScroll">
          <table className="gcs-dataTable" data-testid="gcs-player-classic">
            <thead>
              <tr>
                <th scope="col">{t("server")}</th>
                <th scope="col">{t("rank")}</th>
                <th scope="col">{t("stats.kills")}</th>
                <th scope="col">{t("deaths")}</th>
                <th scope="col">{t("stats.kd")}</th>
                <th scope="col">{t("hs")}</th>
                <th scope="col">{t("stats.accuracy")}</th>
                <th scope="col">{t("stats.playtime")}</th>
                <th scope="col">{t("lastSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {profile.classic.map((c) => (
                <tr key={c.server.id}>
                  <th scope="row">
                    <Link href={`/servers/${c.server.id}`}>{c.server.name}</Link>
                  </th>
                  <td>{c.rank === null ? "—" : <Link href={`/servers/leaderboard?server=${c.server.id}`}>#{num(c.rank)}</Link>}</td>
                  <td>{num(c.kills)}</td>
                  <td>{num(c.deaths)}</td>
                  <td>{kd(c.kd)}</td>
                  <td>{pct(c.headshotRate)}</td>
                  <td>{pct(c.accuracy)}</td>
                  <td>{hours(c.playtime)}</td>
                  <td>{format.relativeTime(new Date(c.lastSeenAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    );
  } else if (tab === "mix") {
    const m = profile.mix;
    const decided = m.wins + m.losses + m.draws;
    main = (
      <>
        {box(
          "gcs-player-mix",
          TAB_ICONS.mix,
          t("tabs.mix"),
          m.matches === 0 ? (
            empty(t("noMix"))
          ) : (
            <>
              <dl className="gcs-mixFacts" data-testid="gcs-player-mix">
                <div>
                  <dt>{t("elo")}</dt>
                  <dd className="gcs-display">{m.elo === null ? "—" : elo(m.elo)}</dd>
                </div>
                <div>
                  <dt>{t("peakLabel")}</dt>
                  <dd className="gcs-display">{m.peak === null ? "—" : elo(m.peak)}</dd>
                </div>
                <div>
                  <dt>{t("mixMatches")}</dt>
                  <dd className="gcs-display">{num(m.matches)}</dd>
                </div>
                <div>
                  <dt>{t("record")}</dt>
                  <dd className="gcs-display">{t("recordValue", { wins: m.wins, losses: m.losses, draws: m.draws })}</dd>
                </div>
                <div>
                  <dt>{t("winRate")}</dt>
                  <dd className="gcs-display">{pct(decided > 0 ? m.wins / decided : null)}</dd>
                </div>
              </dl>
              <GcsEloChart history={m.history} start={eloStart} />
            </>
          ),
        )}
        {box("gcs-player-mix-matches", "fa-solid fa-clock-rotate-left", t("recentMatches"), profile.matches.length === 0 ? empty(t("noMatches")) : <GcsMatchRows matches={profile.matches.slice(0, 10)} perspective />)}
      </>
    );
  } else if (tab === "matches") {
    const list = await bridge.queries.matches(actor, { playerId: profile.player.id, page: pageParam(sp.page) });
    main = (
      <>
        {box("gcs-player-matches", TAB_ICONS.matches, t("tabs.matches"), list.items.length === 0 ? empty(t("noMatches")) : <GcsMatchRows matches={list.items} perspective />)}
        <GcsPagination pagination={{ page: list.page, pages: list.pages, perPage: 50, total: list.total }} href={(p) => `${tabHref("matches")}${p > 1 ? `&page=${p}` : ""}`} />
      </>
    );
  } else if (tab === "weapons") {
    main = box("gcs-player-weapons-box", TAB_ICONS.weapons, t("tabs.weapons"), profile.weapons.length === 0 ? empty(t("noWeapons")) : weaponTable(profile.weapons));
  } else if (tab === "maps") {
    main = box("gcs-player-maps-box", TAB_ICONS.maps, t("tabs.maps"), profile.maps.length === 0 ? empty(t("noMaps")) : mapCards(profile.maps, game));
  } else {
    const list = profile.sanctions ?? [];
    main = box(
      "gcs-player-sanctions",
      TAB_ICONS.sanctions,
      t("tabs.sanctions"),
      list.length === 0 ? (
        empty(t("noSanctions"))
      ) : (
        <ul className="gcs-sanctionList" data-testid="gcs-player-sanctions">
          {list.map((x) => (
            <li key={x.id} className="gcs-sanctionList__row" data-status={x.status}>
              <GcsSanctionType type={x.type} />
              <Link href={sanctionHref(x.id)} className="gcs-sanctionList__reason">
                {x.reason}
              </Link>
              <span className="gcs-sanctionList__meta">
                {format.dateTime(new Date(x.createdAt), { dateStyle: "medium" })}
                {x.ip && <code className="gcs-identity__id">{x.ip}</code>}
              </span>
              <GcsSanctionStatus status={x.status} />
            </li>
          ))}
        </ul>
      ),
    );
  }

  return (
    <>
      {header}
      {main}
    </>
  );
}
