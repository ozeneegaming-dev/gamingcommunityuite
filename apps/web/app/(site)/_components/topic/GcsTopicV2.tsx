import type { GcsTopicNoticeView, GcsTopicSummary } from "@gcs/modules";
import { GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { getFormatter, getTranslations } from "next-intl/server";
import { memberHref, postHref } from "@/lib/forum-urls";
import { GcsNamedHtml } from "@/lib/member-names";
import { GcsNoticeDelete } from "./GcsNoticeDelete";

/**
 * Bucățile Forum v2 ale paginii unui topic (server): mesajele moderatorilor, separatorul „N luni mai târziu…”, rezumatul
 * topicului și banda unui topic arhivat. Toate pe tokenurile temei, în orice temă.
 */

const NOTICE_ICONS = { info: "fa-solid fa-circle-info", warn: "fa-solid fa-triangle-exclamation", ok: "fa-solid fa-circle-check", danger: "fa-solid fa-circle-exclamation" } as const;

/** Mesajele moderatorilor („Adaugă mesaj”), sus în topic. Numele moderatorului după setarea globală. */
export async function GcsTopicNotices({ notices, showNames, canDelete }: { notices: GcsTopicNoticeView[]; showNames: boolean; canDelete: boolean }) {
  if (notices.length === 0) return null;
  const t = await getTranslations("topic.notices");
  const format = await getFormatter();
  return (
    <div className="gcs-topicNotices" data-testid="gcs-topic-notices">
      {notices.map((n) => (
        <section key={n.id} className={`gcs-topicNotice gcs-topicNotice--${n.tone}`} role="note" aria-label={t("label")} data-testid="gcs-topic-notice">
          <span className="gcs-topicNotice__icon" aria-hidden="true">
            <GcsIcon name={NOTICE_ICONS[n.tone]} />
          </span>
          <div className="gcs-topicNotice__main">
            <p className="gcs-topicNotice__head">
              <strong>{t("title")}</strong>
              <span className="gcs-topicNotice__meta">
                {showNames && n.author ? <GcsMemberName userId={n.author.id} name={n.author.name} nameKey={n.author.nameKey} href={memberHref(n.author)} /> : t("team")} ·{" "}
                {format.dateTime(new Date(n.createdAt), { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </p>
            {/* HTML-ul produs și sanitizat de renderer la salvare. */}
            <GcsNamedHtml className="gcs-postBody gcs-topicNotice__body" html={n.html} />
          </div>
          {canDelete && <GcsNoticeDelete noticeId={n.id} />}
        </section>
      ))}
    </div>
  );
}

/** Pragul separatorului dintre două postări (o pauză mai lungă primește „N … mai târziu”). */
const GAP_DAYS = 30;

/** Separatorul de timp dintre două postări („2 luni mai târziu…”), sau `null` dacă pauza e scurtă. */
export async function GcsTimeGap({ from, to }: { from: string; to: string }) {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  if (days < GAP_DAYS) return null;
  const t = await getTranslations("topic.gap");
  const label = days >= 365 ? t("years", { count: Math.floor(days / 365) }) : t("months", { count: Math.max(1, Math.floor(days / 30)) });
  return (
    <div className="gcs-timeGap" role="separator" aria-label={label} data-testid="gcs-time-gap">
      <span>{label}</span>
    </div>
  );
}

/** Rezumatul unui topic lung: postatorii activi, postările populare și zilele active (setările globale ale forumului). */
export async function GcsTopicSummaryBlock({ topicId, summary, devices }: { topicId: number; summary: GcsTopicSummary; devices: "all" | "desktop" }) {
  if (summary.posters.length === 0 && summary.popular.length === 0) return null;
  const t = await getTranslations("topic.summary");
  const format = await getFormatter();
  return (
    <details className={`gcs-card gcs-topicSummary${devices === "desktop" ? " gcs-topicSummary--desktop" : ""}`} data-testid="gcs-topic-summary">
      <summary className="gcs-topicSummary__head">
        <GcsIcon name="fa-solid fa-chart-pie" className="gcs-hIcon" />
        <span className="gcs-display">{t("title")}</span>
      </summary>
      <div className="gcs-topicSummary__grid">
        {summary.posters.length > 0 && (
          <section aria-label={t("posters")}>
            <h3 className="gcs-topicSummary__subtitle">{t("posters")}</h3>
            <ol className="gcs-topicSummary__list">
              {summary.posters.map((p) => (
                <li key={p.user.id}>
                  <GcsMemberName userId={p.user.id} name={p.user.name} nameKey={p.user.nameKey} href={memberHref(p.user)} />
                  <span className="gcs-muted">{t("postsCount", { count: p.posts })}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {summary.popular.length > 0 && (
          <section aria-label={t("popular")}>
            <h3 className="gcs-topicSummary__subtitle">{t("popular")}</h3>
            <ol className="gcs-topicSummary__list">
              {summary.popular.map((p) => (
                <li key={p.postId}>
                  <a href={postHref(topicId, p.postId)} className="gcs-topicSummary__excerpt">
                    {p.excerpt || t("noText")}
                  </a>
                  <span className="gcs-muted">
                    {p.user ? <GcsMemberName userId={p.user.id} name={p.user.name} nameKey={p.user.nameKey} /> : null} · {t("reactions", { count: p.reactions })}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {summary.days.length > 0 && (
          <section aria-label={t("days")}>
            <h3 className="gcs-topicSummary__subtitle">{t("days")}</h3>
            <ol className="gcs-topicSummary__list">
              {summary.days.map((d) => (
                <li key={d.day}>
                  <span>{format.dateTime(new Date(`${d.day}T12:00:00Z`), { dateStyle: "medium" })}</span>
                  <span className="gcs-muted">{t("postsCount", { count: d.posts })}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </details>
  );
}

/** Banda unui topic arhivat (doar de citit). */
export async function GcsArchivedBanner({ at }: { at: string }) {
  const t = await getTranslations("topic");
  const format = await getFormatter();
  return (
    <p className="gcs-archivedBanner" role="note" data-testid="gcs-topic-archived">
      <GcsIcon name="fa-solid fa-box-archive" />
      {t("archivedNotice", { date: format.dateTime(new Date(at), { dateStyle: "medium" }) })}
    </p>
  );
}
