import { sanitizeContentHtml, type GcsActor } from "@gcs/core";
import { GcsBadge, GcsButton, GcsCard, GcsUserLink } from "@gcs/ui";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { memberHref, postHref, topicHref } from "@/lib/forum-urls";
import { onlineView } from "@/lib/online";
import { services } from "@/lib/services";
import { GcsShoutbox } from "../chat/GcsShoutbox";
import { GcsRelTime } from "../forum/GcsRelTime";
import { GcsWhoIsOnline } from "../forum/GcsWhoIsOnline";
import { GcsGroupLegend, GcsStatsPanel, GcsWhoWasOnline } from "./GcsStatsPanel";

export type GcsWidgetRenderProps = { id: string; config: Record<string, unknown>; actor: GcsActor };
type Renderer = (p: GcsWidgetRenderProps) => Promise<ReactNode>;

const limitOf = (config: Record<string, unknown>, fallback: number) => (typeof config.limit === "number" ? config.limit : fallback);

/** Cardul comun al widget-urilor (titlu + conținut), ca în coloana din dreapta a machetei Main. */
function GcsWidgetCard({ id, type, title, children, testId }: { id: string; type: string; title: string; children: ReactNode; testId?: string }) {
  const headingId = `gcs-widget-${id}`;
  return (
    <section className="gcs-card gcs-sideCard gcs-widget" aria-labelledby={headingId} data-widget={type} data-testid={testId}>
      <h2 id={headingId} className="gcs-display gcs-sideCard__title">
        {title}
      </h2>
      {children}
    </section>
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
          <h1 className="gcs-display gcs-announcement__title">{title}</h1>
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

  "core.online": async () => {
    const [view, t, locale] = await Promise.all([onlineView(), getTranslations("online"), getLocale()]);
    return (
      <GcsWhoIsOnline
        initial={view}
        locale={locale}
        labels={{ title: t("title"), summary: t.raw("summary") as string, record: t.raw("record") as string, nobody: t("nobody") }}
      />
    );
  },

  "core.statsPanel": async ({ id }) => <GcsStatsPanel id={id} />,
  "core.onlineDay": async ({ id }) => <GcsWhoWasOnline id={id} />,
  "core.groupLegend": async ({ id }) => <GcsGroupLegend id={id} />,

  "core.newMembers": async ({ id, config }) => {
    const [t, list] = await Promise.all([getTranslations("widgets"), services().forumQueries.newMembers(limitOf(config, 5))]);
    return (
      <GcsWidgetCard id={id} type="core.newMembers" title={t("core.newMembers")} testId="gcs-widget-new-members">
        <ul className="gcs-recentList">
          {list.map((m) => (
            <li key={m.user.id}>
              <GcsUserLink userId={m.user.id} name={m.user.name} nameKey={m.user.nameKey} href={memberHref(m.user)} />
              <span>
                <GcsRelTime at={m.joinedAt} />
              </span>
            </li>
          ))}
        </ul>
      </GcsWidgetCard>
    );
  },

  "forums.stats": async ({ id }) => {
    const [t, format, stats] = await Promise.all([getTranslations("forum.sidebar"), getFormatter(), services().forumQueries.stats()]);
    const n = (v: number) => format.number(v);
    return (
      <GcsWidgetCard id={id} type="forums.stats" title={t("stats")}>
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
        {stats.newestMember && (
          <p className="gcs-sideCard__line">
            {t("newest")}:{" "}
            <GcsUserLink userId={stats.newestMember.id} name={stats.newestMember.name} nameKey={stats.newestMember.nameKey} href={memberHref(stats.newestMember)} />
          </p>
        )}
      </GcsWidgetCard>
    );
  },

  "forums.recentTopics": async ({ id, config, actor }) => {
    const [t, recent] = await Promise.all([getTranslations("forum.sidebar"), services().forumQueries.recentTopics(actor, limitOf(config, 6))]);
    return (
      <GcsWidgetCard id={id} type="forums.recentTopics" title={t("recent")}>
        {recent.length === 0 ? (
          <p className="gcs-sideCard__line">{t("noRecent")}</p>
        ) : (
          <ul className="gcs-recentList">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={topicHref(r)}>{r.title}</Link>
                <span>
                  {r.user && (
                    <>
                      <GcsUserLink userId={r.user.id} name={r.user.name} nameKey={r.user.nameKey} href={memberHref(r.user)} />
                      {" · "}
                    </>
                  )}
                  <GcsRelTime at={r.lastPostAt} />
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
      <GcsWidgetCard id={id} type="forums.recentPosts" title={t("forums.recentPosts")}>
        {posts.length === 0 ? (
          <p className="gcs-sideCard__line">{t("empty")}</p>
        ) : (
          <ul className="gcs-recentList">
            {posts.map((p) => (
              <li key={p.id}>
                <Link href={postHref(p.topicId, p.id)}>{p.topicTitle}</Link>
                {p.excerpt && <span className="gcs-widget__excerpt">{p.excerpt}</span>}
                <span>
                  {p.user && (
                    <>
                      <GcsUserLink userId={p.user.id} name={p.user.name} nameKey={p.user.nameKey} href={memberHref(p.user)} />
                      {" · "}
                    </>
                  )}
                  <GcsRelTime at={p.at} />
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
      <GcsWidgetCard id={id} type="forums.topPosters" title={`${t("forums.topPosters")} · ${t(`periods.${period}`)}`}>
        {list.length === 0 ? (
          <p className="gcs-sideCard__line">{t("empty")}</p>
        ) : (
          <ol className="gcs-rankList">
            {list.map((r) => (
              <li key={r.user.id}>
                <GcsUserLink userId={r.user.id} name={r.user.name} nameKey={r.user.nameKey} href={memberHref(r.user)} />
                <span>{t("posts", { count: r.posts })}</span>
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
      <GcsWidgetCard id={id} type="forums.featuredTopics" title={t("forums.featuredTopics")}>
        {topics.length === 0 ? (
          <p className="gcs-sideCard__line">{t("empty")}</p>
        ) : (
          <ul className="gcs-recentList">
            {topics.map((tp) => (
              <li key={tp.id}>
                <Link href={topicHref(tp)}>{tp.title}</Link>
                <span>
                  {tp.user && (
                    <>
                      <GcsUserLink userId={tp.user.id} name={tp.user.name} nameKey={tp.user.nameKey} href={memberHref(tp.user)} />
                      {" · "}
                    </>
                  )}
                  <GcsRelTime at={tp.createdAt} />
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
