import { DELETION_COOLING_SETTING, GDPR_ACP_SECTION } from "@gcs/core";
import type { MemberRemovalStatus } from "@gcs/db";
import { GcsButton, GcsCard, GcsTable } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsRemovalSection } from "../_removal/GcsRemovalSummary";
import { GcsRemovalStatus } from "../_removal/status";
import { cancelRemoval, runRemovalNow, saveDeletionCooling } from "../removal-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.removal.gdpr"))("title") };
}

const FILTERS = ["all", "active", "SCHEDULED", "DONE", "FAILED", "CANCELLED"] as const;
type Filter = (typeof FILTERS)[number];

type Props = { searchParams: Promise<{ status?: string; page?: string }> };

/**
 * ACP → Membri → Cereri GDPR (specul 2026-10-09-stergere-unire-membri §5, §7): cererile membrilor (cu perioada de
 * răzgândire) și operațiile pornite de staff, cu acțiunile lor și setarea perioadei.
 */
export default async function AcpGdprPage({ searchParams }: Props) {
  const panel = await requireAcpSection(GDPR_ACP_SECTION);
  const sp = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as Filter) : "all";
  const { memberRemoval, settings, acp } = services();
  const [result, cooling, canEdit, t, format] = await Promise.all([
    memberRemoval.list({ ...(filter !== "all" ? { status: filter as MemberRemovalStatus | "active" } : {}), page: Number(sp.page) || 1 }),
    settings.get<number>(DELETION_COOLING_SETTING),
    acp.can(panel.actor, GDPR_ACP_SECTION, "edit"),
    getTranslations("acp.removal"),
    getFormatter(),
  ]);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const href = (status: Filter, page = 1) => `/admin/members/gdpr?${new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-scale-balanced" description={t("gdpr.description")}>
        {t("gdpr.title")}
      </GcsAcpTitle>

      <GcsRemovalSection title={t("gdpr.coolingTitle")} icon="fa-solid fa-hourglass-half" testId="gcs-gdpr-cooling">
        {canEdit ? (
          <GcsActionForm action={saveDeletionCooling} submitLabel={t("gdpr.save")} submitKind="save">
            <label className="gcs-field" style={{ maxWidth: 360 }}>
              {t("gdpr.coolingLabel")}
              <input className="gcs-input" type="number" name="days" min={0} max={90} defaultValue={cooling} required />
            </label>
            <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 13 }}>{t("gdpr.coolingHint")}</p>
          </GcsActionForm>
        ) : (
          <p style={{ margin: 0 }}>{t("gdpr.coolingValue", { days: cooling })}</p>
        )}
      </GcsRemovalSection>

      <GcsCard>
        <nav className="gcs-acpTabs" aria-label={t("gdpr.filtersLabel")} style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 16px" }}>
          {FILTERS.map((f) => (
            <GcsButton key={f} asChild size="sm" variant={f === filter ? "primary" : "ghost"}>
              <Link href={href(f)} aria-current={f === filter ? "page" : undefined}>
                {t(`gdpr.filters.${f}`)}
              </Link>
            </GcsButton>
          ))}
        </nav>
        <div style={{ padding: "0 16px 12px", color: "var(--gcs-muted)", fontSize: 13 }}>{t("gdpr.total", { count: result.total })}</div>
        <GcsTable
          className="gcs-removalTable"
          caption={t("gdpr.title")}
          rowKey={(r) => r.id}
          empty={t("gdpr.empty")}
          rows={result.items}
          columns={[
            {
              key: "userName",
              className: "gcs-removalTable__member",
              header: t("gdpr.columns.member"),
              render: (r) => (
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {r.status === "DONE" ? <strong>{r.userName}</strong> : <Link href={`/admin/members/${r.userId}`}>{r.userName}</Link>}
                  <span style={{ color: "var(--gcs-muted)", fontSize: 12 }}>{t(`source.${r.source}`)}</span>
                </span>
              ),
            },
            {
              key: "kind",
              className: "gcs-removalTable__kind",
              header: t("gdpr.columns.kind"),
              render: (r) => (r.kind === "MERGE" ? t("gdpr.kindMerge", { target: r.targetName ?? "" }) : `${t("kind.DELETE")} · ${t(`modes.${r.mode}.title`)}`),
            },
            { key: "status", className: "gcs-removalTable__status", header: t("gdpr.columns.status"), render: (r) => <GcsRemovalStatus status={r.status} label={t(`status.${r.status}`)} /> },
            {
              key: "createdAt",
              className: "gcs-removalTable__when",
              header: t("gdpr.columns.when"),
              render: (r) => (
                <span style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
                  {date(r.createdAt)}
                  {r.status === "SCHEDULED" && r.runAfter && <span style={{ color: "var(--gcs-muted)", fontSize: 12 }}>{t("gdpr.runAfter", { date: date(r.runAfter) })}</span>}
                </span>
              ),
            },
            {
              key: "id",
              className: "gcs-removalTable__actions",
              header: t("gdpr.columns.actions"),
              render: (r) => (
                <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }} data-testid="gcs-gdpr-actions">
                  {r.status !== "SCHEDULED" && r.status !== "CANCELLED" && (
                    <Link href={`/admin/members/removals/${r.id}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm">
                      <GcsIcon name="fa-solid fa-list-check" className="gcs-btn__icon" />
                      {t("gdpr.view")}
                    </Link>
                  )}
                  {r.status === "SCHEDULED" && canEdit && (
                    <>
                      <GcsActionForm compact action={runRemovalNow.bind(null, r.id)} submitLabel={t("gdpr.runNow")} submitKind="delete" confirm={t("gdpr.confirmRunNow", { name: r.userName })} />
                      <GcsActionForm compact variant="ghost" action={cancelRemoval.bind(null, r.id)} submitLabel={t("gdpr.cancel")} submitKind="remove" />
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
        {result.pages > 1 && (
          <nav style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", padding: 12 }}>
            {result.page > 1 && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href(filter, result.page - 1)}>{t("gdpr.prev")}</Link>
              </GcsButton>
            )}
            <span style={{ fontSize: 13, color: "var(--gcs-muted)" }}>{t("gdpr.page", { page: result.page, pages: result.pages })}</span>
            {result.page < result.pages && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href(filter, result.page + 1)}>{t("gdpr.next")}</Link>
              </GcsButton>
            )}
          </nav>
        )}
      </GcsCard>
    </>
  );
}
