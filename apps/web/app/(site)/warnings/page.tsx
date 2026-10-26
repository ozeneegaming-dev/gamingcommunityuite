import { GcsBadge, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsWarningActions } from "./GcsWarningActions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("warningsPage"))("title"), robots: { index: false } };
}

export const dynamic = "force-dynamic";

/**
 * „Avertismentele mele”: avertismentele primite (punctele, motivul, expirarea, starea), confirmarea (cerută înainte de
 * a posta din nou, dacă site-ul o cere) și contestația unui avertisment activ, cu decizia echipei. Restricțiile active
 * din pragurile de avertisment apar sus.
 */
export default async function WarningsPage() {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login?next=/warnings");
  const t = await getTranslations("warningsPage");
  const format = await getFormatter();
  const { warnings } = services();
  const [list, gate] = await Promise.all([warnings.mine(actor.userId), warnings.writeGate(actor.userId)]);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
      <h1 style={{ margin: 0 }}>{t("title")}</h1>
      {gate.restrictedUntil && (
        <p role="status" className="gcs-notice gcs-notice--error" data-testid="gcs-warnings-restricted">
          {gate.restrictedUntil.getUTCFullYear() > 9000 ? t("restrictedPoints") : t("restricted", { date: date(gate.restrictedUntil) })}
        </p>
      )}
      {gate.moderated && (
        <p role="status" className="gcs-notice gcs-notice--warn" data-testid="gcs-warnings-moderated">
          {t("moderated")}
        </p>
      )}
      {list.length === 0 && <p style={{ color: "var(--gcs-muted)" }}>{t("empty")}</p>}
      {list.map((w) => {
        const state = w.revokedAt ? "revoked" : w.active ? "active" : "expired";
        return (
          <GcsCard key={w.id} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }} data-testid="gcs-warning" data-state={state}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ flex: 1, minWidth: 200 }}>{w.reason}</strong>
              <GcsBadge tone={state === "active" ? "warn" : "neutral"}>{t(`state.${state}`)}</GcsBadge>
              <GcsBadge tone="neutral">{t("points", { count: w.points })}</GcsBadge>
            </div>
            <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 13 }}>
              {date(w.createdAt)} · {w.expiresAt ? t("expires", { date: date(w.expiresAt) }) : t("noExpiry")}
              {w.acknowledgedAt ? ` · ${t("acknowledged")}` : ""}
            </p>
            {w.appeal && (
              <p style={{ margin: 0, fontSize: 13 }} data-testid="gcs-warning-appeal-state" data-state={w.appeal.status}>
                {t(`appealState.${w.appeal.status === "accepted" ? "accepted" : w.appeal.status === "rejected" ? "rejected" : "pending"}`)}
                {w.appeal.decisionReason ? ` — ${w.appeal.decisionReason}` : ""}
              </p>
            )}
            {state === "active" && (!w.acknowledgedAt || !w.appeal) && <GcsWarningActions warningId={w.id} canAcknowledge={!w.acknowledgedAt} canAppeal={!w.appeal} />}
          </GcsCard>
        );
      })}
    </div>
  );
}
