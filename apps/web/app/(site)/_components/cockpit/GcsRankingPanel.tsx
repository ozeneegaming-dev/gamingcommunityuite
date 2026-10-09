"use client";

import { faCommentDots, faTrophy } from "@fortawesome/free-solid-svg-icons";
import type { GcsLeaderboardPeriod } from "@gcs/modules";
import { formatOnlineDuration } from "@gcs/modules/online-format";
import { GcsAvatar, GcsIconSvg, GcsUserLink } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { medalFor, periodless, type GcsRankingMetric, type GcsRankingResult, type GcsRankingRow } from "@/lib/ranking";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

const PERIODS: GcsLeaderboardPeriod[] = ["day", "week", "month", "year", "all"];
/** Clasamentul se reîmprospătează singur (timpul online crește), și la activitate nouă. */
const REFRESH_MS = 60_000;

/** Trofeul din insigna locurilor 1–3 (desenat aici, în culoarea medaliei). */
function Trophy() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="gcs-rank__trophy">
      <path d="M5 3 H15 V7.5 a5 5 0 0 1 -10 0 Z" fill="currentColor" />
      <path d="M5 4.5 H2.5 V6 a3 3 0 0 0 3 3 M15 4.5 H17.5 V6 a3 3 0 0 1 -3 3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 12.5 V15.5 M6.5 17.5 H13.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Clasamentul compact (specul 2026-10-10-hero-cockpit §4): tab-urile măsurilor, perioada (Azi / Săpt. / Lună / An /
 * Tot), primele trei locuri mereu aur / argint / bronz (trofeul în insigna nuanțată, rândul nuanțat cu chenar și
 * lumină, inelul pe avatar, valoarea colorată), de la 4 numărul într-o insignă neutră. În coloana laterală („widget”):
 * butonul de mesaj pe fiecare rând, „Tu: locul X” și „Clasament complet →”. Schimbările de loc se animă.
 */
export function GcsRankingPanel({ initial, metrics, variant, testId = "gcs-ranking" }: { initial: GcsRankingResult; metrics: GcsRankingMetric[]; variant: "cockpit" | "widget"; testId?: string }) {
  const t = useTranslations("cockpit.top");
  const format = useFormatter();
  const realtime = useRealtime();
  const [metric, setMetric] = useState<GcsRankingMetric>(initial.metric);
  const [period, setPeriod] = useState<GcsLeaderboardPeriod>(initial.period === "all" && periodless(initial.metric) ? "week" : initial.period);
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (m: GcsRankingMetric, p: GcsLeaderboardPeriod) => {
    const n = ++seq.current;
    setBusy(true);
    try {
      const res = await fetch(`/api/ranking?metric=${m}&period=${periodless(m) ? "all" : p}&limit=5`, { cache: "no-store" });
      if (res.ok && n === seq.current) setData((await res.json()) as GcsRankingResult);
    } catch {
      // Rețeaua a căzut: rămâne clasamentul de acum.
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (metric === initial.metric && period === initial.period) return;
    void load(metric, period);
  }, [metric, period, load, initial.metric, initial.period]);

  // Reîmprospătarea: la activitate nouă (postări) și periodic (timpul online crește).
  useEffect(() => {
    const timer = setInterval(() => void load(metric, period), REFRESH_MS);
    const off = realtime.on("activity:new", () => void load(metric, period));
    return () => {
      clearInterval(timer);
      off();
    };
  }, [realtime, metric, period, load]);

  const value = (row: Pick<GcsRankingRow, "value">, m: GcsRankingMetric) => {
    if (m === "online") return formatOnlineDuration(row.value);
    if (m === "players") return t("values.players", { value: format.number(row.value) });
    if (m === "clans") return t("values.clans", { value: format.number(row.value) });
    if (m === "reputation") return t("values.reputation", { value: format.number(row.value) });
    return t(`values.${m}`, { count: row.value });
  };
  const widget = variant === "widget";
  const metricLabel = (m: GcsRankingMetric) => t(widget ? `widgetMetrics.${m}` : `metrics.${m}`);

  return (
    <div className={`gcs-rank gcs-rank--${variant}`} data-testid={testId} aria-busy={busy || undefined}>
      <div className="gcs-hbSeg gcs-rank__metrics" role="tablist" aria-label={t("metricLabel")} style={{ "--i": Math.max(0, metrics.indexOf(metric)), "--n": metrics.length } as CSSProperties}>
        {metrics.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={m === metric} className={`gcs-hbSeg__btn${m === metric ? " gcs-hbSeg__btn--on" : ""}`} onClick={() => setMetric(m)} data-testid={`${testId}-metric-${m}`}>
            {metricLabel(m)}
          </button>
        ))}
      </div>
      <div className="gcs-hbSeg gcs-rank__periods" role="group" aria-label={t("periodLabel")} data-off={periodless(metric) ? "" : undefined} style={{ "--i": Math.max(0, PERIODS.indexOf(period)), "--n": PERIODS.length } as CSSProperties}>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={!periodless(metric) && p === period}
            disabled={periodless(metric)}
            className={`gcs-hbSeg__btn${!periodless(metric) && p === period ? " gcs-hbSeg__btn--on" : ""}`}
            onClick={() => setPeriod(p)}
            data-testid={`${testId}-period-${p}`}
          >
            {t(`periods.${p}`)}
          </button>
        ))}
      </div>
      {data.rows.length === 0 ? (
        <p className="gcs-rank__empty" role="status">
          <GcsIconSvg icon={faTrophy} />
          {t("empty")}
        </p>
      ) : (
        <ol className="gcs-rank__list" key={`${data.metric}-${data.period}`}>
          {data.rows.map((r, i) => {
            const medal = medalFor(i);
            return (
              <li key={`${r.href}`} className={`gcs-rank__row${medal ? ` gcs-rank__row--${medal}` : ""}`} data-testid={`${testId}-row`} data-medal={medal ?? undefined} style={{ animationDelay: `${i * 40}ms` }}>
                {medal ? (
                  <span className="gcs-rank__badge gcs-rank__badge--medal" role="img" aria-label={t(`places.${medal}`)} data-testid={`${testId}-trophy`}>
                    <Trophy />
                  </span>
                ) : (
                  <span className="gcs-rank__badge" aria-label={t("place", { rank: r.rank })}>
                    {r.rank}
                  </span>
                )}
                {r.user ? (
                  <GcsAvatar name={r.user.name} size="xs" userId={r.user.id} {...(r.user.image ? { src: r.user.image } : {})} className="gcs-rank__avatar" />
                ) : (
                  <span className="gcs-rank__avatar gcs-rank__avatar--blank" aria-hidden="true" style={r.color ? { background: r.color } : undefined}>
                    {[...r.name.replace(/^\[[^\]]*\]\s*/, "")][0]?.toUpperCase()}
                  </span>
                )}
                <span className="gcs-rank__who">
                  <span className="gcs-rank__name">{r.user ? <GcsUserLink userId={r.user.id} name={r.user.name} nameKey={r.user.nameKey} href={r.href} /> : <Link href={r.href}>{r.name}</Link>}</span>
                  {widget ? <span className="gcs-rank__value">{value(r, data.metric)}</span> : r.sub && <span className="gcs-rank__sub">{r.sub}</span>}
                </span>
                {!widget && <span className="gcs-rank__value">{value(r, data.metric)}</span>}
                {widget && r.user && (
                  <Link href={`/messages/new?to=${encodeURIComponent(r.user.id)}`} className="gcs-hb__sq gcs-rank__msg" aria-label={t("message", { name: r.user.name })} data-testid={`${testId}-message`}>
                    <GcsIconSvg icon={faCommentDots} />
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {widget && (
        <div className="gcs-rank__foot">
          <span className="gcs-rank__you" data-testid={`${testId}-you`}>
            {data.you ? t("you", { rank: data.you.rank, value: value(data.you, data.metric) }) : t("youNone")}
          </span>
          <Link href={`/leaderboard?metric=${data.metric === "players" || data.metric === "clans" ? "posts" : data.metric}&period=${data.period}`} className="gcs-arrowLink">
            {t("full")} <span className="gcs-arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </div>
  );
}
