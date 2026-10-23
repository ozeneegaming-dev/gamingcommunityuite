"use client";

import { faRotate } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { recalcStatus, startRecalc } from "../actions";

type Status = { state: string; done: number; total: number; awarded: number };

/**
 * Recalcularea în fundal (Realizări v2): pornește jobul din worker și arată progresul (membri parcurși / total și
 * recompensele date), citit la 1,5 s cât timp rulează.
 */
export function GcsRecalcPanel({ initial }: { initial: Status }) {
  const t = useTranslations("acp.achievements.v2");
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const running = status.state === "queued" || status.state === "running";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const res = await recalcStatus();
      if (res.ok) setStatus(res.data);
    }, 1500);
    return () => clearInterval(timer);
  }, [running]);

  const percent = status.total > 0 ? Math.min(100, Math.round((status.done / status.total) * 100)) : status.state === "done" ? 100 : 0;
  return (
    <div className="gcs-recalc" data-testid="gcs-recalc" data-state={status.state}>
      <div className="gcs-xpBar gcs-recalc__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("recalcProgress")}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="gcs-muted gcs-recalc__line" aria-live="polite">
        {status.state === "idle" ? t("recalcIdle") : t(`recalcState.${status.state as "queued"}`, { done: format.number(status.done), total: format.number(status.total), awarded: format.number(status.awarded) })}
      </p>
      <GcsButton
        variant="ghost"
        icon={<GcsIconSvg icon={faRotate} />}
        disabled={running}
        onClick={async () => {
          setError(null);
          const res = await startRecalc();
          if (!res.ok) return setError(errorMessage(res.error));
          const next = await recalcStatus();
          if (next.ok) setStatus(next.data);
        }}
      >
        {t("recalcStart")}
      </GcsButton>
      {error && (
        <p role="alert" className="gcs-field__error">
          {error}
        </p>
      )}
    </div>
  );
}
