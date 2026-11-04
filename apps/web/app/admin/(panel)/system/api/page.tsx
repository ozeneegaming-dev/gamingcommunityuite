import { faCode, faKey, faPlus } from "@fortawesome/free-solid-svg-icons";
import { API_ACP_SECTION, API_RATE_PER_MINUTE, GCS_API_SCOPES, type GcsApiKeyView, type GcsApiScope } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { createApiKey, deleteApiKey, revokeApiKey, updateApiKey } from "./actions";
import { GcsApiKeyCreate } from "./GcsApiKeyCreate";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.api"))("title") };
}

/** Ruta fiecărui drept (exemplele din „Cum se folosește”). */
const ENDPOINTS: Record<GcsApiScope, string> = {
  "stats:read": "/api/v1/stats",
  "forums:read": "/api/v1/topics?limit=10",
  "members:read": "/api/v1/members/{name}",
  "servers:read": "/api/v1/servers",
};
const scopeKey = (s: string) => s.replace(":", "_");

/**
 * ACP › Sistem › Funcții site › API: cheile (prefixul, drepturile, ultima folosire, starea) și panoul fiecăreia cu
 * numele, drepturile, „Revocă”, ultimele cereri și „Șterge”. „Cheie nouă” arată cheia întreagă o singură dată. Jos,
 * rutele disponibile cu un exemplu `curl`.
 */
export default async function AcpApiPage() {
  const panel = await requireAcpSection(API_ACP_SECTION);
  const { apiKeys, acp, settings } = services();
  const [t, format, keys, canEdit, canDelete, siteUrl] = await Promise.all([
    getTranslations("acp.api"),
    getFormatter(),
    apiKeys.list(panel.actor),
    acp.can(panel.actor, API_ACP_SECTION, "edit"),
    acp.can(panel.actor, API_ACP_SECTION, "delete"),
    settings.get<string>("site.url"),
  ]);
  const base = (siteUrl || process.env.GCS_BASE_URL || "").replace(/\/$/, "");

  const scopeChecks = (k?: GcsApiKeyView) => (
    <fieldset className="gcs-formSec">
      <legend>{t("scopes")}</legend>
      <div className="gcs-forumChecks__list">
        {GCS_API_SCOPES.map((s) => (
          <label key={s} className="gcs-check">
            <input type="checkbox" name="scope" value={s} defaultChecked={k ? k.scopes.includes(s) : s === "stats:read"} />
            {t(`scopeNames.${scopeKey(s)}`)} <code className="gcs-apiScope">{s}</code>
          </label>
        ))}
      </div>
    </fieldset>
  );
  const nameField = (k?: GcsApiKeyView) => (
    <label className="gcs-field">
      {t("name")}
      <input className="gcs-input" name="name" required minLength={2} maxLength={60} defaultValue={k?.name ?? ""} placeholder={t("namePlaceholder")} />
      <span className="gcs-field__hint">{t("nameHint")}</span>
    </label>
  );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-code"
        description={t("description", { rate: API_RATE_PER_MINUTE })}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} titleIcon={<GcsIconSvg icon={faKey} />} testId="gcs-api-new">
              <GcsApiKeyCreate action={createApiKey}>
                {nameField()}
                {scopeChecks()}
              </GcsApiKeyCreate>
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <GcsCard className="gcs-acpPanel">
        {keys.length === 0 ? (
          <p className="gcs-acpList__empty gcs-sysEmpty">
            <GcsIcon name="fa-solid fa-key" /> {t("empty")}
          </p>
        ) : (
          <ul className="gcs-sysList" data-testid="gcs-api-list">
            {keys.map((k) => {
              const level = k.revokedAt ? "down" : k.lastUsedAt ? "ok" : "off";
              return (
                <li key={k.id} className="gcs-sysList__row" data-testid="gcs-api-row" data-name={k.name}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name="fa-solid fa-key" />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{k.name}</strong>
                    <small>
                      <code>gcs_{k.prefix}_…</code> · {k.scopes.map((s) => t(`scopeNames.${scopeKey(s)}`)).join(", ")} ·{" "}
                      {k.lastUsedAt ? t("lastUsed", { when: format.relativeTime(k.lastUsedAt) }) : t("neverUsed")}
                    </small>
                  </span>
                  <span className={`gcs-sysChip gcs-sysChip--${level}`} data-level={level}>
                    {k.revokedAt ? t("revoked") : k.lastUsedAt ? t("active") : t("unused")}
                  </span>
                  {canEdit && (
                    <GcsAcpEditPanel
                      title={k.name}
                      titleIcon={<GcsIconSvg icon={faKey} />}
                      testId="gcs-api-edit"
                      footer={
                        canDelete ? (
                          <GcsActionForm action={deleteApiKey.bind(null, k.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                            {null}
                          </GcsActionForm>
                        ) : undefined
                      }
                    >
                      <div className="gcs-bulkDraft">
                        <p className="gcs-sysMuted" style={{ margin: 0 }}>
                          {t("created", { when: format.dateTime(k.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}
                          {k.revokedAt && ` · ${t("revokedAt", { when: format.dateTime(k.revokedAt, { dateStyle: "medium", timeStyle: "short" }) })}`}
                        </p>
                        <GcsActionForm action={updateApiKey.bind(null, k.id)} submitLabel={t("save")} submitKind="save">
                          {nameField(k)}
                          {scopeChecks(k)}
                        </GcsActionForm>
                        {!k.revokedAt && (
                          <div className="gcs-bulkDraft__send">
                            <GcsActionForm action={revokeApiKey.bind(null, k.id)} submitLabel={t("revoke")} submitKind="revoke" variant="ghost" keepOpen confirm={t("confirmRevoke")}>
                              <p className="gcs-field__hint" style={{ margin: 0 }}>
                                {t("revokeHint")}
                              </p>
                            </GcsActionForm>
                          </div>
                        )}
                        <fieldset className="gcs-formSec">
                          <legend>{t("calls")}</legend>
                          {k.log.length === 0 ? (
                            <p className="gcs-sysMuted">{t("noCalls")}</p>
                          ) : (
                            <ul className="gcs-sysList" data-testid="gcs-api-log">
                              {k.log.map((c, i) => (
                                <li key={i} className="gcs-sysList__row">
                                  <span className="gcs-sysList__body">
                                    <strong>
                                      <code>{c.path}</code>
                                    </strong>
                                    <small>
                                      {format.relativeTime(new Date(c.at))}
                                      {c.ip ? ` · ${c.ip}` : ""}
                                    </small>
                                  </span>
                                  <span className={`gcs-sysChip gcs-sysChip--${c.status < 400 ? "ok" : c.status === 404 ? "warn" : "down"}`}>{c.status}</span>
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

      <GcsCard className="gcs-acpPanel">
        <h2 className="gcs-acpPanel__title">
          <GcsIconSvg icon={faCode} /> {t("docsTitle")}
        </h2>
        <p className="gcs-sysMuted">{t("docsIntro")}</p>
        <code className="gcs-webhookSecret gcs-apiDocs__curl" data-testid="gcs-api-curl">
          curl -H &quot;Authorization: Bearer gcs_…&quot; {base}/api/v1/stats
        </code>
        <ul className="gcs-sysList gcs-apiDocs" data-testid="gcs-api-endpoints">
          {GCS_API_SCOPES.map((s) => (
            <li key={s} className="gcs-sysList__row">
              <span className="gcs-sysList__icon" aria-hidden="true">
                <GcsIcon name="fa-solid fa-arrow-right-arrow-left" />
              </span>
              <span className="gcs-sysList__body">
                <strong>
                  <code>GET {ENDPOINTS[s]}</code>
                </strong>
                <small>{t(`endpoints.${scopeKey(s)}`)}</small>
              </span>
              <code className="gcs-apiScope">{s}</code>
            </li>
          ))}
        </ul>
        <p className="gcs-field__hint">{t("docsErrors", { rate: API_RATE_PER_MINUTE })}</p>
      </GcsCard>
    </>
  );
}
