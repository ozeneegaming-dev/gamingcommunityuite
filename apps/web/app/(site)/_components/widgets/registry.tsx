import { GCS_RICH_FIELDS, richFieldHtml, sanitizeContentHtml, type GcsActor, type GcsWidgetPage, type GcsWidgetZone } from "@gcs/core";
import { POLL_INTERVAL_SETTING, type GcsUserRef } from "@gcs/modules";
import { GcsAvatar, GcsBadge, GcsButton, GcsCard, GcsClanTag, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { forumHref, memberHref, postHref, topicHref } from "@/lib/forum-urls";
import { onlineView } from "@/lib/online";
import { cardData, initialStatuses } from "@/lib/servers";
import { widgetCardVars } from "@/lib/template-data";
import { siteTemplate } from "@/lib/templates";
import { services } from "@/lib/services";
import { GcsShoutbox } from "../chat/GcsShoutbox";
import { GcsCollapseToggle } from "../GcsCollapseToggle";
import { GcsClanLogo } from "../clans/GcsClanLogo";
import { GcsRelTime } from "../forum/GcsRelTime";
import { GcsServerLiveProvider } from "../servers/GcsServerLive";
import { GcsServerPlayersTotal, GcsServerWidgetList } from "../servers/GcsServerWidgetList";
import { GcsOnlineSummary, GcsWhoIsOnline } from "../forum/GcsWhoIsOnline";
import { GcsGroupLegend, GcsStatsPanel, GcsWhoWasOnline } from "./GcsStatsPanel";
import { GcsCarousel } from "./GcsCarousel";
import { GcsGuestCta } from "../GcsGuestCta";
import { GcsRecentBadges } from "./GcsRecentBadges";
import { recentBadges, recentBadgesQuery } from "@/lib/recent-badges";
import { GcsWidgetTitle, widgetIcon } from "./GcsWidgetTitle";
import { GcsSlot, GcsSlotStyles, slotRootProps } from "@/lib/forum-slots";
import { widgetDecor } from "@/lib/widget-decor";
import { GcsMemberLink, GcsNamedHtml } from "@/lib/member-names";
import { GcsRankingPanel } from "../cockpit/GcsRankingPanel";
import { GcsDonationGoal } from "../donations/GcsDonationGoal";
import { donationCta } from "@/lib/donations.server";
import { COMMUNITY_METRICS, WIDGET_METRICS } from "@/lib/ranking";
import { isRankingMetric, isRankingPeriod, rankingMetrics, rankingRows } from "@/lib/ranking.server";
import { liveMatchList } from "@/lib/cockpit.server";
import { GcsRecordList } from "../pages/GcsRecordList";

/** Ce primește randarea unui widget: amplasarea (id, config), viewer-ul și locul ei (pagina, zona). */
export type GcsWidgetRenderProps = { id: string; config: Record<string, unknown>; actor: GcsActor; page: GcsWidgetPage; zone: GcsWidgetZone };
type Renderer = (p: GcsWidgetRenderProps) => Promise<ReactNode>;

const limitOf = (config: Record<string, unknown>, fallback: number) => (typeof config.limit === "number" ? config.limit : fallback);

type CardProps = { id: string; type: string; config: Record<string, unknown>; title: string; extra?: ReactNode; children: ReactNode; testId?: string };

/**
 * Cardul comun al widget-urilor (titlul cu iconița + conținut), ca în coloana din dreapta a machetei Main.
 * Iconița: cea aleasă pe amplasare (`config.icon`), altfel cea a widget-ului. Șablonul `widgets.card` (ACP → Aspect →
 * Șabloane) poate schimba markup-ul; conținutul și elementele de lângă titlu intră prin sloturi.
 */
async function GcsWidgetCard({ id, type, config, title, extra, children, testId }: CardProps) {
  const headingId = `gcs-widget-${id}`;
  const custom = await siteTemplate("widgets.card", widgetCardVars({ id, type, title, icon: widgetIcon(type, config), hasExtra: extra !== undefined && extra !== null, testId }), {
    content: children,
    extra,
  });
  if (custom) return custom;
  // Aspect forumuri: stilul benzii de titlu (imagine, voal, titlu colorat, iconiță) și eticheta, din extensiile active.
  const decor = await widgetDecor(config);
  return (
    <section {...slotRootProps(decor.style, { className: "gcs-card gcs-sideCard gcs-widget" })} aria-labelledby={headingId} data-widget={type} data-testid={testId}>
      <GcsSlotStyles plugins={decor.plugins} />
      <GcsWidgetTitle id={headingId} icon={widgetIcon(type, config)} extra={extra} chips={<GcsSlot slot="widget.title" items={decor.title} as="span" />}>
        {title}
      </GcsWidgetTitle>
      {/* Săgeata de restrângere stă în bandă (poziționată din CSS), în afara titlului. */}
      <GcsCollapseToggle storageKey={`widget-${id}`} title={title} />
      {children}
    </section>
  );
}

/** Avatarul unui rând din liste (ca în referință): rama membrului, link spre profil; autorul șters = avatar gol. */
function RowAvatar({ user }: { user: GcsUserRef | null }) {
  if (!user) return <span className="gcs-avatar gcs-avatar--s gcs-widgetRow__avatar" aria-hidden="true" />;
  return (
    <a href={memberHref(user)} className="gcs-widgetRow__avatar" tabIndex={-1} aria-hidden="true">
      <GcsAvatar name={user.name} size="s" userId={user.id} {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
    </a>
  );
}

/** Rândul de meta: autorul în stilul grupului · data relativă (sau alt text). */
function RowMeta({ user, children }: { user: GcsUserRef | null; children: ReactNode }) {
  return (
    <span className="gcs-widgetRow__meta">
      {user && (
        <>
          <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} href={memberHref(user)} />
          <span aria-hidden="true">·</span>
        </>
      )}
      {children}
    </span>
  );
}

/**
 * Textul anunțului: documentul scris în editor → HTML-ul produs de renderer (profilul `announcement`). Valorile vechi
 * (text): HTML-ul scris de admin trece prin sanitizer-ul conținutului; textul simplu devine paragrafe (rând gol =
 * paragraf nou, Enter = rând nou).
 */
function announcementHtml(body: unknown): string {
  if (typeof body !== "string") return richFieldHtml(body, GCS_RICH_FIELDS.announcement);
  const html = /<[a-z][\s\S]*>/i.test(body)
    ? body
    : body
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`)
        .join("");
  return sanitizeContentHtml(html);
}


/** Randarea fiecărui tip de widget (după cheia din `GcsWidgetDef`). Un tip necunoscut nu se randează. */
export const WIDGET_RENDERERS: Record<string, Renderer> = {
  "core.announcement": async ({ config, actor }) => {
    const [t, siteName] = await Promise.all([getTranslations("forum"), services().settings.get<string>("site.name")]);
    const title = typeof config.title === "string" && config.title.trim() ? config.title : t("announcement.title", { site: siteName });
    const body = announcementHtml(typeof config.body === "string" ? config.body.trim() : config.body);
    return (
      <GcsCard as="section" className="gcs-announcement gcs-widget" data-widget="core.announcement">
        <div className="gcs-announcement__text">
          <GcsBadge tone="accent" style={{ alignSelf: "flex-start" }}>
            {t("announcement.badge")}
          </GcsBadge>
          <GcsWidgetTitle as="h1" icon={widgetIcon("core.announcement", config)} variant="hero" className="gcs-announcement__title">
            {title}
          </GcsWidgetTitle>
          {body ? (
            <div className="gcs-announcement__body gcs-prose gcs-richText" dangerouslySetInnerHTML={{ __html: body }} />
          ) : (
            <p className="gcs-announcement__body">{t("announcement.body")}</p>
          )}
        </div>
        {!actor.userId && (
          <GcsButton variant="primary" asChild>
            <Link href="/register">{t("announcement.cta")}</Link>
          </GcsButton>
        )}
      </GcsCard>
    );
  },

  // „Cine e online”: sumarul (membri · vizitatori) în dreapta titlului, avatarele și numele primilor membri, „și încă N”.
  "core.online": async ({ id, config }) => {
    const [view, t, locale] = await Promise.all([onlineView(), getTranslations("online"), getLocale()]);
    const headingId = `gcs-widget-${id}`;
    return (
      <GcsWhoIsOnline
        initial={view}
        locale={locale}
        headingId={headingId}
        collapseKey={`widget-${id}`}
        heading={
          <GcsWidgetTitle id={headingId} icon={widgetIcon("core.online", config)} extra={<GcsOnlineSummary template={t.raw("summary") as string} />}>
            {t("title")}
          </GcsWidgetTitle>
        }
        labels={{ title: t("title"), summary: t.raw("summary") as string, record: t.raw("record") as string, nobody: t("nobody") }}
      />
    );
  },

  "core.statsPanel": async ({ id, config }) => <GcsStatsPanel id={id} config={config} />,
  "core.onlineDay": async ({ id, config }) => <GcsWhoWasOnline id={id} config={config} />,
  // Doar vizitatorii îl văd (membrii sunt deja înăuntru).
  "core.guestCta": async ({ id, actor }) => (actor.userId ? null : <GcsGuestCta variant="widget" headingId={`gcs-widget-${id}`} />),
  "core.groupLegend": async ({ id, config }) => <GcsGroupLegend id={id} config={config} />,
  // Reclama (ACP › Promovare › Reclame): ascunsă grupurilor alese acolo; click-ul trece prin `/go/ad/<id>` (numărat).
  "core.ad": async ({ id, actor, config }) => {
    const unit = typeof config.unit === "string" && /^\d+$/.test(config.unit) ? Number(config.unit) : null;
    const ad = await services().ads.pick(actor.groupIds, unit);
    if (!ad) return null;
    const t = await getTranslations("widgets");
    return (
      <aside className="gcs-adUnit" aria-label={t("adLabel")} data-testid="gcs-ad" data-ad={ad.id} id={`gcs-widget-${id}`}>
        <span className="gcs-adUnit__tag">{t("adLabel")}</span>
        {ad.kind === "html" ? (
          <div className="gcs-adUnit__html" dangerouslySetInnerHTML={{ __html: sanitizeContentHtml(ad.html) }} />
        ) : ad.linkUrl ? (
          <a href={`/go/ad/${ad.id}`} target="_blank" rel="sponsored noopener" className="gcs-adUnit__link">
            <img src={ad.imageUrl} alt={ad.alt} loading="lazy" />
          </a>
        ) : (
          <img src={ad.imageUrl} alt={ad.alt} loading="lazy" />
        )}
      </aside>
    );
  },

  // Realizări v2: ultimele badge-uri primite, cu actualizare live (camera `feed:badges`).
  "profile.recentBadges": async ({ id, config }) => {
    const q = recentBadgesQuery(config);
    const [t, items] = await Promise.all([getTranslations("widgets"), recentBadges(q)]);
    const query = new URLSearchParams({ limit: String(q.limit), ...(q.rareOnly ? { rare: "1" } : {}), ...(q.groupId ? { group: String(q.groupId) } : {}) }).toString();
    return (
      <GcsWidgetCard id={id} type="profile.recentBadges" config={config} title={t("profile.recentBadges")} testId="gcs-widget-recent-badges">
        <GcsRecentBadges initial={items} query={query} />
      </GcsWidgetCard>
    );
  },

  "core.newMembers": async ({ id, config }) => {
    const [t, list] = await Promise.all([getTranslations("widgets"), services().forumQueries.newMembers(limitOf(config, 5))]);
    return (
      <GcsWidgetCard id={id} type="core.newMembers" config={config} title={t("core.newMembers")} testId="gcs-widget-new-members">
        {list.length === 0 ? (
          <p className="gcs-sideCard__line">{t("empty")}</p>
        ) : (
          <ul className="gcs-widgetList">
            {list.map((m) => (
              <li key={m.user.id} className="gcs-widgetRow">
                <RowAvatar user={m.user} />
                <span className="gcs-widgetRow__body">
                  <span className="gcs-widgetRow__title">
                    <GcsMemberName userId={m.user.id} name={m.user.name} nameKey={m.user.nameKey} href={memberHref(m.user)} />
                  </span>
                  <RowMeta user={null}>
                    <GcsRelTime at={m.joinedAt} />
                  </RowMeta>
                </span>
              </li>
            ))}
          </ul>
        )}
      </GcsWidgetCard>
    );
  },

  "forums.stats": async ({ id, config }) => {
    const [t, format, stats] = await Promise.all([getTranslations("forum.sidebar"), getFormatter(), services().forumQueries.stats()]);
    const n = (v: number) => format.number(v);
    const newest = stats.newestMember;
    return (
      <GcsWidgetCard id={id} type="forums.stats" config={config} title={t("stats")}>
        <dl className="gcs-statGrid">
          <div>
            <dt>{t("topics")}</dt>
            <dd>{n(stats.topics)}</dd>
          </div>
          <div>
            <dt>{t("posts")}</dt>
            <dd>{n(stats.posts)}</dd>
          </div>
          <div>
            <dt>{t("members")}</dt>
            <dd>{n(stats.members)}</dd>
          </div>
        </dl>
        {newest && (
          <div className="gcs-widgetRow gcs-widgetRow--newest">
            <RowAvatar user={newest} />
            <span className="gcs-widgetRow__body">
              <span className="gcs-widgetRow__meta">{t("newest")}</span>
              <span className="gcs-widgetRow__title">
                <GcsMemberName userId={newest.id} name={newest.name} nameKey={newest.nameKey} href={memberHref(newest)} />
              </span>
            </span>
          </div>
        )}
      </GcsWidgetCard>
    );
  },

  "forums.recentTopics": async ({ id, config, actor }) => {
    const [t, recent] = await Promise.all([getTranslations("forum.sidebar"), services().forumQueries.recentTopics(actor, limitOf(config, 6))]);
    return (
      <GcsWidgetCard id={id} type="forums.recentTopics" config={config} title={t("recent")}>
        {recent.length === 0 ? (
          <p className="gcs-sideCard__line">{t("noRecent")}</p>
        ) : (
          <ul className="gcs-widgetList">
            {recent.map((r) => (
              <li key={r.id} className="gcs-widgetRow">
                <RowAvatar user={r.user} />
                <span className="gcs-widgetRow__body">
                  <Link href={topicHref(r)} className="gcs-widgetRow__title">
                    {r.title}
                  </Link>
                  <RowMeta user={r.user}>
                    <GcsRelTime at={r.lastPostAt} />
                  </RowMeta>
                </span>
              </li>
            ))}
          </ul>
        )}
      </GcsWidgetCard>
    );
  },

  // În coloana îngustă: titlul topicului pe un rând, autorul și timpul (fără fragment), linkul „Activitate” sus.
  "forums.recentPosts": async ({ id, config, actor, zone }) => {
    const narrow = zone === "sidebar";
    const [t, posts] = await Promise.all([getTranslations("widgets"), services().forumQueries.recentPosts(actor, limitOf(config, 5))]);
    return (
      <GcsWidgetCard
        id={id}
        type="forums.recentPosts"
        config={config}
        title={t("forums.recentPosts")}
        testId="gcs-widget-recent-posts"
        extra={
          narrow ? (
            <Link href="/activity" className="gcs-widgetTitle__link">
              {t("home.activity")}
            </Link>
          ) : undefined
        }
      >
        {posts.length === 0 ? (
          <p className="gcs-sideCard__line">{t("empty")}</p>
        ) : (
          <ul className={`gcs-widgetList${narrow ? " gcs-widgetList--oneLine" : ""}`}>
            {posts.map((p) => (
              <li key={p.id} className="gcs-widgetRow">
                <RowAvatar user={p.user} />
                <span className="gcs-widgetRow__body">
                  <Link href={postHref(p.topicId, p.id)} className="gcs-widgetRow__title" title={narrow ? p.topicTitle : undefined}>
                    {p.topicTitle}
                  </Link>
                  {!narrow && p.excerpt && <span className="gcs-widget__excerpt">{p.excerpt}</span>}
                  <RowMeta user={p.user}>
                    <GcsRelTime at={p.at} />
                  </RowMeta>
                </span>
              </li>
            ))}
          </ul>
        )}
      </GcsWidgetCard>
    );
  },

  "forums.topPosters": async ({ id, config }) => {
    const period = config.period === "week" || config.period === "all" ? config.period : "month";
    const [t, list] = await Promise.all([getTranslations("widgets"), services().forumQueries.topPosters(period, limitOf(config, 5))]);
    return (
      <GcsWidgetCard id={id} type="forums.topPosters" config={config} title={t("forums.topPosters")} extra={t(`periods.${period}`)}>
        {list.length === 0 ? (
          <p className="gcs-sideCard__line">{t("empty")}</p>
        ) : (
          <ol className="gcs-widgetList gcs-widgetList--rank">
            {list.map((r, i) => (
              <li key={r.user.id} className="gcs-widgetRow">
                <span className="gcs-widgetRow__rank" aria-hidden="true">
                  {i + 1}
                </span>
                <RowAvatar user={r.user} />
                <span className="gcs-widgetRow__body">
                  <span className="gcs-widgetRow__title">
                    <GcsMemberName userId={r.user.id} name={r.user.name} nameKey={r.user.nameKey} href={memberHref(r.user)} />
                  </span>
                  <span className="gcs-widgetRow__meta">{t("posts", { count: r.posts })}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </GcsWidgetCard>
    );
  },

  // Tab-urile „Forum” (implicit): măsurile forumului și perioada. Tab-urile „Comunitate” (prima pagină nouă): „Topul
  // săptămânii” (sau al perioadei alese) cu Postatori / Jucători / Clanuri (doar aplicațiile la care viewer-ul are acces).
  "core.ranking": async ({ id, config, actor }) => {
    const community = config.tabs === "community";
    const metrics = community ? await rankingMetrics(actor, COMMUNITY_METRICS) : [...WIDGET_METRICS];
    const metric = isRankingMetric(config.metric) && metrics.includes(config.metric) ? config.metric : (metrics[0] ?? "posts");
    const period = isRankingPeriod(config.period) ? config.period : "day";
    const [t, initial] = await Promise.all([getTranslations("widgets"), rankingRows(actor, metric, period, 5)]);
    return (
      <GcsWidgetCard id={id} type="core.ranking" config={config} title={community ? t("core.rankingTop", { period }) : t("core.ranking")} testId="gcs-widget-ranking">
        <GcsRankingPanel initial={initial} metrics={metrics} variant={community ? "compact" : "widget"} testId="gcs-ranking-widget" />
      </GcsWidgetCard>
    );
  },

  "forums.featuredTopics": async ({ id, config, actor }) => {
    const [t, topics] = await Promise.all([getTranslations("widgets"), services().forumQueries.featuredTopics(actor, limitOf(config, 5))]);
    return (
      <GcsWidgetCard id={id} type="forums.featuredTopics" config={config} title={t("forums.featuredTopics")}>
        {topics.length === 0 ? (
          <p className="gcs-sideCard__line">{t("empty")}</p>
        ) : (
          <ul className="gcs-widgetList">
            {topics.map((tp) => (
              <li key={tp.id} className="gcs-widgetRow">
                <RowAvatar user={tp.user} />
                <span className="gcs-widgetRow__body">
                  <Link href={topicHref(tp)} className="gcs-widgetRow__title">
                    {tp.title}
                  </Link>
                  <RowMeta user={tp.user}>
                    <GcsRelTime at={tp.createdAt} />
                  </RowMeta>
                </span>
              </li>
            ))}
          </ul>
        )}
      </GcsWidgetCard>
    );
  },

  // Forum v2: „Cele mai bine notate”: topicurile notate din ultima lună (cu cel puțin 2 voturi), cu media.
  "forums.topRated": async ({ id, config, actor }) => {
    const [t, topics] = await Promise.all([getTranslations("widgets"), services().forumQueries.topRated(actor, { limit: limitOf(config, 5), minVotes: 2, days: 30 })]);
    return (
      <GcsWidgetCard id={id} type="forums.topRated" config={config} title={t("forums.topRated")} testId="gcs-widget-top-rated">
        {topics.length === 0 ? (
          <p className="gcs-sideCard__line">{t("empty")}</p>
        ) : (
          <ul className="gcs-widgetList">
            {topics.map((tp) => (
              <li key={tp.id} className="gcs-widgetRow">
                <span className="gcs-widgetRow__body">
                  <Link href={topicHref(tp)} className="gcs-widgetRow__title">
                    {tp.title}
                  </Link>
                </span>
                <span className="gcs-widgetRow__rating" aria-label={t("ratingAria", { avg: tp.avg.toFixed(1), count: tp.count })}>
                  ★ {tp.avg.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </GcsWidgetCard>
    );
  },

  // Caruselul topicurilor recomandate: carduri cu imaginea primului mesaj (sau un gradient generat), forumul, data,
  // titlul, extrasul, autorul și „Citește”. Fără topicuri recomandate nu se afișează nimic.
  "forums.featuredCarousel": async ({ id, config, actor }) => {
    const [t, format, slides] = await Promise.all([getTranslations("widgets"), getFormatter(), services().forumQueries.featuredCarousel(actor, limitOf(config, 8))]);
    if (slides.length === 0) return null;
    const headingId = `gcs-widget-${id}`;
    return (
      <section className="gcs-carousel gcs-widget" aria-labelledby={headingId} data-widget="forums.featuredCarousel" data-testid="gcs-widget-carousel">
        <h2 id={headingId} className="gcs-srOnly">
          {t("forums.featuredCarousel")}
        </h2>
        <GcsCarousel label={t("forums.featuredCarousel")} labels={{ prev: t("carousel.prev"), next: t("carousel.next") }}>
          {slides.map((s) => {
            // Fără imagine: un gradient din culoarea forumului (sau din id-ul topicului), cu lumina de accent.
            const hue = (s.id * 47) % 360;
            const glow = s.forum?.color && /^#[0-9a-f]{6}$/i.test(s.forum.color) ? `${s.forum.color}66` : `hsl(${hue} 75% 50% / 0.4)`;
            const art = s.image
              ? { backgroundImage: `url(${JSON.stringify(s.image)})` }
              : { backgroundImage: `radial-gradient(ellipse 80% 90% at 85% 0%, ${glow}, transparent 60%), linear-gradient(135deg, hsl(${hue} 45% 22%), hsl(${(hue + 40) % 360} 40% 10%))` };
            return (
              <article key={s.id} className="gcs-carousel__card" data-testid="gcs-carousel-card" data-image={s.image ? "" : undefined}>
                <span className="gcs-carousel__art" style={art} aria-hidden="true" />
                <div className="gcs-carousel__top">
                  {s.forum && (
                    <Link href={forumHref(s.forum)} className="gcs-carousel__pill" style={s.forum.color ? { background: s.forum.color } : undefined}>
                      {s.forum.name}
                    </Link>
                  )}
                  <span className="gcs-carousel__date">
                    <GcsIcon name="fa-regular fa-calendar" />
                    {format.dateTime(new Date(s.createdAt), { day: "numeric", month: "long" })}
                  </span>
                </div>
                <h3 className="gcs-carousel__title">
                  <Link href={topicHref(s)}>{s.title}</Link>
                </h3>
                {s.excerpt && <p className="gcs-carousel__excerpt">{s.excerpt}</p>}
                <div className="gcs-carousel__foot">
                  {s.user ? (
                    <span className="gcs-carousel__author">
                      <GcsAvatar name={s.user.name} size="s" userId={s.user.id} {...(s.user.image ? { src: s.user.image } : {})} />
                      <GcsMemberName userId={s.user.id} name={s.user.name} nameKey={s.user.nameKey} href={memberHref(s.user)} />
                    </span>
                  ) : (
                    <span />
                  )}
                  <Link href={topicHref(s)} className="gcs-btn gcs-btn--primary gcs-btn--sm gcs-carousel__read" aria-label={`${t("carousel.read")}: ${s.title}`}>
                    {t("carousel.read")}
                    <GcsIcon name="fa-solid fa-arrow-right" />
                  </Link>
                </div>
              </article>
            );
          })}
        </GcsCarousel>
      </section>
    );
  },

  "chat.shoutbox": async ({ config, actor }) => <GcsShoutbox actor={actor} channelKey={typeof config.channel === "string" && config.channel ? config.channel : null} />,

  // Aplicația Servere: lista, cu statusul live (realtime sau, fără el, cererea periodică). Aspectul compact (coloana
  // îngustă a primei pagini): numele, jucătorii și bara de ocupare, cu jucătorii de pe toate serverele lângă titlu.
  "servers.list": async ({ id, config, actor }) => {
    const { serverQueries, settings } = services();
    const family = typeof config.game === "string" && config.game ? config.game : null;
    const compact = config.layout === "compact";
    const [t, ts, list, interval] = await Promise.all([
      getTranslations("widgets"),
      getTranslations("servers"),
      serverQueries.list(actor, { family, limit: limitOf(config, 5) }),
      settings.get<number>(POLL_INTERVAL_SETTING),
    ]);
    const card = (
      <GcsWidgetCard
        id={id}
        type="servers.list"
        config={config}
        title={t("servers.list")}
        testId="gcs-widget-servers"
        extra={compact && list.length > 0 ? <GcsServerPlayersTotal ids={list.map((v) => v.id)} /> : undefined}
      >
        {list.length === 0 ? <p className="gcs-sideCard__line">{ts("widgetEmpty")}</p> : <GcsServerWidgetList servers={list.map((v) => cardData(v))} variant={compact ? "compact" : "full"} />}
        <Link href="/servers" className="gcs-serverList__all">
          {ts("viewAll")}
        </Link>
      </GcsWidgetCard>
    );
    // Statusul live ajunge și la totalul din titlu, deci furnizorul cuprinde tot cardul.
    return list.length === 0 ? (
      card
    ) : (
      <GcsServerLiveProvider initial={initialStatuses(list)} pollSeconds={interval}>
        {card}
      </GcsServerLiveProvider>
    );
  },

  // „Meciuri live”: meciurile mix în desfășurare (aceleași date ca panoul „Live acum” al consolei), cu scorul; fără
  // niciunul, „Niciun meci live acum”. Fără aplicația Servere sau fără dreptul la statistici, widget-ul nu apare.
  "servers.liveMatches": async ({ id, config, actor }) => {
    const data = await liveMatchList(actor, limitOf(config, 3));
    if (!data) return null;
    const [t, tl] = await Promise.all([getTranslations("widgets"), getTranslations("cockpit.live")]);
    return (
      <GcsWidgetCard
        id={id}
        type="servers.liveMatches"
        config={config}
        title={t("servers.liveMatches")}
        testId="gcs-widget-live-matches"
        extra={
          <Link href="/servers/matches?status=live" className="gcs-widgetTitle__link" data-testid="gcs-live-matches-all">
            {data.total > data.items.length ? t("home.allCount", { count: data.total }) : t("home.all")}
          </Link>
        }
      >
        {data.items.length === 0 ? (
          <p className="gcs-liveMatches__empty" data-testid="gcs-live-matches-empty">
            {tl("nothing")}
          </p>
        ) : (
          <ul className="gcs-liveMatches">
            {data.items.map((m) => (
              <li key={m.id} className="gcs-liveMatches__row" data-testid="gcs-live-match">
                <Link href={m.href} className="gcs-liveMatches__link">
                  <span className="gcs-liveMatches__meta">
                    <span className="gcs-liveMatches__badge">{tl("badge")}</span>
                    <span className="gcs-liveMatches__where">{[m.server, m.map, tl("round", { round: m.round })].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="gcs-liveMatches__score">
                    <b className="gcs-liveMatches__team">{m.teams.A.name}</b>
                    <span className="gcs-liveMatches__points">
                      {m.teams.A.score}:{m.teams.B.score}
                    </span>
                    <b className="gcs-liveMatches__team gcs-liveMatches__team--b">{m.teams.B.name}</b>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </GcsWidgetCard>
    );
  },

  // Puntea serverelor: adminii online acum (numele, serverul, de cât timp), din lista ultimului heartbeat.
  "servers.adminsOnline": async ({ id, config, actor }) => {
    const { bridge } = services();
    const list = await bridge.queries.onlineAdmins(actor, limitOf(config, 8));
    if (list === null) return null;
    const [t, tb, format] = await Promise.all([getTranslations("widgets"), getTranslations("bridge.widget"), getFormatter()]);
    return (
      <GcsWidgetCard id={id} type="servers.adminsOnline" config={config} title={t("servers.adminsOnline")} testId="gcs-widget-admins-online" extra={list.length > 0 ? String(list.length) : undefined}>
        {list.length === 0 ? (
          <p className="gcs-sideCard__line">{tb("empty")}</p>
        ) : (
          <ul className="gcs-adminRows">
            {list.map((a) => (
              <li key={`${a.server.id}-${a.adminId ?? `p${a.playerId}`}`} className="gcs-adminRow" data-state="online" data-testid="gcs-widget-admin">
                <span className="gcs-dot" aria-hidden="true" />
                <span className="gcs-adminRow__name">{a.user ? <GcsMemberLink user={a.user} /> : a.name}</span>
                <span className="gcs-adminRow__meta">
                  {a.since ? tb("since", { server: a.server.name, time: format.relativeTime(new Date(a.since)) }) : a.server.name}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/servers/admins" className="gcs-serverList__all">
          {tb("all")}
        </Link>
      </GcsWidgetCard>
    );
  },

  // VIP clasic › Donații: „Obiectivul lunii” (progresul live, donatorii, ultimul donator, „Susține comunitatea”). Fără
  // obiectiv activ vizibil viewer-ului, widget-ul nu apare.
  "vip.donationGoal": async ({ id, config, actor }) => {
    const goalParam = typeof config.goal === "string" && /^\d{1,9}$/.test(config.goal) ? config.goal : "";
    const [t, view, cta] = await Promise.all([getTranslations("widgets"), services().donations.goalView(actor, goalParam ? Number(goalParam) : null), donationCta()]);
    if (!view) return null;
    return (
      <GcsWidgetCard id={id} type="vip.donationGoal" config={config} title={t("vip.donationGoal")} testId="gcs-widget-donation-goal">
        <GcsDonationGoal initial={view} goalParam={goalParam} showLast={config.lastDonor !== "hide"} showCount={config.donorCount !== "hide"} cta={cta} variant="widget" />
      </GcsWidgetCard>
    );
  },

  // Aplicația Clanuri: primele clanuri din clasament (locul, logo-ul, plăcuța, numele, membrii, punctele).
  "clans.top": async ({ id, config, actor }) => {
    const { clanQueries } = services();
    if (!(await clanQueries.canView(actor))) return null;
    const [t, tc, format, list] = await Promise.all([getTranslations("widgets"), getTranslations("clans"), getFormatter(), clanQueries.top(limitOf(config, 5))]);
    return (
      <GcsWidgetCard id={id} type="clans.top" config={config} title={t("clans.top")} testId="gcs-widget-clans">
        {list.length === 0 ? (
          <p className="gcs-sideCard__line">{tc("widgetEmpty")}</p>
        ) : (
          <ol className="gcs-clanWidget">
            {list.map((c, i) => (
              <li key={c.id} className="gcs-clanWidget__row" data-testid="gcs-widget-clan">
                <span className="gcs-clanWidget__pos">{c.rank ?? i + 1}</span>
                <GcsClanLogo clan={c} size="s" />
                <span className="gcs-clanWidget__body">
                  <span className="gcs-clanWidget__name">
                    <GcsClanTag clan={c} size="sm" />
                    <Link href={c.href}>{c.name}</Link>
                  </span>
                  <span className="gcs-clanWidget__meta">{tc("widgetMeta", { members: c.membersCount, score: format.number(c.score) })}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <Link href="/clans" className="gcs-clanList__all">
          {tc("viewAll")}
        </Link>
      </GcsWidgetCard>
    );
  },
  // Aplicația Pagini: înregistrările unei baze de date (cele mai noi, recomandate, bine notate…) și un bloc reutilizabil.
  "pages.records": async ({ id, config, actor, zone }) => {
    const databaseId = Number(config.database);
    if (!Number.isSafeInteger(databaseId) || databaseId <= 0) return null;
    const sort = typeof config.sort === "string" ? config.sort : "newest";
    const data = await services().pagesQueries.latest(actor, databaseId, { limit: limitOf(config, 5), sort });
    if (!data) return null;
    const t = await getTranslations("pages");
    return (
      <GcsWidgetCard id={id} type="pages.records" config={config} title={data.db.name} testId="gcs-widget-pages-records">
        <GcsRecordList db={data.db} records={data.records} view={zone === "sidebar" ? "compact" : "list"} hideImages={zone === "sidebar"} />
        <Link href={`/pages/${data.db.path}`} className="gcs-clanList__all">
          {t("viewAll", { name: data.db.name })}
        </Link>
      </GcsWidgetCard>
    );
  },
  "pages.block": async ({ id, config }) => {
    const blockId = Number(config.block);
    if (!Number.isSafeInteger(blockId) || blockId <= 0) return null;
    const b = (await services().pagesQueries.blocks([blockId])).get(blockId);
    if (!b?.html) return null;
    return (
      <GcsWidgetCard id={id} type="pages.block" config={config} title={b.name} testId="gcs-widget-pages-block">
        <GcsNamedHtml className={b.kind === "content" ? "gcs-postBody gcs-pgBlock__body" : "gcs-pgBlock__html"} html={b.html} userContent={b.kind === "content"} />
      </GcsWidgetCard>
    );
  },
};
