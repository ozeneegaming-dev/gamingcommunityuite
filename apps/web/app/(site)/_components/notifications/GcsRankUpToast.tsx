"use client";

import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { GcsBadgeArt, GcsIconSvg, GcsTooltip } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

type RankUp = { rankId: number; name: string; level: number; art: string; animated?: boolean };

const SPARKS = 10;

/**
 * Toast-ul de sărbătorire la urcarea în rang (Realizări v2): evenimentul live `rank-up` din camera membrului aduce
 * rangul nou; apare un card cu emblema, „Ai urcat la …” și câteva scântei în culoarea accentului temei. Dispare după
 * 7 s sau la închidere. Cu „mișcare redusă”, doar opacitatea.
 */
export function GcsRankUpToast() {
  const t = useTranslations("profile.rankUp");
  const realtime = useRealtime();
  const [rank, setRank] = useState<RankUp | null>(null);

  useEffect(
    () =>
      realtime.on("rank-up", (data) => {
        const d = data as Partial<RankUp> | null;
        if (d && typeof d.name === "string" && typeof d.art === "string") setRank({ rankId: Number(d.rankId), name: d.name, level: Number(d.level) || 0, art: d.art, animated: d.animated === true });
      }),
    [realtime],
  );

  useEffect(() => {
    if (!rank) return;
    const timer = setTimeout(() => setRank(null), 7000);
    return () => clearTimeout(timer);
  }, [rank]);

  if (!rank) return null;
  return (
    <div className="gcs-rankUp" role="status" aria-live="polite" data-testid="gcs-rank-up">
      <span className="gcs-rankUp__sparks" aria-hidden="true">
        {Array.from({ length: SPARKS }, (_, i) => (
          <i key={i} style={{ ["--i" as string]: i }} />
        ))}
      </span>
      <span className={`gcs-rankEmblem gcs-rankUp__emblem${rank.animated ? " gcs-rankEmblem--animated" : ""}`}>
        <GcsBadgeArt badge={{ name: rank.name, art: rank.art }} size={64} decorative />
      </span>
      <span className="gcs-rankUp__text">
        <span className="gcs-rankUp__kicker">{t("kicker")}</span>
        <strong className="gcs-rankUp__name">{t("title", { name: rank.name })}</strong>
        {rank.level > 0 && <span className="gcs-rankUp__level">{t("level", { level: rank.level })}</span>}
      </span>
      <GcsTooltip content={t("close")}>
        <button type="button" className="gcs-iconBtn gcs-rankUp__close" aria-label={t("close")} onClick={() => setRank(null)}>
          <GcsIconSvg icon={faXmark} />
        </button>
      </GcsTooltip>
    </div>
  );
}
