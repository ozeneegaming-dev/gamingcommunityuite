import { GDPR_ACP_SECTION, MEMBER_REMOVAL_ACP_SECTION } from "@gcs/core";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpPanel } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpPageHeader } from "../../../_components/GcsAcpPageHeader";
import { GcsRemovalRefresh } from "../../_removal/GcsRemovalRefresh";
import { GcsRemovalSection } from "../../_removal/GcsRemovalSummary";
import { GcsRemovalStatus, REMOVAL_ACTIVE } from "../../_removal/status";
import { retryRemoval } from "../../removal-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.removal.progress"))("title") };
}

/**
 * Progresul unei ștergeri / uniri (specul 2026-10-09-stergere-unire-membri §7): starea, pașii cu rândurile procesate,
 * eroarea și „Reia”. O vede cine are Cereri GDPR (view) sau dreptul de ștergere pe membri.
 */
export default async function AcpRemovalProgressPage({ params }: Props) {
  const panel = await requireAcpPanel();
  const { acp, memberRemoval } = services();
  const [canGdpr, canDelete, canEditGdpr] = await Promise.all([
    acp.can(panel.actor, GDPR_ACP_SECTION, "view"),
    acp.can(panel.actor, MEMBER_REMOVAL_ACP_SECTION, "delete"),
    acp.can(panel.actor, GDPR_ACP_SECTION, "edit"),
  ]);
  if (!canGdpr && !canDelete) notFound();
  const removal = await memberRemoval.get((await params).id);
  if (!removal) notFound();
  const [t, format] = await Promise.all([getTranslations("acp.removal"), getFormatter()]);
  const steps = removal.stepKeys.map((key) => ({ key, state: removal.stepsState[key] ?? { done: false, processed: 0 } }));
  const done = removal.status === "DONE" ? steps.length : steps.filter((s) => s.state.done).length;
  const percent = steps.length === 0 ? 0 : Math.round((done / steps.length) * 100);
  const title = removal.kind === "MERGE" ? t("progress.titleMerge", { name: removal.userName, target: removal.targetName ?? "" }) : t("progress.titleDelete", { name: removal.userName });

  return (
    <>
      <GcsRemovalRefresh active={REMOVAL_ACTIVE.has(removal.status)} />
      <GcsAcpPageHeader
        icon={removal.kind === "MERGE" ? "fa-solid fa-code-merge" : "fa-solid fa-user-xmark"}
        title={title}
        breadcrumb={[{ label: t("crumbMembers"), href: "/admin/members" }, { label: t("gdpr.title"), href: "/admin/members/gdpr" }, { label: title }]}
        actions={
          canGdpr ? (
            <Link href="/admin/members/gdpr" className="gcs-btn gcs-btn--ghost">
              <GcsIcon name="fa-solid fa-list" className="gcs-btn__icon" />
              {t("progress.backToList")}
            </Link>
          ) : undefined
        }
      />
      <GcsRemovalSection title={t("progress.stateTitle")} icon="fa-solid fa-list-check" testId="gcs-removal-progress">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
          <GcsRemovalStatus status={removal.status} label={t(`status.${removal.status}`)} />
          <span style={{ color: "var(--gcs-muted)", fontSize: 13 }}>
            {removal.kind === "DELETE" ? t(`modes.${removal.mode}.title`) : t("kind.MERGE")} · {t(`source.${removal.source}`)} ·{" "}
            {format.dateTime(removal.createdAt, { dateStyle: "medium", timeStyle: "short" })}
          </span>
        </div>
        {removal.status === "SCHEDULED" && removal.runAfter && <p className="gcs-removalBanner">{t("progress.runAfter", { date: format.dateTime(removal.runAfter, { dateStyle: "medium", timeStyle: "short" }) })}</p>}
        <div className="gcs-acpKpi__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("progress.stepsTitle")} style={{ ["--tone" as string]: removal.status === "FAILED" ? "var(--gcs-acp-bad)" : "var(--gcs-acp-good)" }}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <ol className="gcs-removalSteps" aria-label={t("progress.stepsTitle")}>
          {steps.map((s) => {
            const current = !s.state.done && removal.currentStep === s.key && removal.status !== "DONE";
            const finished = s.state.done || removal.status === "DONE";
            return (
              <li key={s.key} className={`gcs-removalStep${finished ? " gcs-removalStep--done" : ""}${current ? " gcs-removalStep--current" : ""}`} data-step={s.key}>
                <span className="gcs-removalStep__icon">
                  <GcsIcon name={finished ? "fa-solid fa-circle-check" : current ? "fa-solid fa-hourglass-half" : "fa-regular fa-circle"} />
                </span>
                {t.has(`steps.${s.key}`) ? t(`steps.${s.key}`) : s.key}
                {s.state.processed > 0 && <span className="gcs-removalStep__count">{t("progress.processed", { count: s.state.processed })}</span>}
              </li>
            );
          })}
        </ol>
        {removal.status === "DONE" && (
          <p className="gcs-notice" role="status" data-testid="gcs-removal-done">
            {removal.kind === "MERGE" ? t("progress.doneMerge") : t("progress.doneDelete")}
            {removal.kind === "MERGE" && removal.targetId && (
              <>
                {" "}
                <Link href={`/admin/members/${removal.targetId}`}>{t("progress.viewTarget")}</Link>
              </>
            )}
          </p>
        )}
        {removal.error && removal.status !== "DONE" && (
          <p className="gcs-notice gcs-notice--error" role="alert">
            {t("progress.error", { error: removal.error })}
          </p>
        )}
        {removal.status === "FAILED" && canEditGdpr && <GcsActionForm action={retryRemoval.bind(null, removal.id)} submitLabel={t("progress.retry")} submitKind="recompute" />}
      </GcsRemovalSection>
    </>
  );
}
