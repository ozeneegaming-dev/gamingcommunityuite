"use client";

import { faArrowRight, faBolt, faPlay, faSatelliteDish, faServer, faTowerBroadcast, faTrophy, faTv } from "@fortawesome/free-solid-svg-icons";
import type { GcsCockpitPanel } from "@gcs/core/themes";
import type { GcsServerLive } from "@gcs/modules";
import { GcsAvatar, GcsIconSvg, GcsUserLink } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cockpitShownOn, FEED_TABS, feedTabOf, type GcsCockpitData, type GcsCockpitMatch, type GcsFeedItem, type GcsFeedTab } from "@/lib/cockpit";
import { memberHref } from "@/lib/forum-urls";
import { occupancy, pickPlayNow } from "@/lib/live-summary";
import { COCKPIT_METRICS } from "@/lib/ranking";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { GcsServerLiveProvider, useServerStatuses } from "../servers/GcsServerLive";
import { GcsRankingPanel } from "./GcsRankingPanel";

const FEED_REFRESH_MS = 60_000;

/** O bandă de panou: iconița în cutiuță, titlul, partea din dreapta. */
function PanelHead({ icon, title, children }: { icon: Parameters<typeof GcsIconSvg>[0]["icon"]; title: string; children?: ReactNode }) {
  return (
    <div className="gcs-ck__head">
      <span className="gcs-ck__ico" aria-hidden="true">
        <GcsIconSvg icon={icon} />
      </span>
      <span className="gcs-ck__title">{title}</span>
      {children}
    </div>
  );
}

/** Numele din consolă: numele stilizat al membrului (componenta comună) sau numele simplu al unui jucător / echipe. */
function Who({ user, name }: { user: GcsFeedItem["user"]; name: string }) {
  return user ? <GcsUserLink userId={user.id} name={user.name} nameKey={user.nameKey} href={memberHref(user)} /> : <b className="gcs-ck__plain">{name}</b>;
}

/** „Feed live”: tab-urile Tot / Forum / Servere / Mix din fluxul de activitate, actualizat live. */
function FeedPanel({ initial }: { initial: GcsFeedItem[] }) {
  const t = useTranslations("cockpit.feed");
  const format = useFormatter();
  const realtime = useRealtime();
  const [tab, setTab] = useState<GcsFeedTab>("all");
  const [items, setItems] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef(new Set(initial.map((i) => i.key)));

  const load = useCallback(async (which: GcsFeedTab) => {
    try {
      const res = await fetch(`/api/cockpit?feed=${which}`, { cache: "no-store" });
      if (!res.ok) return;
      const next = ((await res.json()) as { items: GcsFeedItem[] }).items;
      // Rândurile noi intră cu o animație (fade + alunecare).
      setFresh(new Set(next.filter((i) => !known.current.has(i.key)).map((i) => i.key)));
      for (const i of next) known.current.add(i.key);
      setItems(next);
    } catch {
      // Fără rețea: rămâne lista de acum.
    }
  }, []);

  useEffect(() => {
    if (tab !== "all" || items !== initial) void load(tab);
    // Doar la schimbarea tab-ului.
  }, [tab]);
  useEffect(() => {
    const timer = setInterval(() => void load(tab), FEED_REFRESH_MS);
    const off = realtime.on("activity:new", () => void load(tab));
    return () => {
      clearInterval(timer);
      off();
    };
  }, [realtime, tab, load]);

  const shown = tab === "all" ? items : items.filter((i) => feedTabOf(i) === tab);
  return (
    <section className="gcs-ck__panel gcs-ck__panel--feed" aria-label={t("title")} data-testid="gcs-cockpit-feed">
      <PanelHead icon={faSatelliteDish} title={t("title")}>
        <span className="gcs-ck__liveDot" aria-hidden="true" />
      </PanelHead>
      <div className="gcs-hbSeg gcs-ck__tabs" role="tablist" aria-label={t("title")} style={{ "--i": FEED_TABS.indexOf(tab), "--n": FEED_TABS.length } as CSSProperties}>
        {FEED_TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === tab} className={`gcs-hbSeg__btn${k === tab ? " gcs-hbSeg__btn--on" : ""}`} onClick={() => setTab(k)} data-testid={`gcs-cockpit-feed-tab-${k}`}>
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="gcs-ck__empty">{t("empty")}</p>
      ) : (
        <ul className="gcs-ck__feed" key={tab}>
          {shown.map((i) => (
            <li key={i.key} className={`gcs-ck__card gcs-ck__feedRow${fresh.has(i.key) ? " gcs-ck__feedRow--new" : ""}`} data-testid="gcs-cockpit-feed-item" data-kind={i.kind}>
              {i.user ? <GcsAvatar name={i.user.name} size="xs" userId={i.user.id} {...(i.user.image ? { src: i.user.image } : {})} /> : <span className="gcs-ck__blank" aria-hidden="true">{[...i.name][0]?.toUpperCase()}</span>}
              <span className="gcs-ck__feedText">
                <Who user={i.user} name={i.name} />{" "}
                <Link href={i.href} className="gcs-ck__feedLink">
                  {t(`kinds.${i.kind === "mix" && i.params.elo ? "mixElo" : i.kind}`, i.params)}
                </Link>
              </span>
              <span className={`gcs-ck__tag gcs-ck__tag--${i.tag}`}>{t(`tags.${i.tag}`)}</span>
              <time className="gcs-ck__time" dateTime={i.at}>
                {format.relativeTime(new Date(i.at))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Scorul live al meciului (actualizat din camera meciului, evenimentul `match:state`). */
function useLiveMatch(initial: GcsCockpitMatch | null): GcsCockpitMatch | null {
  const realtime = useRealtime();
  const [match, setMatch] = useState(initial);
  useEffect(() => setMatch(initial), [initial]);
  useEffect(() => {
    if (!match?.id || !realtime.connected) return;
    const room = `match:${match.id}`;
    void realtime.join(room);
    const off = realtime.on("match:state", (d) => {
      const s = d as { id?: number; teams?: GcsCockpitMatch["teams"]; round?: number; status?: string; map?: string | null };
      if (s?.id !== match.id) return;
      setMatch((m) => (m ? { ...m, teams: s.teams ?? m.teams, round: s.round ?? m.round, status: s.status ?? m.status, map: s.map ?? m.map } : m));
    });
    return () => {
      off();
      realtime.leave(room);
    };
  }, [realtime, match?.id]);
  return match;
}

/** Recomandatele: topicurile evidențiate (când nu e nimic live, sau ca panou separat). */
function FeaturedCards({ items, compact }: { items: GcsCockpitData["live"]["featured"]; compact?: boolean }) {
  const t = useTranslations("cockpit.live");
  if (items.length === 0) return <p className="gcs-ck__empty">{t("noFeatured")}</p>;
  return (
    <div className={`gcs-ck__featured${compact ? " gcs-ck__featured--compact" : ""}`} data-testid="gcs-cockpit-featured">
      {items.slice(0, compact ? 2 : 4).map((f) => (
        <Link key={f.id} href={f.href} className="gcs-ck__feature">
          {f.image && (
            <span className="gcs-ck__featureImg">
              <img src={f.image} alt="" loading="lazy" />
            </span>
          )}
          <span className="gcs-ck__featureTag">{f.forum ?? t("featured")}</span>
          <span className="gcs-ck__featureTitle">{f.title}</span>
          {!compact && f.excerpt && <span className="gcs-ck__featureText">{f.excerpt}</span>}
        </Link>
      ))}
    </div>
  );
}

/** „Live acum”: meciul mix în desfășurare (scorul, echipele, Urmărește / Conectează-te / Toate meciurile) sau recomandatele. */
function LivePanel({ data }: { data: GcsCockpitData["live"] }) {
  const t = useTranslations("cockpit.live");
  const match = useLiveMatch(data.match);
  return (
    <section className="gcs-ck__panel gcs-ck__panel--live" aria-label={t("title")} data-testid="gcs-cockpit-live">
      <PanelHead icon={faTowerBroadcast} title={t("title")}>
        {match && <span className="gcs-ck__liveBadge">{t("badge")}</span>}
      </PanelHead>
      {match ? (
        <div className="gcs-ck__match" data-testid="gcs-cockpit-match">
          <div className="gcs-ck__matchHead">
            <b>{[match.server, match.map, t("round", { round: match.round })].filter(Boolean).join(" · ")}</b>
          </div>
          <div className="gcs-ck__score">
            <span className="gcs-ck__team gcs-ck__team--a">
              <b>{match.teams.A.name}</b>
              <span className="gcs-ck__players">
                {match.players
                  .filter((p) => p.team === "A")
                  .map((p, i) => (
                    <span key={i}>
                      <Who user={p.user} name={p.name} /> <span className="gcs-ck__kd">{p.kills}/{p.deaths}</span>
                    </span>
                  ))}
              </span>
            </span>
            <span className="gcs-ck__points" aria-label={t("score", { a: match.teams.A.score, b: match.teams.B.score })}>
              <span className="gcs-ck__pointsA">{match.teams.A.score}</span>
              <span className="gcs-ck__colon">:</span>
              <span className="gcs-ck__pointsB">{match.teams.B.score}</span>
            </span>
            <span className="gcs-ck__team gcs-ck__team--b">
              <b>{match.teams.B.name}</b>
              <span className="gcs-ck__players">
                {match.players
                  .filter((p) => p.team === "B")
                  .map((p, i) => (
                    <span key={i}>
                      <span className="gcs-ck__kd">{p.kills}/{p.deaths}</span> <Who user={p.user} name={p.name} />
                    </span>
                  ))}
              </span>
            </span>
          </div>
          <div className="gcs-ck__actions">
            {match.watch && (
              <a href={`steam://connect/${match.watch.address}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm" data-testid="gcs-cockpit-watch">
                <GcsIconSvg icon={faTv} />
                {t("watch")}
              </a>
            )}
            {match.connectHref && (
              <a href={match.connectHref} className="gcs-btn gcs-btn--primary gcs-btn--sm" data-testid="gcs-cockpit-connect">
                <GcsIconSvg icon={faPlay} />
                {t("connect")}
              </a>
            )}
            <Link href="/servers/matches?status=live" className="gcs-btn gcs-btn--ghost gcs-btn--sm">
              {t("all")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="gcs-ck__nothing">
          <p className="gcs-ck__empty">{t("nothing")}</p>
          <span className="gcs-ck__subhead">{t("featured")}</span>
          <FeaturedCards items={data.featured} />
        </div>
      )}
    </section>
  );
}

/** Benzile serverelor: lumina / umplerea = ocuparea, click = conectare; „Joacă acum” alege un server bun. */
function ServerStrips({ servers, compact }: { servers: GcsCockpitData["servers"]; compact?: boolean }) {
  const t = useTranslations("cockpit.servers");
  const statuses = useServerStatuses();
  const list = servers.map((s) => ({ ...s, status: statuses[s.id] ?? null }));
  const play = pickPlayNow(list.map((s) => ({ id: s.id, name: s.name, connectHref: s.connectHref, online: !!s.status?.online, players: s.status?.players ?? 0, maxPlayers: s.status?.maxPlayers ?? 0 })));
  return (
    <div className={`gcs-ck__strips${compact ? " gcs-ck__strips--chips" : ""}`} data-testid="gcs-cockpit-servers">
      {list.map((s) => {
        const st: GcsServerLive | null = s.status;
        const occ = st?.online ? occupancy(st.players, st.maxPlayers) : { percent: 0, tone: "off" as const };
        const label = st?.online ? t("strip", { name: s.name, players: st.players, max: st.maxPlayers, map: st.map ?? "" }) : t("offline", { name: s.name });
        return (
          <a
            key={s.id}
            href={s.connectHref ?? s.href}
            className={`gcs-ck__strip gcs-ck__strip--${occ.tone}`}
            style={{ "--pct": `${occ.percent}%` } as CSSProperties}
            aria-label={label}
            title={label}
            data-testid="gcs-cockpit-strip"
          >
            <span className="gcs-ck__stripFill" aria-hidden="true" />
            <b>{s.name}</b>
            <span className="gcs-ck__stripCount">{st?.online ? `${st.players}/${st.maxPlayers}` : t("off")}</span>
          </a>
        );
      })}
      <a href={play?.connectHref ?? "/servers"} className="gcs-btn gcs-btn--primary gcs-btn--sm gcs-ck__play" data-testid="gcs-cockpit-play">
        <GcsIconSvg icon={faPlay} />
        {t("playNow")}
      </a>
    </div>
  );
}

/** Indicatorul cardurilor de pe mobil (punctele), după poziția derulării. */
function Dots({ track, count }: { track: React.RefObject<HTMLDivElement | null>; count: number }) {
  const t = useTranslations("cockpit");
  const [at, setAt] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth * 0.82)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [track]);
  return (
    <div className="gcs-ck__dots" role="tablist" aria-label={t("cards")}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={i === Math.min(at, count - 1)}
          aria-label={t("card", { n: i + 1, total: count })}
          className={`gcs-ck__dot${i === Math.min(at, count - 1) ? " gcs-ck__dot--on" : ""}`}
          onClick={() => track.current?.children[i]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}
        />
      ))}
    </div>
  );
}

function CockpitView({ data, siteName }: { data: GcsCockpitData; siteName: string }) {
  const t = useTranslations("cockpit");
  const format = useFormatter();
  const track = useRef<HTMLDivElement>(null);
  const w = data.welcome;
  const panels = data.panels.filter((p): p is Exclude<GcsCockpitPanel, "none"> => p !== "none");
  const panel = (p: Exclude<GcsCockpitPanel, "none">, i: number) => {
    switch (p) {
      case "feed":
        return <FeedPanel key={`${p}${i}`} initial={data.feed} />;
      case "live":
        return <LivePanel key={`${p}${i}`} data={data.live} />;
      case "featured":
        return (
          <section key={`${p}${i}`} className="gcs-ck__panel gcs-ck__panel--featured" aria-label={t("live.featured")}>
            <PanelHead icon={faBolt} title={t("live.featured")} />
            <FeaturedCards items={data.live.featured} />
          </section>
        );
      case "top":
        return (
          <section key={`${p}${i}`} className="gcs-ck__panel gcs-ck__panel--top" aria-label={t("top.title")}>
            <PanelHead icon={faTrophy} title={t("top.title")} />
            <GcsRankingPanel initial={data.ranking} metrics={data.rankingMetrics.length > 0 ? data.rankingMetrics : [...COCKPIT_METRICS]} variant="cockpit" testId="gcs-cockpit-top" />
          </section>
        );
    }
  };
  const players = data.summary.servers.players;
  const servers = data.servers.length > 0;

  return (
    <section className="gcs-ck" aria-label={t("label")} data-testid="gcs-cockpit">
      <div className="gcs-ck__hero">
        <div className="gcs-ck__heroText">
          <span className="gcs-ck__kicker">
            {w ? (
              <>
                {t("welcome")} <GcsUserLink userId={w.user.id} name={w.user.name} nameKey={w.user.nameKey} href={memberHref(w.user)} />
              </>
            ) : (
              t("welcomeGuest")
            )}
          </span>
          <span className="gcs-ck__heroTitle">{siteName}</span>
          {w && (
            <span className="gcs-ck__strip-personal" data-testid="gcs-cockpit-welcome">
              <span className="gcs-ck__fact">
                <i className="gcs-ck__factDot gcs-ck__factDot--accent" aria-hidden="true" />
                <Link href="/activity?unread=1">{t("unread", { count: w.unread })}</Link>
              </span>
              {w.friends && (
                <span className="gcs-ck__fact">
                  <i className="gcs-ck__factDot gcs-ck__factDot--ok" aria-hidden="true" />
                  {t("friends", { count: w.friends.online })}
                  {w.friends.playing > 0 && w.friends.server && <> — {t("friendsPlaying", { count: w.friends.playing, server: w.friends.server })}</>}
                </span>
              )}
              {w.level.level > 0 && (
                <span className="gcs-ck__fact">
                  {w.level.rank ? t("rank", { rank: w.level.rank }) : t("level", { level: w.level.level })}
                  {w.level.next && w.level.next.need > 0 && <> · {format.number(w.level.next.have)} / {format.number(w.level.next.need)} {t(`units.${w.level.next.unit}`)}</>}
                </span>
              )}
              <Link href={memberHref(w.user)} className="gcs-arrowLink">
                {t("myProfile")} <span className="gcs-arrow" aria-hidden="true">→</span>
              </Link>
            </span>
          )}
        </div>
        {servers && (
          <div className="gcs-ck__heroActions">
            <Link href="/servers/matches?status=live" className="gcs-btn gcs-btn--ghost">
              {t("live.matches", { count: data.live.matches })}
            </Link>
          </div>
        )}
      </div>

      <div className="gcs-ck__console">
        <header className="gcs-ck__band">
          <span className="gcs-ck__ico" aria-hidden="true">
            <GcsIconSvg icon={faSatelliteDish} />
          </span>
          <b className="gcs-ck__bandTitle">{t("title")}</b>
          {servers && (
            <span className="gcs-ck__chip">
              <GcsIconSvg icon={faServer} />
              {t("playersOnServers", { count: players })}
            </span>
          )}
        </header>
        {/* Pe mobil: meciul live sus, apoi panourile ca un șir de carduri cu puncte. */}
        <div className="gcs-ck__panels" data-count={panels.length} ref={track}>
          {panels.map(panel)}
        </div>
        {panels.length > 1 && <Dots track={track} count={panels.length} />}
        {servers && <ServerStrips servers={data.servers} />}
      </div>
      <Link href="/activity" className="gcs-srOnly">
        {t("allActivity")}
        <GcsIconSvg icon={faArrowRight} />
      </Link>
    </section>
  );
}

/**
 * Consola Hero Cockpit (specul 2026-10-10-hero-cockpit §4–7): sub antet, doar pe pagina principală (sau pe toate
 * paginile, din temă). Prima randare vine cu datele de pe server; după navigarea fără reîncărcare, datele se cer de la
 * `/api/cockpit`. Serverele se actualizează live (camerele `servers:<id>`), feed-ul și topul la activitate nouă.
 */
export function GcsCockpit({ pages, initial, siteName, image }: { pages: "home" | "all"; initial: GcsCockpitData | null; siteName: string; image: string | null }) {
  const pathname = usePathname();
  const shown = cockpitShownOn(pages, pathname);
  const [data, setData] = useState(initial);
  useEffect(() => {
    if (!shown || data) return;
    let alive = true;
    void fetch("/api/cockpit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: GcsCockpitData | null) => alive && d && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [shown, data]);
  const style = useMemo(() => (image ? ({ "--ck-image": `url("${image}")` } as CSSProperties) : undefined), [image]);
  if (!shown || !data) return null;
  return (
    <div className="gcs-ckWrap" style={style}>
      <GcsServerLiveProvider initial={data.statuses} pollSeconds={data.pollSeconds}>
        <CockpitView data={data} siteName={siteName} />
      </GcsServerLiveProvider>
    </div>
  );
}
