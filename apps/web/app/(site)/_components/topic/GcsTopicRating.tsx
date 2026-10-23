"use client";

import { faStar as faStarEmpty } from "@fortawesome/free-regular-svg-icons";
import { faChartSimple, faStar, faStarHalfStroke, faXmark } from "@fortawesome/free-solid-svg-icons";
import { ratingStars } from "@gcs/core/rating-stars";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { rateTopicAction, unrateTopicAction } from "../../forum-v2-actions";

export type GcsTopicRatingProps = {
  topicId: number;
  avg: number;
  count: number;
  mine: number | null;
  canRate: boolean;
  /** De ce nu poate nota (cheia `rating.reasons.*`), dacă nu poate. */
  reason: string | null;
  canChange: boolean;
  /** Distribuția voturilor (5★ … 1★), pentru panoul „Distribuția notelor”. */
  distribution: { stars: number; count: number }[];
  loginHref: string;
};

const LABELS = ["poor", "fair", "good", "great", "excellent"] as const;

/** Stelele unei medii (pline, jumătăți, goale), fără interacțiune: antetul pentru cine nu poate nota și rândurile listei. */
export function GcsStarsStatic({ avg, size = "md", label }: { avg: number; size?: "sm" | "md"; label: string }) {
  return (
    <span className={`gcs-stars gcs-stars--${size}`} role="img" aria-label={label} data-testid="gcs-stars">
      {ratingStars(avg).map((s, i) => (
        <GcsIconSvg key={i} icon={s === "full" ? faStar : s === "half" ? faStarHalfStroke : faStarEmpty} className={`gcs-star gcs-star--${s}`} />
      ))}
    </span>
  );
}

/**
 * Nota cu stele din antetul topicului (macheta TopicRating): media cu jumătăți de stea, „4,6 din 5 · 23 voturi”, hover
 * cu eticheta notei (Slab … Excelent), click = nota (animația „pop”), schimbarea votului după setare și panoul cu
 * distribuția. Vizitatorii văd doar media, cu îndemnul de autentificare.
 */
export function GcsTopicRating(props: GcsTopicRatingProps) {
  const t = useTranslations("rating");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const panelId = useId();
  const [pending, start] = useTransition();
  const [state, setState] = useState({ avg: props.avg, count: props.count, mine: props.mine });
  const [hover, setHover] = useState<number | null>(null);
  const [pop, setPop] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const interactive = props.canRate || (props.mine !== null && props.canChange);
  const shown = hover ?? state.mine;
  const avgText = t("average", { avg: state.avg.toFixed(1).replace(".", t("decimal")), count: state.count });

  function rate(value: number) {
    setError(null);
    setPop(value);
    start(async () => {
      const res = state.mine === value && props.canChange ? await unrateTopicAction({ topicId: props.topicId }) : await rateTopicAction({ topicId: props.topicId, value });
      if (!res.ok) {
        setPop(null);
        return setError(errorMessage(res.error));
      }
      setState({ avg: res.data.avg, count: res.data.count, mine: state.mine === value && props.canChange ? null : value });
      router.refresh();
    });
  }

  const total = props.distribution.reduce((n, d) => n + d.count, 0);

  return (
    <div className="gcs-topicRating" data-testid="gcs-topic-rating" data-avg={state.avg} data-count={state.count}>
      {interactive ? (
        <div className="gcs-stars gcs-stars--md gcs-stars--input" role="radiogroup" aria-label={t("rateThis")} onMouseLeave={() => setHover(null)}>
          {[1, 2, 3, 4, 5].map((v) => {
            const fill = shown !== null ? (v <= shown ? "full" : "empty") : ratingStars(state.avg)[v - 1]!;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={state.mine === v}
                aria-label={t("starLabel", { value: v, label: t(`labels.${LABELS[v - 1]!}`) })}
                className={`gcs-starBtn gcs-sweep${pop === v ? " gcs-starBtn--pop" : ""}`}
                data-gcs-tip-off=""
                disabled={pending}
                onMouseEnter={() => setHover(v)}
                onFocus={() => setHover(v)}
                onBlur={() => setHover(null)}
                onAnimationEnd={() => setPop(null)}
                onClick={() => rate(v)}
                data-testid={`gcs-rate-${v}`}
              >
                <GcsIconSvg icon={fill === "full" ? faStar : fill === "half" ? faStarHalfStroke : faStarEmpty} className={`gcs-star gcs-star--${fill}`} />
              </button>
            );
          })}
        </div>
      ) : (
        <GcsStarsStatic avg={state.avg} label={avgText} />
      )}
      <span className="gcs-topicRating__text" aria-live="polite">
        {hover !== null ? <strong className="gcs-topicRating__hint">{t(`labels.${LABELS[hover - 1]!}`)}</strong> : state.count > 0 ? avgText : t("none")}
      </span>
      {state.mine !== null && hover === null && (
        <span className="gcs-topicRating__mine" data-testid="gcs-rating-mine">
          {t("yours", { value: state.mine })}
          {props.canChange && (
            <button type="button" className="gcs-topicRating__undo" aria-label={t("undo")} onClick={() => rate(state.mine!)} disabled={pending}>
              <GcsIconSvg icon={faXmark} />
            </button>
          )}
        </span>
      )}
      {props.reason === "guest" && (
        <span className="gcs-topicRating__guest">
          <Link href={props.loginHref}>{t("signIn")}</Link> {t("signInHint")}
        </span>
      )}
      {props.reason && props.reason !== "guest" && props.reason !== "already_rated" && !interactive && <span className="gcs-topicRating__why">{t(`reasons.${props.reason}` as never)}</span>}
      {total > 0 && (
        <span className="gcs-topicRating__dist">
          <button type="button" className="gcs-iconBtn gcs-topicRating__distBtn" aria-expanded={open} aria-controls={panelId} aria-label={t("distribution")} onClick={() => setOpen((v) => !v)} data-testid="gcs-rating-dist-btn">
            <GcsIconSvg icon={faChartSimple} />
          </button>
          {open && (
            <span className="gcs-ratingDist" id={panelId} role="region" aria-label={t("distribution")} data-testid="gcs-rating-dist">
              <strong className="gcs-ratingDist__title">{t("distribution")}</strong>
              {props.distribution.map((d) => (
                <span key={d.stars} className="gcs-ratingDist__row">
                  <span>{t("starsShort", { value: d.stars })}</span>
                  <span className="gcs-ratingDist__bar" aria-hidden="true">
                    <span style={{ width: `${total === 0 ? 0 : Math.round((d.count / total) * 100)}%` }} />
                  </span>
                  <span>{d.count}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      )}
      {error && (
        <span role="alert" className="gcs-topicRating__error">
          {error}
        </span>
      )}
    </div>
  );
}
