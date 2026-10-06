import { PLUGINS_ACP_SECTION } from "@gcs/core";
import { GcsPluginTexts, pluginIcon } from "@gcs/modules";
import { GcsBadge, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { isRootAdmin } from "@/lib/plugins";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../../_components/GcsAcpTitle";
import { GcsPluginCapabilities, GcsPluginChecks, GcsPluginDeclarations } from "../../GcsPluginParts";
import { confirmPluginInstall, discardPluginUpload } from "../../plugin-actions";
import { pluginAuthor } from "../../plugin-ui";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.plugins.confirm"))("pageTitle") };
}

/**
 * Ecranul de confirmare a instalării (etapa 6 §2.3): pachetul, raportul verificărilor, capabilitățile explicate pe
 * înțeles (cu cele noi, la o actualizare) și confirmarea. Un pachet nesemnat cere Root Admin, codul 2FA și cheia
 * pluginului tastată.
 */
export default async function AcpPluginConfirmPage({ params }: Props) {
  const { id } = await params;
  const panel = await requireAcpSection(PLUGINS_ACP_SECTION, "edit");
  const { pluginAdmin } = services();
  const staged = /^[a-z0-9]{10,40}$/.test(id) ? await pluginAdmin.staged(panel.actor, id) : null;
  if (!staged) notFound();
  const [t, tc, format, isRoot] = await Promise.all([getTranslations("acp.plugins"), getTranslations("acp.plugins.confirm"), getFormatter(), isRootAdmin(panel.actor)]);
  const { report } = staged;
  const m = report.manifest;
  const signed = report.signature?.status === "signed";
  const texts = m ? new GcsPluginTexts(m.key, m, staged.langs) : null;
  const listHref = "/admin/system/applications";

  return (
    <>
      <Link href={listHref} className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {tc("back")}
      </Link>
      <GcsAcpTitle icon={m ? pluginIcon(m.icon) : "fa-solid fa-file-zipper"} description={tc("description")}>
        {m ? tc("title", { name: m.name }) : tc("pageTitle")}
      </GcsAcpTitle>

      <div className="gcs-pluginConfirm">
        <div className="gcs-pluginConfirm__col">
          <GcsCard as="section" aria-labelledby="gcs-plugin-package">
            <div className="gcs-acpWidget__header">
              <h2 id="gcs-plugin-package" className="gcs-acpWidget__title">
                <GcsAcpTitleIcon name="fa-solid fa-box-open" />
                {tc("package")}
              </h2>
              {report.mode && (
                <GcsBadge tone={report.mode === "install" ? "accent" : "info"} data-testid="gcs-plugin-mode">
                  {report.mode === "update" ? tc("modeUpdate", { from: report.previous?.version ?? "" }) : tc(`mode.${report.mode}`)}
                </GcsBadge>
              )}
            </div>
            <dl className="gcs-pluginFacts">
              {m && (
                <>
                  <div>
                    <dt>{tc("name")}</dt>
                    <dd>
                      <strong>{m.name}</strong> <code>{m.key}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{tc("version")}</dt>
                    <dd>{m.version}</dd>
                  </div>
                  <div>
                    <dt>{tc("author")}</dt>
                    <dd>{pluginAuthor({ manifest: m })}</dd>
                  </div>
                  {m.description && (
                    <div>
                      <dt>{tc("about")}</dt>
                      <dd>{m.description}</dd>
                    </div>
                  )}
                </>
              )}
              <div>
                <dt>{tc("file")}</dt>
                <dd>
                  {staged.fileName} · {format.number(report.size / 1024, { maximumFractionDigits: 1 })} KB · {report.files.length} {tc("files")}
                </dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd>
                  <code title={report.sha256}>{report.sha256.slice(0, 16)}…</code>
                </dd>
              </div>
              <div>
                <dt>{tc("signature")}</dt>
                <dd>
                  {signed ? (
                    <GcsBadge tone="ok" icon={<GcsIcon name="fa-solid fa-certificate" />} data-testid="gcs-plugin-signed">
                      {t("signed", { keyId: report.signature && "keyId" in report.signature ? (report.signature.keyId ?? "") : "" })}
                    </GcsBadge>
                  ) : (
                    <GcsBadge tone="warn" icon={<GcsIcon name="fa-solid fa-unlock" />} data-testid="gcs-plugin-unsigned">
                      {t("unsigned")}
                    </GcsBadge>
                  )}
                </dd>
              </div>
            </dl>
          </GcsCard>

          <GcsCard as="section" aria-labelledby="gcs-plugin-checks">
            <div className="gcs-acpWidget__header">
              <h2 id="gcs-plugin-checks" className="gcs-acpWidget__title">
                <GcsAcpTitleIcon name="fa-solid fa-list-check" />
                {tc("checks")}
              </h2>
              <GcsBadge tone={report.ok ? "ok" : "accent"}>{report.ok ? tc("checksOk") : tc("checksFailed")}</GcsBadge>
            </div>
            <div style={{ padding: 16 }}>
              <GcsPluginChecks checks={report.checks} />
            </div>
          </GcsCard>
        </div>

        <div className="gcs-pluginConfirm__col">
          {m && (
            <GcsCard as="section" aria-labelledby="gcs-plugin-caps">
              <div className="gcs-acpWidget__header">
                <h2 id="gcs-plugin-caps" className="gcs-acpWidget__title">
                  <GcsAcpTitleIcon name="fa-solid fa-key" />
                  {tc("capabilities")}
                </h2>
              </div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
                <p className="gcs-muted" style={{ margin: 0 }}>
                  {tc("capabilitiesHint")}
                </p>
                <GcsPluginCapabilities capabilities={m.capabilities} fresh={report.mode === "update" ? report.newCapabilities : []} />
                {texts && <GcsPluginDeclarations manifest={m} texts={texts} />}
              </div>
            </GcsCard>
          )}

          <GcsCard as="section" aria-labelledby="gcs-plugin-confirm" data-testid="gcs-plugin-confirm">
            <div className="gcs-acpWidget__header">
              <h2 id="gcs-plugin-confirm" className="gcs-acpWidget__title">
                <GcsAcpTitleIcon name="fa-solid fa-circle-check" />
                {tc("confirmTitle")}
              </h2>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {!report.ok || !m ? (
                <p role="alert" className="gcs-pluginWarn gcs-pluginWarn--error">
                  <GcsIcon name="fa-solid fa-circle-xmark" /> {tc("invalid")}
                </p>
              ) : signed ? (
                <GcsActionForm action={confirmPluginInstall.bind(null, staged.id)} submitLabel={report.mode === "update" ? tc("submitUpdate") : tc("submit")} submitKind="approve" redirectTo={`/admin/system/applications/plugins/${m.key}`}>
                  <p className="gcs-muted" style={{ margin: 0 }}>
                    {tc("signedBody")}
                  </p>
                </GcsActionForm>
              ) : (
                <>
                  <div role="alert" className="gcs-pluginWarn" data-testid="gcs-plugin-unsigned-warning">
                    <strong>
                      <GcsIcon name="fa-solid fa-triangle-exclamation" /> {tc("unsignedTitle")}
                    </strong>
                    <span>{tc("unsignedBody")}</span>
                  </div>
                  {isRoot ? (
                    <GcsActionForm action={confirmPluginInstall.bind(null, staged.id)} submitLabel={report.mode === "update" ? tc("submitUpdate") : tc("submit")} submitKind="approve" redirectTo={`/admin/system/applications/plugins/${m.key}`}>
                      <label className="gcs-field">
                        {tc("code")}
                        <input className="gcs-input" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required style={{ maxWidth: 200 }} />
                      </label>
                      <label className="gcs-field">
                        {tc("typeKey", { key: m.key })}
                        <input className="gcs-input" name="confirmKey" autoComplete="off" spellCheck={false} required placeholder={m.key} style={{ maxWidth: 320 }} />
                      </label>
                    </GcsActionForm>
                  ) : (
                    <p className="gcs-pluginWarn gcs-pluginWarn--error">
                      <GcsIcon name="fa-solid fa-user-lock" /> {tc("rootOnly")}
                    </p>
                  )}
                </>
              )}
              <GcsActionForm action={discardPluginUpload.bind(null, staged.id)} submitLabel={tc("cancel")} submitKind="remove" variant="ghost" compact redirectTo="/admin/system/applications" />
            </div>
          </GcsCard>
        </div>
      </div>
    </>
  );
}
