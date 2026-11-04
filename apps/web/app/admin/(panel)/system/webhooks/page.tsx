import { faPlus, faSatelliteDish } from "@fortawesome/free-solid-svg-icons";
import { WEBHOOK_EVENTS, WEBHOOKS_ACP_SECTION, type GcsWebhookView } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { deleteWebhook, rotateWebhookSecret, saveWebhook, testWebhook } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.webhooks"))("title") };
}

/**
 * ACP › Sistem › Funcții site › Webhooks: endpointurile (JSON semnat sau Discord) cu evenimentele lor și ultima livrare.
 * Panoul fiecăruia: adresa, formatul, evenimentele, secretul (cu „Generează altul”), „Trimite un test” și ultimele
 * livrări; jos „Șterge”.
 */
export default async function AcpWebhooksPage() {
  const panel = await requireAcpSection(WEBHOOKS_ACP_SECTION);
  const { webhooks, acp } = services();
  const [t, format, hooks, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.webhooks"),
    getFormatter(),
    webhooks.list(panel.actor),
    acp.can(panel.actor, WEBHOOKS_ACP_SECTION, "edit"),
    acp.can(panel.actor, WEBHOOKS_ACP_SECTION, "delete"),
  ]);

  const form = (h?: GcsWebhookView) => (
    <GcsActionForm action={saveWebhook.bind(null, h?.id ?? null)} submitLabel={h ? t("save") : t("create")} submitKind={h ? "save" : "create"}>
      <fieldset className="gcs-formSec">
        <legend>{t("secEndpoint")}</legend>
        <label className="gcs-field">
          {t("name")}
          <input className="gcs-input" name="name" required minLength={2} maxLength={60} defaultValue={h?.name ?? ""} />
        </label>
        <label className="gcs-field">
          {t("url")}
          <input className="gcs-input" name="url" type="url" required defaultValue={h?.url ?? ""} placeholder="https://" />
          <span className="gcs-field__hint">{t("urlHint")}</span>
        </label>
        <label className="gcs-field">
          {t("format")}
          <select className="gcs-input" name="format" defaultValue={h?.format ?? "json"}>
            <option value="json">{t("formats.json")}</option>
            <option value="discord">{t("formats.discord")}</option>
          </select>
        </label>
        <label className="gcs-toggleRow">
          <span>{t("enabled")}</span>
          <input type="checkbox" name="enabled" defaultChecked={h?.enabled ?? true} />
        </label>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("events")}</legend>
        <div className="gcs-forumChecks__list">
          {WEBHOOK_EVENTS.map((e) => (
            <label key={e} className="gcs-check">
              <input type="checkbox" name="event" value={e} defaultChecked={h ? h.events.includes(e) : e === "topic.created"} />
              {t(`eventNames.${e.replace(".", "_")}`)}
            </label>
          ))}
        </div>
      </fieldset>
    </GcsActionForm>
  );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-satellite-dish"
        description={t("description")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} titleIcon={<GcsIconSvg icon={faSatelliteDish} />} size="lg" testId="gcs-webhook-new">
              {form()}
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <GcsCard className="gcs-acpPanel">
        {hooks.length === 0 ? (
          <p className="gcs-acpList__empty gcs-sysEmpty">
            <GcsIcon name="fa-solid fa-satellite-dish" /> {t("empty")}
          </p>
        ) : (
          <ul className="gcs-sysList" data-testid="gcs-webhooks-list">
            {hooks.map((h) => {
              const last = h.log[0];
              const level = !h.enabled ? "off" : !last ? "off" : last.error ? "down" : "ok";
              return (
                <li key={h.id} className="gcs-sysList__row" data-testid="gcs-webhook-row" data-name={h.name}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name={h.format === "discord" ? "fa-brands fa-discord" : "fa-solid fa-code"} />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{h.name}</strong>
                    <small>
                      <code>{new URL(h.url).host}</code> · {t("eventsCount", { count: h.events.length })}
                      {last && ` · ${t("lastDelivery", { when: format.relativeTime(new Date(last.at)) })}`}
                    </small>
                  </span>
                  <span className={`gcs-sysChip gcs-sysChip--${level}`} data-level={level}>
                    {!h.enabled ? t("disabled") : !last ? t("never") : last.error ? t("failed") : t("ok")}
                  </span>
                  {canEdit && (
                    <GcsAcpEditPanel
                      title={h.name}
                      titleIcon={<GcsIconSvg icon={faSatelliteDish} />}
                      size="lg"
                      testId="gcs-webhook-edit"
                      footer={
                        canDelete ? (
                          <GcsActionForm action={deleteWebhook.bind(null, h.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                            {null}
                          </GcsActionForm>
                        ) : undefined
                      }
                    >
                      <div className="gcs-bulkDraft">
                        {form(h)}
                        <div className="gcs-bulkDraft__send">
                          <GcsActionForm action={testWebhook.bind(null, h.id)} submitLabel={t("test")} submitKind="approve" variant="ghost" keepOpen>
                            <p className="gcs-field__hint" style={{ margin: 0 }}>
                              {t("testHint")}
                            </p>
                          </GcsActionForm>
                        </div>
                        {h.format === "json" && (
                          <fieldset className="gcs-formSec">
                            <legend>{t("secret")}</legend>
                            <code className="gcs-webhookSecret" data-testid="gcs-webhook-secret">
                              {h.secret}
                            </code>
                            <span className="gcs-field__hint">{t("secretHint")}</span>
                            <GcsActionForm action={rotateWebhookSecret.bind(null, h.id)} submitLabel={t("rotate")} submitKind="reset" variant="ghost" compact keepOpen confirm={t("rotateConfirm")}>
                              {null}
                            </GcsActionForm>
                          </fieldset>
                        )}
                        <fieldset className="gcs-formSec">
                          <legend>{t("deliveries")}</legend>
                          {h.log.length === 0 ? (
                            <p className="gcs-sysMuted">{t("noDeliveries")}</p>
                          ) : (
                            <ul className="gcs-sysList" data-testid="gcs-webhook-log">
                              {h.log.map((d, i) => (
                                <li key={i} className="gcs-sysList__row">
                                  <span className="gcs-sysList__body">
                                    <strong>{d.event}</strong>
                                    <small>
                                      {format.relativeTime(new Date(d.at))} · {d.ms} ms{d.error ? ` · ${d.error}` : ""}
                                    </small>
                                  </span>
                                  <span className={`gcs-sysChip gcs-sysChip--${d.error ? "down" : "ok"}`}>{d.status || "—"}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </fieldset>
                      </div>
                    </GcsAcpEditPanel>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </GcsCard>
    </>
  );
}
