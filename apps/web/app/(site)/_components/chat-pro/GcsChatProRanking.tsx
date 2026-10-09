"use client";

import { faCalendarDay, faCrown, faFire, faTrophy, faUser } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatProRankRow, GcsChatProRanking } from "@gcs/modules";
import { GcsAvatar, GcsIconSvg, GcsMemberName } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { memberHref } from "@/lib/forum-urls";

/** Cât a mai rămas până la resetare: zile, ore sau minute (actualizat în fiecare minut). */
function useCountdown(seconds: number, loadedAt: number): number {
  const [now, setNow] = useState(loadedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, seconds - Math.floor((now - loadedAt) / 1000));
}

/**
 * Panoul de clasament și provocări (Chat Pro): podiumul celor mai activi din perioadă (locul 1 la mijloc, mai sus),
 * numărătoarea până la resetare, „Spammer-ul zilei”, ultimul câștigător și statisticile viewer-ului.
 */
export function GcsChatProRanking({ ranking, loadedAt }: { ranking: GcsChatProRanking; loadedAt: number }) {
  const t = useTranslations("chatPro.ranking");
  const format = useFormatter();
  const left = useCountdown(ranking.resetsIn, loadedAt);
  const days = Math.floor(left / 86_400);
  const hours = Math.floor(left / 3600);
  const countdown = days >= 1 ? t("resetDays", { count: days }) : hours >= 1 ? t("resetHours", { count: hours }) : t("resetMinutes", { count: Math.max(1, Math.floor(left / 60)) });
  const [first, second, third] = ranking.top;
  const podium: [GcsChatProRankRow | undefined, number][] = [
    [second, 2],
    [first, 1],
    [third, 3],
  ];

  const person = (row: { user: GcsChatProRankRow["user"]; messages: number }, testId: string) => (
    <div className="gcs-chatPro__rankRow" data-testid={testId}>
      <GcsAvatar name={row.user.name} userId={row.user.id} src={row.user.image ?? undefined} size="s" />
      <span className="gcs-chatPro__rankWho">
        <GcsMemberName userId={row.user.id} name={row.user.name} nameKey={row.user.nameKey} href={memberHref(row.user)} />
        <span className="gcs-chatPro__rankCount">{t("messages", { count: row.messages })}</span>
      </span>
    </div>
  );

  return (
    <section className="gcs-chatPro__ranking" aria-labelledby="gcs-chatpro-ranking-title" data-testid="gcs-chatpro-ranking">
      <header className="gcs-chatPro__rankHead">
        <h3 id="gcs-chatpro-ranking-title" className="gcs-chatPro__rankTitle">
          <GcsIconSvg icon={faTrophy} />
          {t("title")}
        </h3>
        <span className="gcs-chatPro__pill" title={t("period", { start: ranking.period.start, end: ranking.period.end })} data-testid="gcs-chatpro-reset">
          {countdown}
        </span>
      </header>
      {ranking.top.length === 0 ? (
        <p className="gcs-chatPro__empty">{t("empty")}</p>
      ) : (
        <ol className="gcs-chatPro__podium" aria-label={t("podium")}>
          {podium.map(([row, place]) =>
            row ? (
              <li key={place} className={`gcs-chatPro__step gcs-chatPro__step--${place}`} data-testid={`gcs-chatpro-podium-${place}`}>
                {place === 1 && <GcsIconSvg icon={faCrown} className="gcs-chatPro__crown" />}
                <GcsAvatar name={row.user.name} userId={row.user.id} src={row.user.image ?? undefined} size={place === 1 ? "l" : "m"} />
                <GcsMemberName userId={row.user.id} name={row.user.name} nameKey={row.user.nameKey} href={memberHref(row.user)} />
                <span className="gcs-chatPro__rankCount">{t("messages", { count: row.messages })}</span>
                <span className="gcs-chatPro__place" aria-label={t("place", { place })}>
                  {place}
                </span>
              </li>
            ) : (
              <li key={place} className={`gcs-chatPro__step gcs-chatPro__step--${place} gcs-chatPro__step--empty`} aria-hidden="true" />
            ),
          )}
        </ol>
      )}
      <div className="gcs-chatPro__rankBlock">
        <h4 className="gcs-chatPro__rankSub">
          <GcsIconSvg icon={faFire} />
          {t("spammer")}
        </h4>
        {ranking.spammer ? person(ranking.spammer, "gcs-chatpro-spammer") : <p className="gcs-chatPro__empty">{t("nobodyToday")}</p>}
      </div>
      <div className="gcs-chatPro__rankBlock">
        <h4 className="gcs-chatPro__rankSub">
          <GcsIconSvg icon={faCalendarDay} />
          {t("lastWinner")}
        </h4>
        {ranking.lastWinner ? person(ranking.lastWinner, "gcs-chatpro-last-winner") : <p className="gcs-chatPro__empty">{t("noWinner")}</p>}
      </div>
      {ranking.me && (
        <dl className="gcs-chatPro__stats" data-testid="gcs-chatpro-mystats">
          <div>
            <dt>
              <GcsIconSvg icon={faUser} /> {t("myPosition")}
            </dt>
            <dd>{ranking.me.position ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("today")}</dt>
            <dd data-testid="gcs-chatpro-today">{format.number(ranking.me.today)}</dd>
          </div>
          <div>
            <dt>{t("thisPeriod")}</dt>
            <dd>{format.number(ranking.me.period)}</dd>
          </div>
          <div>
            <dt>{t("thisWeek")}</dt>
            <dd>{format.number(ranking.me.week)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
