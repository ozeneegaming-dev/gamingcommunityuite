import { faEnvelopesBulk, faGaugeHigh, faPlus } from "@fortawesome/free-solid-svg-icons";
import { sanitizeContentHtml } from "@gcs/core";
import { BULK_MAIL_ACP_SECTION, BULK_MAIL_RATE_SETTING, type GcsBulkMailView } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { cancelBulkMail, deleteBulkMail, duplicateBulkMail, saveBulkRate, sendBulkTest, startBulkMail } from "./actions";
import { GcsBulkMailForm } from "./GcsBulkMailForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.bulkMail"))("title") };
}

const LEVEL: Record<string, "off" | "warn" | "ok" | "down"> = { draft: "off", sending: "warn", sent: "ok", cancelled: "down" };

/**
 * ACP › Membri › Comunicare › Email în masă: ciornele, trimiterile în curs (cu progres și „Oprește”) și cele trimise.
 * „Email nou” și fiecare rând deschid panoul: la o ciornă formularul (mesaj + public cu numărul destinatarilor), testul pe
 * adresa ta și „Trimite”; la una trimisă statisticile, mesajul și „Duplică”. Panoul „Ritm” alege câte emailuri pleacă pe
 * minut. Membrii dezabonați de la emailurile adminilor, cei banați și conturile fără email real nu primesc nimic.
 */
export default async function AcpBulkMailPage() {
  const panel = await requireAcpSection(BULK_MAIL_ACP_SECTION);
  const { bulkMail, acp, db, settings } = services();
  const [t, format, mails, groups, perMinute, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.bulkMail"),
    getFormatter(),
    bulkMail.list(panel.actor),
    db.group.findMany({ where: { key: { notIn: ["guest", "banned"] } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    settings.get<number>(BULK_MAIL_RATE_SETTING),
    acp.can(panel.actor, BULK_MAIL_ACP_SECTION, "edit"),
    acp.can(panel.actor, BULK_MAIL_ACP_SECTION, "delete"),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const audience = (m: GcsBulkMailView) =>
    [
      m.audience.groupIds.length === 0 ? t("allMembers") : m.audience.groupIds.map((id) => groupName.get(id) ?? `#${id}`).join(", "),
      m.audience.primaryOnly ? t("primaryChip") : null,
      m.audience.activeDays ? t("activeChip", { days: m.audience.activeDays }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const formValue = (m?: GcsBulkMailView) => ({
    id: m?.id ?? null,
    subject: m?.subject ?? "",
    body: m?.bodyJson ?? "",
    groupIds: m?.audience.groupIds ?? [],
    primaryOnly: m?.audience.primaryOnly ?? false,
    activeDays: m?.audience.activeDays ?? null,
  });

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-envelopes-bulk"
        description={t("description")}
        actions={
          canEdit && (
            <>
              <GcsAcpEditPanel label={t("rate")} buttonIcon={<GcsIconSvg icon={faGaugeHigh} />} title={t("rate")} titleIcon={<GcsIconSvg icon={faGaugeHigh} />} testId="gcs-bulk-rate">
                <GcsActionForm action={saveBulkRate} submitLabel={t("save")} submitKind="save">
                  <label className="gcs-field">
                    {t("perMinute")}
                    <input className="gcs-input" name="perMinute" type="number" min={5} max={1000} defaultValue={perMinute} required />
                    <span className="gcs-field__hint">{t("perMinuteHint")}</span>
                  </label>
                </GcsActionForm>
              </GcsAcpEditPanel>
              <GcsAcpEditPanel label={t("new")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("new")} titleIcon={<GcsIconSvg icon={faEnvelopesBulk} />} size="lg" testId="gcs-bulk-new">
                <GcsBulkMailForm value={formValue()} groups={groups} />
              </GcsAcpEditPanel>
            </>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <GcsCard className="gcs-acpPanel">
        {mails.length === 0 ? (
          <p className="gcs-acpList__empty gcs-sysEmpty">
            <GcsIcon name="fa-solid fa-envelopes-bulk" /> {t("empty")}
          </p>
        ) : (
          <ul className="gcs-sysList" data-testid="gcs-bulk-list">
            {mails.map((m) => {
              const pct = m.total > 0 ? Math.min(100, Math.round(((m.sent + m.failed) / m.total) * 100)) : 0;
              return (
                <li key={m.id} className="gcs-sysList__row" data-testid="gcs-bulk-row" data-subject={m.subject} data-status={m.status}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name={m.status === "draft" ? "fa-solid fa-file-pen" : m.status === "sending" ? "fa-solid fa-paper-plane" : m.status === "sent" ? "fa-solid fa-circle-check" : "fa-solid fa-ban"} />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{m.subject}</strong>
                    <small>{audience(m)}</small>
                    {m.status !== "draft" && (
                      <span className="gcs-bulkProgress" data-testid="gcs-bulk-progress">
                        <span className="gcs-sysDisk__bar" aria-hidden="true">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <small>
                          {t("progress", { sent: m.sent, total: m.total })}
                          {m.failed > 0 && ` · ${t("failed", { count: m.failed })}`}
                          {m.finishedAt && ` · ${format.relativeTime(m.finishedAt)}`}
                        </small>
                      </span>
                    )}
                  </span>
                  <span className={`gcs-sysChip gcs-sysChip--${LEVEL[m.status] ?? "off"}`}>{t(`status.${m.status}`)}</span>
                  <GcsAcpEditPanel
                    label={m.status === "draft" ? t("edit") : t("open")}
                    title={m.subject}
                    titleIcon={<GcsIconSvg icon={faEnvelopesBulk} />}
                    size="lg"
                    testId="gcs-bulk-panel"
                    footer={
                      canDelete && m.status !== "sending" ? (
                        <GcsActionForm action={deleteBulkMail.bind(null, m.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                          {null}
                        </GcsActionForm>
                      ) : undefined
                    }
                  >
                    {m.status === "draft" && canEdit ? (
                      <div className="gcs-bulkDraft">
                        <GcsBulkMailForm value={formValue(m)} groups={groups} />
                        <div className="gcs-bulkDraft__send">
                          <GcsActionForm action={sendBulkTest.bind(null, m.id)} submitLabel={t("sendTest")} submitKind="approve" variant="ghost" keepOpen>
                            <p className="gcs-field__hint" style={{ margin: 0 }}>
                              {t("sendTestHint")}
                            </p>
                          </GcsActionForm>
                          <GcsActionForm action={startBulkMail.bind(null, m.id)} submitLabel={t("start")} submitKind="approve" confirm={t("startConfirm")}>
                            {null}
                          </GcsActionForm>
                        </div>
                      </div>
                    ) : (
                      <div className="gcs-bulkDraft">
                        <dl className="gcs-sysFacts">
                          <div>
                            <dt>{t("audience")}</dt>
                            <dd>{audience(m)}</dd>
                          </div>
                          <div>
                            <dt>{t("sentLabel")}</dt>
                            <dd>{t("progress", { sent: m.sent, total: m.total })}</dd>
                          </div>
                          <div>
                            <dt>{t("startedAt")}</dt>
                            <dd>{m.startedAt ? format.dateTime(m.startedAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd>
                          </div>
                        </dl>
                        <div className="gcs-postBody gcs-bulkPreview" dangerouslySetInnerHTML={{ __html: sanitizeContentHtml(m.bodyHtml) }} />
                        {canEdit && (
                          <div className="gcs-bulkDraft__send">
                            {m.status === "sending" && (
                              <GcsActionForm action={cancelBulkMail.bind(null, m.id)} submitLabel={t("cancel")} submitKind="reject" variant="ghost" confirm={t("cancelConfirm")}>
                                {null}
                              </GcsActionForm>
                            )}
                            <GcsActionForm action={duplicateBulkMail.bind(null, m.id)} submitLabel={t("duplicate")} submitKind="create" variant="ghost">
                              {null}
                            </GcsActionForm>
                          </div>
                        )}
                      </div>
                    )}
                  </GcsAcpEditPanel>
                </li>
              );
            })}
          </ul>
        )}
      </GcsCard>
    </>
  );
}
