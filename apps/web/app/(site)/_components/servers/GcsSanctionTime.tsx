import type { GcsSanctionView } from "@gcs/modules";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";

/**
 * Durata unei sancțiuni: „Permanent”, timpul rămas cu bara scursă (cât din durată a trecut, pentru o sancțiune
 * temporară activă), data expirării sau a ridicării. Bara are mereu și textul.
 */
export async function GcsSanctionTime({ sanction: s, now }: { sanction: Pick<GcsSanctionView, "status" | "createdAt" | "expiresAt" | "lifted">; now: number }) {
  const [t, format] = await Promise.all([getTranslations("bridge.sanction.time"), getFormatter()]);
  if (s.status === "lifted" && s.lifted) return <span className="gcs-banTime">{t("lifted", { date: format.dateTime(new Date(s.lifted.at), { dateStyle: "medium" }) })}</span>;
  if (!s.expiresAt) return <span className="gcs-banTime gcs-banTime--permanent">{t("permanent")}</span>;
  const end = Date.parse(s.expiresAt);
  if (s.status === "expired") return <span className="gcs-banTime">{t("expired", { date: format.dateTime(new Date(end), { dateStyle: "medium" }) })}</span>;
  const start = Date.parse(s.createdAt);
  const elapsed = Math.min(100, Math.max(0, Math.round(((now - start) / Math.max(1, end - start)) * 100)));
  return (
    <span className="gcs-banTime" data-testid="gcs-ban-remaining">
      {t("remaining", { time: format.relativeTime(new Date(end), now) })}
      <span className="gcs-banTime__bar" style={{ "--gcs-fill": `${elapsed}%` } as CSSProperties} aria-hidden="true" />
    </span>
  );
}
