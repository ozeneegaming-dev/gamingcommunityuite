"use client";

import { faArrowUpRightFromSquare, faHandHoldingHeart } from "@fortawesome/free-solid-svg-icons";
import type { GcsDonorView, GcsGoalView } from "@gcs/modules";
import { GcsIconSvg, GcsMemberName } from "@gcs/ui";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { formatMoney, formatProgress } from "@/lib/donations";
import { memberHref } from "@/lib/forum-urls";
import { GcsCountUp } from "../header/GcsCountUp";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

/** Semnalul serverului la orice schimbare a donațiilor (fără date: progresul se cere din nou, cu drepturile viewer-ului). */
const UPDATE_EVENT = "donations:update";
/** Fără serviciul realtime, progresul se reîmprospătează singur din când în când. */
const REFRESH_MS = 120_000;

/** Donatorul: numele stilizat al membrului, numele dat de un donator fără cont sau „Anonim”. */
export function GcsDonorName({ donor, testId }: { donor: GcsDonorView; testId?: string }) {
  const t = useTranslations("donations");
  if (donor.kind === "member") return <GcsMemberName userId={donor.user.id} name={donor.user.name} nameKey={donor.user.nameKey} href={memberHref(donor.user)} data-testid={testId} />;
  if (donor.kind === "name") return <span className="gcs-donName" data-testid={testId}>{donor.name}</span>;
  return (
    <span className="gcs-donName gcs-donName--anon" data-testid={testId}>
      {t("anonymous")}
    </span>
  );
}

type Props = {
  initial: GcsGoalView;
  /** Obiectivul cerut la reîmprospătare (gol = cel activ implicit). */
  goalParam: string;
  showLast: boolean;
  showCount: boolean;
  /** Butonul „Susține comunitatea”: linkul extern (fila nouă) sau pagina donațiilor. */
  cta: { href: string; external: boolean } | null;
  variant: "widget" | "page";
  testId?: string;
};

/**
 * „Obiectivul lunii” (în orice temă): titlul obiectivului, „640 / 1.000 lei” (numără până la suma nouă), bara de
 * progres în culoarea accentului (se umple animat la afișare și la fiecare donație nouă), donatorii, ultimul donator
 * (anonimii apar „Anonim”) și butonul. Se actualizează live la orice donație confirmată (camera tuturor).
 */
export function GcsDonationGoal({ initial, goalParam, showLast, showCount, cta, variant, testId = "gcs-donation-goal" }: Props) {
  const t = useTranslations("donations");
  const locale = useLocale();
  const format = useFormatter();
  const realtime = useRealtime();
  const [view, setView] = useState(initial);
  // Bara pornește goală și se umple după afișare (tranziția din CSS); cu „reduced motion”, direct.
  const [filled, setFilled] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const res = await fetch(`/api/donations/goal?goal=${encodeURIComponent(goalParam)}`, { cache: "no-store" });
      if (!res.ok || n !== seq.current) return;
      const next = (await res.json()) as { goal: GcsGoalView | null };
      if (next.goal && n === seq.current) setView(next.goal);
    } catch {
      // Rețeaua a căzut: rămâne progresul de acum.
    }
  }, [goalParam]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const off = realtime.on(UPDATE_EVENT, () => void load());
    const offResync = realtime.on("resync", () => void load());
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      off();
      offResync();
      clearInterval(timer);
    };
  }, [realtime, load]);

  const money = (amount: number) => formatMoney(amount, view.currency, locale);
  const shown = filled ? view.percent : 0;
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const periodText =
    view.period.kind === "MONTHLY"
      ? format.dateTime(new Date(`${view.period.startDay}T12:00:00Z`), { month: "long", year: "numeric", timeZone: "UTC" })
      : t("periodRange", { start: day(view.period.startDay), end: day(view.period.endDay) });

  return (
    <div className={`gcs-donGoal gcs-donGoal--${variant}`} data-testid={testId} data-goal={view.id} data-state={view.period.state}>
      <div className="gcs-donGoal__head">
        <strong className="gcs-donGoal__title" data-testid={`${testId}-title`}>
          {view.title}
        </strong>
        <span className="gcs-donGoal__amount" data-testid={`${testId}-amount`}>
          <GcsCountUp value={view.raised} format={(n) => formatProgress(n === view.raised ? n : Math.round(n / 100) * 100, view.target, view.currency, locale)} />
        </span>
      </div>
      <div
        className="gcs-donGoal__bar"
        role="progressbar"
        aria-label={t("progressLabel", { title: view.title })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.percent}
        aria-valuetext={t("progressText", { percent: view.percent, raised: money(view.raised), target: money(view.target) })}
        data-testid={`${testId}-bar`}
      >
        <span className="gcs-donGoal__fill" style={{ "--gcs-don-pct": `${shown}%` } as CSSProperties} />
      </div>
      {variant === "page" && (
        <p className="gcs-donGoal__period">
          <span>{periodText}</span>
          {view.period.state !== "active" && <span className="gcs-badge gcs-badge--neutral">{t(`states.${view.period.state}`)}</span>}
          {view.period.kind === "MONTHLY" && view.period.autoRenew && <span className="gcs-muted">· {t("renews")}</span>}
          <span className="gcs-donGoal__pct">{t("percent", { percent: view.percent })}</span>
        </p>
      )}
      {(showCount || (showLast && view.last)) && (
        <p className="gcs-donGoal__meta" data-testid={`${testId}-meta`}>
          {showCount && <span data-testid={`${testId}-donors`}>{t("donors", { count: view.donors })}</span>}
          {showCount && showLast && view.last && <span aria-hidden="true"> · </span>}
          {showLast && view.last && (
            <span data-testid={`${testId}-last`}>
              {t("last")} <GcsDonorName donor={view.last.donor} testId={`${testId}-last-name`} /> ({money(view.last.amount)})
            </span>
          )}
        </p>
      )}
      {cta && (
        <a
          href={cta.href}
          className="gcs-btn gcs-btn--primary gcs-donGoal__cta"
          data-testid={`${testId}-cta`}
          {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          aria-label={cta.external ? t("ctaExternal") : undefined}
        >
          <GcsIconSvg icon={faHandHoldingHeart} />
          {t("cta")}
          {cta.external && <GcsIconSvg icon={faArrowUpRightFromSquare} className="gcs-donGoal__ext" />}
        </a>
      )}
    </div>
  );
}
