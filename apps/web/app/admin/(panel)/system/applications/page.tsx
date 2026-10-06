import { APPS_ACP_SECTION, PLUGINS_ACP_SECTION, trustedPluginKeys } from "@gcs/core";
import { pluginIcon } from "@gcs/modules";
import { GcsBadge, GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { setAppEnabled } from "../../appearance/actions";
import { pluginAuthor, pluginStatus } from "./plugin-ui";
import { GcsPluginToggle } from "./GcsPluginToggle";
import { GcsPluginUpload } from "./GcsPluginUpload";
import { disableAllPlugins } from "./plugin-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.plugins"))("title") };
}

/**
 * ACP → Sistem → Aplicații și pluginuri (etapa 6 §2.3): aplicațiile opționale (Chat, VIP…), lista pluginurilor (stare,
 * semnătură, comutator, pagina fiecăruia) și încărcarea unui `.zip`. Instalarea trece întotdeauna prin ecranul de
 * confirmare, cu raportul verificărilor.
 */
export default async function AcpApplicationsPage() {
  const panel = await requireAcpSection(APPS_ACP_SECTION);
  const { apps, pluginAdmin, acp } = services();
  const [t, tp, tAll, format, appList, plugins, canEdit] = await Promise.all([
    getTranslations("acp.apps"),
    getTranslations("acp.plugins"),
    getTranslations(),
    getFormatter(),
    apps.list(),
    pluginAdmin.list(),
    acp.can(panel.actor, PLUGINS_ACP_SECTION, "edit"),
  ]);
  const trusted = trustedPluginKeys();

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-cubes"
        description={tp("description")}
        actions={
          canEdit ? (
            <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-upload" />}>
              <a href="#upload">{tp("upload.title")}</a>
            </GcsButton>
          ) : null
        }
      >
        {tp("title")}
      </GcsAcpTitle>

      <GcsCard as="section" aria-labelledby="gcs-apps-title">
        <div className="gcs-acpWidget__header">
          <h2 id="gcs-apps-title" className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-layer-group" />
            {tp("appsTitle")}
          </h2>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("hint")}
          </p>
          <div className="gcs-acpGrid">
            {appList.map((app) => (
              <GcsCard key={app.key} as="section" aria-label={tAll.has(app.labelKey) ? tAll(app.labelKey) : app.key} style={{ padding: 16 }} data-testid={`gcs-acp-app-${app.key}`}>
                <h3 className="gcs-acpWidget__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <GcsIcon name={app.icon} /> {tAll.has(app.labelKey) ? tAll(app.labelKey) : app.key}
                </h3>
                <GcsActionForm action={setAppEnabled.bind(null, app.key)} submitLabel={t("save")} submitKind="save">
                  <label className="gcs-checkRow">
                    <input type="checkbox" name="enabled" defaultChecked={app.enabled} />
                    {t("enabled")}
                  </label>
                </GcsActionForm>
              </GcsCard>
            ))}
          </div>
        </div>
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-plugins-title" data-testid="gcs-plugins-list">
        <div className="gcs-acpWidget__header">
          <h2 id="gcs-plugins-title" className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-puzzle-piece" />
            {tp("list.title")}
            <span className="gcs-pluginCount">{plugins.length}</span>
          </h2>
          {canEdit && plugins.some((p) => p.enabled) && (
            <GcsActionForm action={disableAllPlugins} submitLabel={tp("list.disableAll")} submitIcon={<GcsIcon name="fa-solid fa-power-off" />} variant="ghost" compact confirm={tp("list.disableAllConfirm")} />
          )}
        </div>
        {plugins.length === 0 ? (
          <p className="gcs-acpList__empty" style={{ padding: 16 }}>
            <GcsIcon name="fa-solid fa-puzzle-piece" /> {tp("list.empty")}
          </p>
        ) : (
          <ul className="gcs-pluginList">
            {plugins.map((p) => {
              const status = pluginStatus(p);
              return (
                <li key={p.key} className="gcs-pluginRow" data-testid={`gcs-plugin-${p.key}`}>
                  <span className="gcs-pluginRow__icon" aria-hidden="true">
                    <GcsIcon name={pluginIcon(p.manifest.icon)} />
                  </span>
                  <div className="gcs-pluginRow__main">
                    <div className="gcs-pluginRow__name">
                      <Link href={`/admin/system/applications/plugins/${p.key}`}>{p.name}</Link>
                      <code>{p.key}</code>
                      <span className="gcs-muted">v{p.version}</span>
                    </div>
                    <div className="gcs-pluginRow__badges">
                      <GcsBadge tone={status.tone} icon={<GcsIcon name={status.icon} />} data-testid="gcs-plugin-status">
                        {tp(`status.${status.key}`)}
                      </GcsBadge>
                      {p.signed ? (
                        <GcsBadge tone="info" icon={<GcsIcon name="fa-solid fa-certificate" />}>
                          {tp("signed", { keyId: p.signatureKeyId ?? "" })}
                        </GcsBadge>
                      ) : (
                        <GcsBadge tone="warn" icon={<GcsIcon name="fa-solid fa-unlock" />}>
                          {tp("unsigned")}
                        </GcsBadge>
                      )}
                      <span className="gcs-muted gcs-pluginRow__author">
                        <GcsIcon name="fa-solid fa-user-pen" /> {pluginAuthor(p)} · {tp("list.updated", { date: format.dateTime(p.updatedAt, { dateStyle: "medium" }) })}
                      </span>
                    </div>
                    {p.manifest.description && <p className="gcs-pluginRow__desc">{p.manifest.description}</p>}
                    {p.disabledReason === "auto" && p.lastError && (
                      <p className="gcs-pluginRow__error">
                        <GcsIcon name="fa-solid fa-bug" /> {p.lastError}
                      </p>
                    )}
                  </div>
                  <div className="gcs-pluginRow__actions">
                    {p.status === "installed" && <GcsPluginToggle pluginKey={p.key} enabled={p.enabled} label={tp("list.toggle", { name: p.name })} disabled={!canEdit} />}
                    <GcsButton variant="ghost" size="sm" asChild icon={<GcsIcon name="fa-solid fa-sliders" />}>
                      <Link href={`/admin/system/applications/plugins/${p.key}`} data-testid={`gcs-plugin-manage-${p.key}`}>
                        {tp("list.manage")}
                      </Link>
                    </GcsButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </GcsCard>

      {canEdit && (
        <GcsCard as="section" id="upload" aria-labelledby="gcs-plugin-upload-title">
          <div className="gcs-acpWidget__header">
            <h2 id="gcs-plugin-upload-title" className="gcs-acpWidget__title">
              <GcsAcpTitleIcon name="fa-solid fa-upload" />
              {tp("upload.title")}
            </h2>
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="gcs-muted" style={{ margin: 0 }}>
              {tp("upload.body")}
            </p>
            <GcsPluginUpload
              labels={{ file: tp("upload.file"), hint: tp("upload.hint"), submit: tp("upload.submit"), uploading: tp("upload.uploading"), network: tp("upload.network") }}
            />
            <p className="gcs-muted gcs-pluginKeys" data-testid="gcs-plugin-trusted-keys">
              <GcsIcon name="fa-solid fa-key" />{" "}
              {trusted.keys.size > 0 ? tp("upload.trusted", { keys: [...trusted.keys.keys()].join(", ") }) : tp("upload.noTrusted")}
            </p>
          </div>
        </GcsCard>
      )}
    </>
  );
}
