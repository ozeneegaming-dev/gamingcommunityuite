"use client";

import type { GcsChatProRankRow, GcsChatProRanking } from "@gcs/modules";
import { GcsAvatar, GcsBadgeArt, GcsMemberName } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { memberHref } from "@/lib/forum-urls";
import { openMemberCard } from "@/lib/hover-anchor";

/** Cât a mai rămas până la resetare: zile, ore sau minute (actualizat în fiecare minut). */
function useCountdown(seconds: number, loadedAt: number): number {
  const [now, setNow] = useState(loadedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, seconds - Math.floor((now - loadedAt) / 1000));
}

/** Un număr care „urcă” până la valoarea lui (0,6 s); fără animație la mișcare redusă și la actualizările mici. */
function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      setShown(Math.round(start + (value - start) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

/** Iconițele panoului (desenate aici, ca să urmeze culorile temei prin `currentColor`). */
const PATHS = {
  trophy: "M8 4 H16 V9 C16 11.5 14.2 13.5 12 13.5 C9.8 13.5 8 11.5 8 9 Z M8 6 H5 C5 9 6.5 10 8 10 M16 6 H19 C19 9 17.5 10 16 10 M12 13.5 V17 M8.5 20 H15.5",
  chat: "M4 6 H20 V16 H10 L6 20 V16 H4 Z",
  calendar: "M4 6 H20 V20 H4 Z M4 10 H20 M8 3 V7 M16 3 V7",
  trend: "M3 17 L9 11 L13 15 L21 7 M15 7 H21 V13",
  bars: "M5 20 V12 M10 20 V6 M15 20 V10 M20 20 V14",
} as const;

function Icon({ path, size = 16, className, strokeWidth = 2 }: { path: string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Crown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 17" aria-hidden="true" className={className}>
      <path d="M2 15 L1 3 L7 8 L12 1 L17 8 L23 3 L22 15 Z" className="gcs-cpRank__crownFill" />
      <circle cx="12" cy="10" r="1.6" className="gcs-cpRank__crownGem" />
    </svg>
  );
}

function Flame() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21 C7.5 21 5 18 5 14.5 C5 10.5 9 8.5 9 4 C12 6 13 8.5 12.5 11 C14 10 15 8.5 15 7 C17.5 9 19 11.5 19 14.5 C19 18 16.5 21 12 21 Z" fill="currentColor" />
    </svg>
  );
}

/** Avatarul unui loc: buton care deschide cardul membrului (și la hover, ca orice nume). */
function Face({ user, className }: { user: GcsChatProRankRow["user"]; className: string }) {
  const open = (e: MouseEvent<HTMLButtonElement>) => openMemberCard(e.currentTarget);
  return (
    <button type="button" className={`gcs-cpRank__face ${className}`} data-user-id={user.id} aria-label={user.name} onClick={open}>
      <GcsAvatar name={user.name} userId={user.id} src={user.image ?? undefined} size="m" />
    </button>
  );
}

/**
 * Panoul de clasament din Chat Pro („Cei mai activi în chat”), compact (290 px), lângă chat: trofeul, titlul și cât
 * mai e până la resetare; podiumul cu fascicul de lumină și sclipiri (locul 1 la mijloc, cu ramă aurie, coroană și
 * soclul cel mai înalt, cu lauri; 2 și 3 cu medalii argint și bronz); „Spammer-ul zilei”; „Ultimul câștigător” (cu
 * insigna primită, ascuns dacă nu există); „Statisticile tale” în patru plăci. Culorile vin din temă: aurul, argintul
 * și bronzul doar pentru medalii, accentul pentru rest. Fără animații la mișcare redusă.
 */
export function GcsChatProRanking({ ranking, loadedAt }: { ranking: GcsChatProRanking; loadedAt: number }) {
  const t = useTranslations("chatPro.ranking");
  const format = useFormatter();
  const left = useCountdown(ranking.resetsIn, loadedAt);
  const days = Math.floor(left / 86_400);
  const hours = Math.floor(left / 3600);
  const countdown = days >= 1 ? t("resetDays", { count: days }) : hours >= 1 ? t("resetHours", { count: hours }) : t("resetMinutes", { count: Math.max(1, Math.floor(left / 60)) });
  const weekly = ranking.period.kind === "week";
  const [first, second, third] = ranking.top;
  const me = ranking.me;
  const today = useCountUp(me?.today ?? 0);
  const period = useCountUp(me?.period ?? 0);

  const place = (row: GcsChatProRankRow | undefined, n: 1 | 2 | 3) => (
    <li className={`gcs-cpRank__place gcs-cpRank__place--${n}${row ? "" : " gcs-cpRank__place--empty"}`} data-testid={row ? `gcs-chatpro-podium-${n}` : `gcs-chatpro-podium-empty-${n}`}>
      {n === 1 ? <Crown className="gcs-cpRank__crown" /> : <span className="gcs-cpRank__medal" aria-hidden="true">{n}</span>}
      {row ? (
        <>
          <Face user={row.user} className={`gcs-cpRank__face--${n}`} />
          <GcsMemberName userId={row.user.id} name={row.user.name} nameKey={row.user.nameKey} href={memberHref(row.user)} className="gcs-cpRank__name" />
          <span className="gcs-cpRank__count">{t("messages", { count: row.messages })}</span>
        </>
      ) : (
        <>
          <span className={`gcs-cpRank__face gcs-cpRank__face--${n} gcs-cpRank__face--ghost`} aria-hidden="true" />
          <span className="gcs-cpRank__count">{t("freePlace")}</span>
        </>
      )}
      <span className="gcs-cpRank__ped" aria-label={t("place", { place: n })}>
        {n === 1 && (
          <svg className="gcs-cpRank__laurel" viewBox="0 0 66 44" aria-hidden="true">
            <path d="M14 40 C6 32 6 16 14 8 M20 40 C14 33 14 20 19 13 M52 40 C60 32 60 16 52 8 M46 40 C52 33 52 20 47 13" />
          </svg>
        )}
        <b>{n}</b>
      </span>
    </li>
  );

  const section = (icon: ReactNode, title: string, body: ReactNode, testId?: string) => (
    <div className="gcs-cpRank__sec" {...(testId ? { "data-testid": testId } : {})}>
      <h4 className="gcs-cpRank__secTitle">
        {icon}
        {title}
      </h4>
      {body}
    </div>
  );

  const change = me ? (me.previous > 0 ? Math.round(((me.period - me.previous) / me.previous) * 100) : null) : null;
  const tiles: { key: string; path: string; value: string; label: string; testId?: string }[] = me
    ? [
        { key: "pos", path: PATHS.trophy, value: me.position ? `#${me.position}` : "—", label: t("myPosition") },
        { key: "today", path: PATHS.chat, value: format.number(today), label: t("today"), testId: "gcs-chatpro-today" },
        { key: "period", path: PATHS.calendar, value: format.number(period), label: weekly ? t("thisWeekPeriod") : t("thisMonth") },
        { key: "trend", path: PATHS.trend, value: change === null ? (me.period > 0 ? t("new") : "—") : `${change > 0 ? "+" : ""}${change}%`, label: t("vsPrevious") },
      ]
    : [];

  const winner = ranking.lastWinner;
  const winnerLabel = winner
    ? weekly
      ? t("winnerOfWeek", { count: winner.messages })
      : t("winnerOfMonth", { month: format.dateTime(new Date(`${winner.start}T12:00:00Z`), { month: "long", timeZone: "UTC" }), count: winner.messages })
    : "";

  return (
    <section className="gcs-cpRank" aria-labelledby="gcs-chatpro-ranking-title" data-testid="gcs-chatpro-ranking">
      <header className="gcs-cpRank__head">
        <svg className="gcs-cpRank__watermark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18 L2 7 L7.5 11 L12 4 L16.5 11 L22 7 L21 18 Z" />
        </svg>
        <h3 id="gcs-chatpro-ranking-title" className="gcs-cpRank__title">
          <span className="gcs-cpRank__trophy" aria-hidden="true">
            <Icon path={PATHS.trophy} size={14} />
          </span>
          {t("title")}
        </h3>
        <span className="gcs-cpRank__reset" title={t("period", { start: ranking.period.start, end: ranking.period.end })} data-testid="gcs-chatpro-reset">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M12 7 V12 L15 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          {countdown}
        </span>
      </header>

      <div className="gcs-cpRank__stage">
        <span className="gcs-cpRank__beam" aria-hidden="true" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`gcs-cpRank__spark gcs-cpRank__spark--${i}`} aria-hidden="true" />
        ))}
        <ol className="gcs-cpRank__podium" aria-label={t("podium")}>
          {place(second, 2)}
          {place(first, 1)}
          {place(third, 3)}
        </ol>
      </div>
      {ranking.top.length === 0 && <p className="gcs-cpRank__empty">{t("empty")}</p>}
      <div className="gcs-cpRank__rule" aria-hidden="true" />

      {section(
        <span className="gcs-cpRank__secIcon gcs-cpRank__secIcon--flame">
          <Flame />
        </span>,
        t("spammer"),
        ranking.spammer ? (
          <div className="gcs-cpRank__card gcs-cpRank__card--spam" data-testid="gcs-chatpro-spammer">
            <Face user={ranking.spammer.user} className="gcs-cpRank__face--spam" />
            <span className="gcs-cpRank__who">
              <GcsMemberName userId={ranking.spammer.user.id} name={ranking.spammer.user.name} nameKey={ranking.spammer.user.nameKey} href={memberHref(ranking.spammer.user)} className="gcs-cpRank__name" />
              <span className="gcs-cpRank__count">{t("messagesToday", { count: ranking.spammer.messages })}</span>
            </span>
            <Icon path={PATHS.chat} size={30} className="gcs-cpRank__ghostIcon" strokeWidth={1.6} />
          </div>
        ) : (
          <p className="gcs-cpRank__empty">{t("nobodyToday")}</p>
        ),
      )}

      {winner &&
        section(
          <Crown className="gcs-cpRank__secIcon gcs-cpRank__secIcon--crown" />,
          t("lastWinner"),
          <div className="gcs-cpRank__card gcs-cpRank__card--win" data-testid="gcs-chatpro-last-winner">
            <span className="gcs-cpRank__winFace">
              <Face user={winner.user} className="gcs-cpRank__face--win" />
              <Crown className="gcs-cpRank__miniCrown" />
            </span>
            <span className="gcs-cpRank__who">
              <GcsMemberName userId={winner.user.id} name={winner.user.name} nameKey={winner.user.nameKey} href={memberHref(winner.user)} className="gcs-cpRank__name" />
              <span className="gcs-cpRank__count">{winnerLabel}</span>
            </span>
            {winner.badge && (
              <span className="gcs-cpRank__medallion" title={winner.badge.name} data-testid="gcs-chatpro-winner-badge">
                <span className="gcs-cpRank__medallionArt">
                  <GcsBadgeArt badge={winner.badge} size={24} decorative />
                </span>
                <span className="gcs-cpRank__medallionLabel">{t("badge")}</span>
              </span>
            )}
          </div>,
        )}

      {section(
        <span className="gcs-cpRank__secIcon gcs-cpRank__secIcon--bars">
          <Icon path={PATHS.bars} size={15} strokeWidth={2.6} />
        </span>,
        t("yourStats"),
        me ? (
          <div className="gcs-cpRank__tiles" data-testid="gcs-chatpro-mystats">
            {tiles.map((tile) => (
              <div key={tile.key} className={`gcs-cpRank__tile gcs-cpRank__tile--${tile.key}`}>
                <Icon path={tile.path} size={18} className="gcs-cpRank__tileIcon" />
                <span className="gcs-cpRank__tileText">
                  <b {...(tile.testId ? { "data-testid": tile.testId } : {})}>{tile.value}</b>
                  <span>{tile.label}</span>
                </span>
                <Icon path={tile.path} size={40} className="gcs-cpRank__tileBg" strokeWidth={1.5} />
              </div>
            ))}
          </div>
        ) : (
          <p className="gcs-cpRank__empty" data-testid="gcs-chatpro-guest-stats">
            {t.rich("guestHint", { link: (chunks) => <Link href="/login">{chunks}</Link> })}
          </p>
        ),
      )}
    </section>
  );
}
