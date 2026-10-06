import { isPluginKey, PLUGINS_ACP_SECTION, pluginSchema, type GcsPluginSettingField } from "@gcs/core";
import { GcsPluginTexts, pluginIcon } from "@gcs/modules";
import { GcsBadge, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../../_components/GcsAcpTitle";
import { GcsChatSettingsForm, type GcsChatSettingRow } from "../../../../community/chat/settings/GcsChatSettingsForm";
import { GcsChatSettingsTabs } from "../../../../community/chat/settings/GcsChatSettingsTabs";
import { GcsPluginCapabilities, GcsPluginDeclarations } from "../../GcsPluginParts";
import { GcsPluginToggle } from "../../GcsPluginToggle";
import { GcsPluginUpload } from "../../GcsPluginUpload";
import { savePluginSettings, uninstallPlugin } from "../../plugin-actions";
import { pluginAuthor, pluginStatus } from "../../plugin-ui";

type Props = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const key = decodeURIComponent((await params).key);
  const row = isPluginKey(key) ? await services().pluginAdmin.get(key) : null;
  return { title: row?.name };
}

/**
 * Pagina unui plugin (ACP → Sistem → Aplicații și pluginuri → plugin): setările generate din manifest (tab-urile lui,
 * comutatoare, „Nelimitat”), jurnalul (erori, timpi pe hook), detaliile (capabilități, declarații, baza de date,
 * fișiere) și gestionarea (actualizare, dezinstalare cu păstrarea datelor).
 */
export default async function AcpPluginDetailPage({ params }: Props) {
  const key = decodeURIComponent((await params).key);
  if (!isPluginKey(key)) notFound();
  const panel = await requireAcpSection(PLUGINS_ACP_SECTION);
  const { pluginAdmin, plugins, acp } = services();
  const row = await pluginAdmin.get(key);
  if (!row) notFound();
  const [t, tp, tAll, format, locale, langs, logs, metrics, files, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.plugins.detail"),
    getTranslations("acp.plugins"),
    getTranslations(),
    getFormatter(),
    getLocale(),
    pluginAdmin.langs(key),
    pluginAdmin.logs(key, 100),
    plugins.hookMetrics(key),
    pluginAdmin.packageFiles(key),
    acp.can(panel.actor, PLUGINS_ACP_SECTION, "edit"),
    acp.can(panel.actor, PLUGINS_ACP_SECTION, "delete"),
  ]);
  const m = row.manifest;
  const texts = new GcsPluginTexts(key, m, langs);
  const text = (label: string) => texts.text(label, locale);
  const status = pluginStatus(row);
  const runtime = plugins.status(key);
  const f = (k: string) => tAll(`acp.chat.form.${k}`);
  const saveLabels = { save: tp("detail.save"), saved: tAll("acp.saved") };

  const settingRow = (field: GcsPluginSettingField): GcsChatSettingRow => {
    const value = row.settings[field.key];
    const base = { key: field.key, label: text(field.label), ...(field.hint ? { hint: text(field.hint) } : {}) };
    switch (field.type) {
      case "toggle":
        return { ...base, kind: "switch", value: value === true };
      case "select":
        return { ...base, kind: "select", value: String(value ?? ""), options: field.options.map((o) => ({ value: o.value, label: text(o.label) })) };
      case "number":
        return {
          ...base,
          kind: "number",
          value: typeof value === "number" ? value : field.default,
          min: field.min,
          max: field.max,
          ...(field.step ? { step: field.step } : {}),
          ...(field.unit ? { unit: text(field.unit) } : {}),
          ...(field.unlimited ? { none: { or: f("or"), label: f("unlimited"), fallback: field.default || field.min } } : {}),
        };
      case "secret":
        return { ...base, kind: "secret", set: typeof value === "string" && value !== "", placeholderSet: "••••••••", hint: [base.hint, typeof value === "string" && value !== "" ? tAll("acp.settings.secretSet") : tAll("acp.settings.secretEmpty")].filter(Boolean).join("\n") };
      default:
        return { ...base, kind: "text", value: String(value ?? ""), multiline: field.type === "textarea", maxLength: field.maxLength ?? (field.type === "text" ? 200 : 5000) };
    }
  };

  const settingTabs = (m.settings?.tabs ?? []).map((tab) => ({
    key: `s-${tab.key}`,
    label: text(tab.label),
    icon: <GcsIcon name={tab.icon ?? "fa-solid fa-sliders"} />,
    content: canEdit ? (
      <GcsChatSettingsForm rows={tab.fields.map(settingRow)} action={savePluginSettings.bind(null, key, tab.key)} labels={saveLabels} />
    ) : (
      <p className="gcs-chatAcp__hint">{t("noRight")}</p>
    ),
  }));

  const metricRows = Object.entries(metrics).sort((a, b) => b[1].count - a[1].count);
  const logTab = (
    <div className="gcs-chatAcp__body" data-testid="gcs-plugin-log">
      <h3 className="gcs-chatAcp__section">{t("timings")}</h3>
      {metricRows.length === 0 ? (
        <p className="gcs-muted">{t("noTimings")}</p>
      ) : (
        <div className="gcs-table">
          <table className="gcs-table__table">
            <thead>
              <tr>
                <th className="gcs-table__th">{t("hook")}</th>
                <th className="gcs-table__th">{t("calls")}</th>
                <th className="gcs-table__th">{t("failures")}</th>
                <th className="gcs-table__th">{t("avg")}</th>
                <th className="gcs-table__th">{t("max")}</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map(([hook, mm]) => (
                <tr key={hook} className="gcs-table__row">
                  <td className="gcs-table__td">
                    <code>{hook}</code>
                  </td>
                  <td className="gcs-table__td">{format.number(mm.count)}</td>
                  <td className="gcs-table__td">{mm.failures > 0 ? <GcsBadge tone="warn">{format.number(mm.failures)}</GcsBadge> : 0}</td>
                  <td className="gcs-table__td">{format.number(mm.count > 0 ? mm.totalMs / mm.count : 0, { maximumFractionDigits: 1 })} ms</td>
                  <td className="gcs-table__td">{format.number(mm.maxMs)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="gcs-chatAcp__section">{t("entries")}</h3>
      {logs.length === 0 ? (
        <p className="gcs-muted">{t("noLogs")}</p>
      ) : (
        <ul className="gcs-pluginLog">
          {logs.map((l) => (
            <li key={l.id} className={`gcs-pluginLog__row gcs-pluginLog__row--${l.level}`}>
              <GcsIcon name={l.level === "error" ? "fa-solid fa-circle-xmark" : l.level === "warn" ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-circle-info"} />
              <time dateTime={l.createdAt.toISOString()}>{format.dateTime(l.createdAt, { dateStyle: "short", timeStyle: "medium" })}</time>
              {l.hook && <code>{l.hook}</code>}
              <span className="gcs-pluginLog__msg">{l.message}</span>
              {l.durationMs !== null && <span className="gcs-muted">{l.durationMs} ms</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const detailsTab = (
    <div className="gcs-chatAcp__body" data-testid="gcs-plugin-details">
      <h3 className="gcs-chatAcp__section">{t("capabilities")}</h3>
      <GcsPluginCapabilities capabilities={row.capabilities} />
      <h3 className="gcs-chatAcp__section">{t("declared")}</h3>
      <GcsPluginDeclarations manifest={m} texts={texts} />
      <h3 className="gcs-chatAcp__section">{t("runtime")}</h3>
      <dl className="gcs-pluginFacts">
        <div>
          <dt>{t("process")}</dt>
          <dd>
            {runtime.loaded ? (runtime.running ? t("running") : t("loaded")) : t("notLoaded")}
            {runtime.startError && <span className="gcs-pluginRow__error"> · {runtime.startError}</span>}
          </dd>
        </div>
        {row.capabilities.includes("db") && (
          <div>
            <dt>{t("database")}</dt>
            <dd>
              <code>{pluginSchema(key)}</code> · {t("role")} <code>{row.dbRole ?? "—"}</code> · {t("migrations", { count: row.migrations.length })}
            </dd>
          </div>
        )}
        <div>
          <dt>{t("installed")}</dt>
          <dd>
            {format.dateTime(row.installedAt, { dateStyle: "medium", timeStyle: "short" })} · {t("updatedAt")} {format.dateTime(row.updatedAt, { dateStyle: "medium", timeStyle: "short" })}
          </dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd>
            <code>{row.packageSha256?.slice(0, 16) ?? "—"}</code>
          </dd>
        </div>
      </dl>
      {files.length > 0 && (
        <>
          <h3 className="gcs-chatAcp__section">{t("files", { count: files.length })}</h3>
          <ul className="gcs-pluginFiles">
            {files.map((file) => (
              <li key={file.path}>
                <GcsIcon name="fa-solid fa-file" /> <code>{file.path}</code> <span className="gcs-muted">{format.number(file.size)} B</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  const manageTab = (
    <div className="gcs-chatAcp__body" data-testid="gcs-plugin-manage">
      {canEdit && row.status === "installed" && (
        <section aria-labelledby="gcs-plugin-update">
          <h3 id="gcs-plugin-update" className="gcs-chatAcp__section">
            <GcsIcon name="fa-solid fa-arrows-rotate" /> {t("update")}
          </h3>
          <p className="gcs-chatAcp__hint">{t("updateHint", { version: row.version })}</p>
          <GcsPluginUpload
            labels={{ file: tp("upload.file"), hint: tp("upload.hint"), submit: tp("upload.submit"), uploading: tp("upload.uploading"), network: tp("upload.network") }}
          />
        </section>
      )}
      {canDelete && (
        <section aria-labelledby="gcs-plugin-uninstall">
          <h3 id="gcs-plugin-uninstall" className="gcs-chatAcp__section">
            <GcsIcon name="fa-solid fa-trash" /> {t("uninstall")}
          </h3>
          <GcsActionForm action={uninstallPlugin.bind(null, key)} submitLabel={t("uninstallSubmit")} submitKind="delete" variant="ghost" redirectTo="/admin/system/applications">
            <p className="gcs-chatAcp__hint">{t("uninstallHint")}</p>
            <label className="gcs-checkRow">
              <input type="checkbox" role="switch" name="keepData" defaultChecked />
              {t("keepData")}
            </label>
            <label className="gcs-field">
              {t("typeKey", { key })}
              <input className="gcs-input" name="confirmKey" autoComplete="off" spellCheck={false} placeholder={key} style={{ maxWidth: 320 }} />
            </label>
          </GcsActionForm>
        </section>
      )}
    </div>
  );

  return (
    <>
      <Link href="/admin/system/applications" className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>
      <GcsAcpTitle
        icon={pluginIcon(m.icon)}
        description={m.description || undefined}
        actions={row.status === "installed" ? <GcsPluginToggle pluginKey={key} enabled={row.enabled} label={tp("list.toggle", { name: row.name })} disabled={!canEdit} /> : null}
      >
        {row.name}
      </GcsAcpTitle>
      <div className="gcs-pluginRow__badges" data-testid="gcs-plugin-header">
        <GcsBadge tone={status.tone} icon={<GcsIcon name={status.icon} />} data-testid="gcs-plugin-status">
          {tp(`status.${status.key}`)}
        </GcsBadge>
        <code>{key}</code>
        <span className="gcs-muted">v{row.version}</span>
        <span className="gcs-muted">
          <GcsIcon name="fa-solid fa-user-pen" /> {pluginAuthor(row)}
        </span>
        {row.signed ? (
          <GcsBadge tone="info" icon={<GcsIcon name="fa-solid fa-certificate" />}>
            {tp("signed", { keyId: row.signatureKeyId ?? "" })}
          </GcsBadge>
        ) : (
          <GcsBadge tone="warn" icon={<GcsIcon name="fa-solid fa-unlock" />}>
            {tp("unsigned")}
          </GcsBadge>
        )}
      </div>
      {row.disabledReason === "auto" && row.lastError && (
        <div role="alert" className="gcs-pluginWarn" data-testid="gcs-plugin-auto-disabled">
          <strong>
            <GcsIcon name="fa-solid fa-triangle-exclamation" /> {t("autoDisabled", { count: row.consecutiveFailures })}
          </strong>
          <span>{row.lastError}</span>
        </div>
      )}
      <GcsCard as="section" className="gcs-chatAcp" aria-label={row.name} data-testid="gcs-plugin-detail">
        <GcsChatSettingsTabs
          label={row.name}
          tabs={[
            ...settingTabs,
            { key: "log", label: t("log"), icon: <GcsIcon name="fa-solid fa-clipboard-list" />, content: logTab },
            { key: "details", label: t("details"), icon: <GcsIcon name="fa-solid fa-circle-info" />, content: detailsTab },
            { key: "manage", label: t("manage"), icon: <GcsIcon name="fa-solid fa-screwdriver-wrench" />, content: manageTab },
          ]}
        />
      </GcsCard>
    </>
  );
}
