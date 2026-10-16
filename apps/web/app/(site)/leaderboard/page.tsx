import { GcsError } from "@gcs/core";
import { formatOnlineDuration, GCS_LEADERBOARD_METRICS, GCS_LEADERBOARD_PERIODS, type GcsLeaderboardMetric, type GcsLeaderboardPeriod, type GcsLeaderboardRow } from "@gcs/modules";
import { GcsAvatar, GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("leaderboard"))("title") };
}

type Search = { metric?: string; period?: string };

const METRIC_ICONS: Record<GcsLeaderboardMetric, string> = {
  reputation: "fa-solid fa-heart",
  posts: "fa-solid fa-comments",
  topics: "fa-solid fa-file-lines",
  online: "fa-solid fa-clock",
  xp: "fa-solid fa-star",
  solutions: "fa-solid fa-circle-check",
};

/**
 * `/leaderboard`: primii 50 după reputație, postări, topicuri, timp online, XP sau soluții, pe zi / săptămână / lună /
 * an / tot timpul. Podiumul arată
 * primele trei locuri (ordinea vizuală 2-1-3), tabelul restul; rândul viewer-ului e evidențiat.
 */
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const [t, format, actor] = await Promise.all([getTranslations("leaderboard"), getFormatter(), currentActor()]);
  const metric: GcsLeaderboardMetric = GCS_LEADERBOARD_METRICS.includes(sp.metric as GcsLeaderboardMetric) ? (sp.metric as GcsLeaderboardMetric) : "reputation";
  const period: GcsLeaderboardPeriod = GCS_LEADERBOARD_PERIODS.includes(sp.period as GcsLeaderboardPeriod) ? (sp.period as GcsLeaderboardPeriod) : "month";
  const rows = await services()
    .leaderboard.top(actor, metric, period)
    .catch((error: unknown) => {
      if (error instanceof GcsError && error.status === 403) return null;
      throw error;
    });
  if (!rows) {
    return (
      <GcsCard style={{ padding: 24 }} role="alert" data-testid="gcs-leaderboard-forbidden">
        <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
        {t("forbidden")}
      </GcsCard>
    );
  }

  const href = (patch: { metric?: GcsLeaderboardMetric; period?: GcsLeaderboardPeriod }) => {
    const params = new URLSearchParams();
    const m = patch.metric ?? metric;
    const p = patch.period ?? period;
    if (m !== "reputation") params.set("metric", m);
    if (p !== "month") params.set("period", p);
    const qs = params.toString();
    return qs ? `/leaderboard?${qs}` : "/leaderboard";
  };
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  // Timpul online e în secunde: „1h 35m”.
  const value = (n: number) => (metric === "online" ? formatOnlineDuration(n) : format.number(n));
  const member = (r: GcsLeaderboardRow) => <GcsMemberName userId={r.user.id} name={r.user.name} nameKey={r.user.nameKey} href={memberHref(r.user)} />;
  // Culoarea grupului doar pe iconiță: textul rămâne lizibil și pe tema luminoasă (culorile grupurilor sunt pentru fundal închis).
  const group = (r: GcsLeaderboardRow) => (
    <span className="gcs-board__group">
      {r.group.icon && (
        <span style={r.group.color ? { color: r.group.color } : undefined}>
          <GcsIcon name={r.group.icon} />
        </span>
      )}
      {r.group.name}
    </span>
  );

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-ranking-star" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc">{t(`lead.${period}`, { metric: t(`metricLower.${metric}`) })}</p>
        </div>
      </header>

      <div className="gcs-pageControls">
        <nav className="gcs-segLinks" aria-label={t("metricLabel")}>
          {GCS_LEADERBOARD_METRICS.map((m) => (
            <Link key={m} href={href({ metric: m })} className={`gcs-segLink${m === metric ? " gcs-segLink--active" : ""}`} aria-current={m === metric ? "page" : undefined}>
              <GcsIcon name={METRIC_ICONS[m]} />
              {t(`metric.${m}`)}
            </Link>
          ))}
        </nav>
        <nav className="gcs-segLinks" aria-label={t("periodLabel")}>
          {GCS_LEADERBOARD_PERIODS.map((p) => (
            <Link key={p} href={href({ period: p })} className={`gcs-segLink${p === period ? " gcs-segLink--active" : ""}`} aria-current={p === period ? "page" : undefined}>
              {t(`period.${p}`)}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <GcsCard>
          <p className="gcs-emptyState" data-testid="gcs-leaderboard-empty">
            <GcsIcon name="fa-solid fa-trophy" className="gcs-emptyIcon" />
            {t("empty")}
          </p>
        </GcsCard>
      ) : (
        <>
          <section aria-label={t("podium")}>
            <ol className="gcs-podium" data-testid="gcs-podium">
              {podium.map((r) => (
                <li key={r.user.id} className={`gcs-podium__place gcs-podium__place--${Math.min(r.rank, 3)}`} data-testid="gcs-podium-place">
                  <div className="gcs-podium__who">
                    <span className="gcs-podium__avatar">
                      <GcsAvatar name={r.user.name} size="l" {...(r.user.image ? { src: r.user.image } : {})} {...(r.user.frameKey ? { frame: r.user.frameKey } : {})} />
                    </span>
                    <span className="gcs-podium__id">
                      <span className="gcs-podium__name">{member(r)}</span>
                      {group(r)}
                    </span>
                  </div>
                  <div className="gcs-podium__value">
                    {value(r.value)}
                    <span className="gcs-podium__unit">{t(`metric.${metric}`)}</span>
                  </div>
                  <div className="gcs-podium__plinth" aria-hidden="true">
                    <span className="gcs-podium__rank">{r.rank}</span>
                  </div>
                  <span className="gcs-srOnly">{t("place", { rank: r.rank })}</span>
                </li>
              ))}
            </ol>
          </section>

          {rest.length > 0 && (
            <GcsCard as="section" className="gcs-board" aria-label={t("table")}>
              <table className="gcs-board__table" data-testid="gcs-leaderboard-table">
                <thead>
                  <tr>
                    <th scope="col">{t("col.rank")}</th>
                    <th scope="col">{t("col.member")}</th>
                    <th scope="col" className="gcs-board__colGroup">
                      {t("col.group")}
                    </th>
                    <th scope="col" className="gcs-board__value">
                      {t(`metric.${metric}`)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((r) => {
                    const me = actor.userId === r.user.id;
                    return (
                      <tr key={r.user.id} className={me ? "gcs-board__row--me" : undefined} data-testid="gcs-leaderboard-row">
                        <td className="gcs-board__rank">{r.rank}</td>
                        <td>
                          <span className="gcs-board__member">
                            <GcsAvatar name={r.user.name} size="s" {...(r.user.image ? { src: r.user.image } : {})} {...(r.user.frameKey ? { frame: r.user.frameKey } : {})} />
                            {member(r)}
                            {me && <span className="gcs-badge gcs-badge--accent">{t("you")}</span>}
                          </span>
                        </td>
                        <td className="gcs-board__colGroup">{group(r)}</td>
                        <td className="gcs-board__value">{value(r.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </GcsCard>
          )}
          <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
            {t(`note.${period === "all" ? "all" : "period"}`)}
          </p>
        </>
      )}
    </>
  );
}
