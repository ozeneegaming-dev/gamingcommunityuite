import { sanitizeContentHtml, type GcsActor } from "@gcs/core";
import type { GcsUserRef } from "@gcs/modules";
import { GcsAvatar, GcsBadge, GcsButton, GcsCard, GcsUserLink } from "@gcs/ui";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { memberHref, postHref, topicHref } from "@/lib/forum-urls";
import { onlineView } from "@/lib/online";
import { widgetCardVars } from "@/lib/template-data";
import { siteTemplate } from "@/lib/templates";
import { services } from "@/lib/services";
import { GcsShoutbox } from "../chat/GcsShoutbox";
import { GcsRelTime } from "../forum/GcsRelTime";
import { GcsWhoIsOnline } from "../forum/GcsWhoIsOnline";
import { GcsGroupLegend, GcsStatsPanel, GcsWhoWasOnline } from "./GcsStatsPanel";
import { GcsWidgetTitle, widgetIcon } from "./GcsWidgetTitle";

export type GcsWidgetRenderProps = { id: string; config: Record<string, unknown>; actor: GcsActor };
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
  return (
    <section className="gcs-card gcs-sideCard gcs-widget" aria-labelledby={headingId} data-widget={type} data-testid={testId}>
      <GcsWidgetTitle id={headingId} icon={widgetIcon(type, config)} extra={extra}>
        {title}
      </GcsWidgetTitle>
      {children}
    </section>
  );
}

/** Avatarul unui rând din liste (ca în referință): rama membrului, link spre profil; autorul șters = avatar gol. */
function RowAvatar({ user }: { user: GcsUserRef | null }) {
  if (!user) return <span className="gcs-avatar gcs-avatar--s gcs-widgetRow__avatar" aria-hidden="true" />;
  return (
    <a href={memberHref(user)} className="gcs-widgetRow__avatar" tabIndex={-1} aria-hidden="true">
      <GcsAvatar name={user.name} size="s" {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
    </a>
  );
}

/** Rândul de meta: autorul în stilul grupului · data relativă (sau alt text). */
function RowMeta({ user, children }: { user: GcsUserRef | null; children: ReactNode }) {
  return (
    <span className="gcs-widgetRow__meta">
      {user && (
        <>
          <GcsUserLink userId={user.id} name={user.name} nameKey={user.nameKey} href={memberHref(user)} />
          <span aria-hidden="true">·</span>
        </>
      )}
      {children}
    </span>
  );
}

/**
 * Textul anunțului: HTML-ul scris de admin trece prin sanitizer-ul conținutului; textul simplu devine paragrafe
 * (rând gol = paragraf nou, Enter = rând nou).
 */
function announcementHtml(body: string): string {
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
    const body = typeof config.body === "string" ? config.body.trim() : "";
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
            <div className="gcs-announcement__body gcs-prose" dangerouslySetInnerHTML={{ __html: announcementHtml(body) }} />
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

  "core.online": async ({ id, config }) => {
    const [view, t, locale] = await Promise.all([onlineView(), getTranslations("online"), getLocale()]);
    const headingId = `gcs-widget-${id}`;
    return (
      <GcsWhoIsOnline
        initial={view}
        locale={locale}
        headingId={headingId}
        heading={
          <GcsWidgetTitle id={headingId} icon={widgetIcon("core.online", config)}>
            {t("title")}
          </GcsWidgetTitle>
        }
        labels={{ title: t("title"), summary: t.raw("summary") as string, record: t.raw("record") as string, nobody: t("nobody") }}
      />
    );
  },

  "core.statsPanel": async ({ id, config }) => <GcsStatsPanel id={id} config={config} />,
  "core.onlineDay": async ({ id, config }) => <GcsWhoWasOnline id={id} config={config} />,
  "core.groupLegend": async ({ id, config }) => <GcsGroupLegend id={id} config={config} />,

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
                    <GcsUserLink userId={m.user.id} name={m.user.name} nameKey={m.user.nameKey} href={memberHref(m.user)} />
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
                <GcsUserLink userId={newest.id} name={newest.name} nameKey={newest.nameKey} href={memberHref(newest)} />
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

  "forums.recentPosts": async ({ id, config, actor }) => {
    const [t, posts] = await Promise.all([getTranslations("widgets"), services().forumQueries.recentPosts(actor, limitOf(config, 5))]);
    return (
      <GcsWidgetCard id={id} type="forums.recentPosts" config={config} title={t("forums.recentPosts")}>
        {posts.length === 0 ? (
          <p className="gcs-sideCard__line">{t("empty")}</p>
        ) : (
          <ul className="gcs-widgetList">
            {posts.map((p) => (
              <li key={p.id} className="gcs-widgetRow">
                <RowAvatar user={p.user} />
                <span className="gcs-widgetRow__body">
                  <Link href={postHref(p.topicId, p.id)} className="gcs-widgetRow__title">
                    {p.topicTitle}
                  </Link>
                  {p.excerpt && <span className="gcs-widget__excerpt">{p.excerpt}</span>}
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
                    <GcsUserLink userId={r.user.id} name={r.user.name} nameKey={r.user.nameKey} href={memberHref(r.user)} />
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

  "chat.shoutbox": async ({ config, actor }) => <GcsShoutbox actor={actor} channelKey={typeof config.channel === "string" && config.channel ? config.channel : null} />,
};
