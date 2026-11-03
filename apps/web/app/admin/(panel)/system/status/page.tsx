import { faBell } from "@fortawesome/free-solid-svg-icons";
import { STATUS_ACP_SECTION, type GcsSystemStatus } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GCS_APP_VERSION } from "@/lib/system-info";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { runJobNow, saveStatusAlerts } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.status"))("title") };
}

type Level = "ok" | "warn" | "down" | "off";

/**
 * ACP › Sistem › Stare sistem: serviciile (bază de date, stocarea cheilor, worker, timp real, cron Lite, email, fișiere,
 * traduceri), serverul (versiuni, memorie, disc) și joburile programate cu ultima rulare, durata și eroarea; „Rulează
 * acum” pe fiecare job repetabil. Panoul „Alerte” alege ce se anunță administratorilor (clopoțel + email).
 */
export default async function AcpSystemStatusPage() {
  const panel = await requireAcpSection(STATUS_ACP_SECTION);
  const { systemStatus, acp } = services();
  const [t, format, s, alerts, canEdit] = await Promise.all([
    getTranslations("acp.status"),
    getFormatter(),
    systemStatus.snapshot(),
    systemStatus.alerts(),
    acp.can(panel.actor, STATUS_ACP_SECTION, "edit"),
  ]);

  const ago = (at: number | Date | null) => (at === null ? t("never") : format.relativeTime(at instanceof Date ? at : new Date(at), s.checkedAt));
  const bytes = (n: number) => (n >= 1e9 ? `${format.number(n / 1e9, { maximumFractionDigits: 1 })} GB` : `${format.number(n / 1e6, { maximumFractionDigits: 0 })} MB`);
  const freePct = s.server.disk ? Math.round((s.server.disk.free / s.server.disk.total) * 1000) / 10 : null;
  const diskLevel: Level = freePct === null ? "off" : freePct < alerts.diskMinFreePct ? "down" : freePct < alerts.diskMinFreePct * 2 ? "warn" : "ok";

  const services_: { key: string; icon: string; level: Level; detail: ReactNode; href?: string }[] = [
    { key: "db", icon: "fa-solid fa-database", level: s.db.ok ? "ok" : "down", detail: t(`engines.${s.db.engine}`) + (s.db.version ? ` ${s.db.version}` : "") + (s.db.latencyMs !== null ? ` · ${s.db.latencyMs} ms` : "") },
    { key: "kv", icon: "fa-solid fa-layer-group", level: s.kv.ok ? "ok" : "down", detail: t(`kvDrivers.${s.kv.driver}`) + (s.kv.latencyMs !== null ? ` · ${s.kv.latencyMs} ms` : "") },
    { key: "worker", icon: "fa-solid fa-gears", level: s.worker.up ? "ok" : "down", detail: t("lastBeat", { when: ago(s.worker.lastBeatAt) }) },
    { key: "realtime", icon: "fa-solid fa-tower-broadcast", level: s.realtime.up ? "ok" : "warn", detail: s.edition === "lite" ? t("realtimeLite") : t("lastBeat", { when: ago(s.realtime.lastBeatAt) }) },
    ...(s.cron ? [{ key: "cron", icon: "fa-solid fa-clock", level: (s.cron.stale ? "down" : "ok") as Level, detail: t("cronLast", { when: ago(s.cron.lastRunAt) }), href: "/admin/system/cron" }] : []),
    { key: "email", icon: "fa-solid fa-envelope", level: s.email.configured ? "ok" : "warn", detail: s.email.configured ? t("emailOn") : t("emailOff"), href: "/admin/settings/email" },
    { key: "storage", icon: "fa-solid fa-folder-open", level: "ok", detail: t(`storageDrivers.${s.storage.driver}`), href: "/admin/system/files" },
    { key: "translate", icon: "fa-solid fa-language", level: s.translate.provider === "off" ? "off" : "ok", detail: t.has(`providers.${s.translate.provider}`) ? t(`providers.${s.translate.provider}`) : s.translate.provider, href: "/admin/settings/languages" },
  ];
  const problems = services_.filter((x) => x.level === "down").length + s.jobs.filter((j) => j.failing).length + (diskLevel === "down" ? 1 : 0);

  const chip = (level: Level) => (
    <span className={`gcs-sysChip gcs-sysChip--${level}`} data-level={level}>
      <GcsIcon name={level === "ok" ? "fa-solid fa-circle-check" : level === "warn" ? "fa-solid fa-triangle-exclamation" : level === "down" ? "fa-solid fa-circle-xmark" : "fa-solid fa-circle-minus"} />
      {t(`levels.${level}`)}
    </span>
  );
  const interval = (j: GcsSystemStatus["jobs"][number]) => {
    if (j.pattern) return t("cron", { pattern: j.pattern });
    if (!j.everyMs) return t("onDemand");
    const min = Math.round(j.everyMs / 60_000);
    return min >= 1440 && min % 1440 === 0 ? t("everyDays", { n: min / 1440 }) : min >= 60 && min % 60 === 0 ? t("everyHours", { n: min / 60 }) : t("everyMinutes", { n: Math.max(1, min) });
  };
  const jobLabel = (name: string) => (t.has(`jobs.${name.replace(/\./g, "_")}`) ? t(`jobs.${name.replace(/\./g, "_")}`) : null);

  const alertsForm = (
    <GcsActionForm action={saveStatusAlerts} submitLabel={t("save")} submitKind="save">
      <fieldset className="gcs-formSec">
        <legend>{t("alerts.secGeneral")}</legend>
        <label className="gcs-toggleRow">
          <span>
            {t("alerts.enabled")}
            <small className="gcs-achHint">{t("alerts.enabledHint")}</small>
          </span>
          <input type="checkbox" name="enabled" defaultChecked={alerts.enabled} />
        </label>
        <label className="gcs-field">
          {t("alerts.repeatHours")}
          <input className="gcs-input" type="number" name="repeatHours" min={1} max={168} defaultValue={alerts.repeatHours} required />
          <span className="gcs-field__hint">{t("alerts.repeatHint")}</span>
        </label>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("alerts.secChecks")}</legend>
        <label className="gcs-toggleRow">
          <span>
            {t("alerts.disk")}
            <small className="gcs-achHint">{t("alerts.diskHint")}</small>
          </span>
          <input type="checkbox" name="disk" defaultChecked={alerts.disk} />
        </label>
        <label className="gcs-field">
          {t("alerts.diskMinFreePct")}
          <input className="gcs-input" type="number" name="diskMinFreePct" min={1} max={50} defaultValue={alerts.diskMinFreePct} required />
        </label>
        <label className="gcs-toggleRow">
          <span>
            {t("alerts.jobs")}
            <small className="gcs-achHint">{t("alerts.jobsHint")}</small>
          </span>
          <input type="checkbox" name="jobs" defaultChecked={alerts.jobs} />
        </label>
      </fieldset>
    </GcsActionForm>
  );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-heart-pulse"
        description={t("description")}
        actions={
          <>
            <Link href="/admin/system/status" className="gcs-btn gcs-btn--ghost" data-testid="gcs-status-refresh">
              <GcsIcon name="fa-solid fa-rotate" className="gcs-btn__icon" />
              {t("refresh")}
            </Link>
            {canEdit && (
              <GcsAcpEditPanel label={t("alerts.title")} variant="primary" buttonIcon={<GcsIconSvg icon={faBell} />} title={t("alerts.title")} titleIcon={<GcsIconSvg icon={faBell} />} testId="gcs-status-alerts">
                {alertsForm}
              </GcsAcpEditPanel>
            )}
          </>
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <div className={`gcs-sysSummary gcs-sysSummary--${problems === 0 ? "ok" : "down"}`} data-testid="gcs-status-summary" role="status">
        <GcsIcon name={problems === 0 ? "fa-solid fa-circle-check" : "fa-solid fa-triangle-exclamation"} />
        <span>
          <strong>{problems === 0 ? t("allOk") : t("problems", { count: problems })}</strong>
          <small>{t("checkedAt", { time: format.dateTime(new Date(s.checkedAt), { timeStyle: "medium" }) })}</small>
        </span>
        <span className="gcs-sysSummary__alerts" data-testid="gcs-status-alerts-summary">
          <GcsIcon name={alerts.enabled ? "fa-solid fa-bell" : "fa-solid fa-bell-slash"} />
          {alerts.enabled ? t("alerts.summaryOn", { pct: alerts.diskMinFreePct, hours: alerts.repeatHours }) : t("alerts.summaryOff")}
        </span>
      </div>

      <div className="gcs-sysGrid">
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-sys-services">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-sys-services" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-server" /> {t("services")}
            </h2>
          </div>
          <ul className="gcs-sysList" data-testid="gcs-status-services">
            {services_.map((x) => (
              <li key={x.key} className="gcs-sysList__row" data-service={x.key}>
                <span className="gcs-sysList__icon" aria-hidden="true">
                  <GcsIcon name={x.icon} />
                </span>
                <span className="gcs-sysList__body">
                  <strong>{x.href ? <Link href={x.href}>{t(`names.${x.key}`)}</Link> : t(`names.${x.key}`)}</strong>
                  <small>{x.detail}</small>
                </span>
                {chip(x.level)}
              </li>
            ))}
          </ul>
        </GcsCard>

        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-sys-server">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-sys-server" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-microchip" /> {t("server")}
            </h2>
          </div>
          <dl className="gcs-sysFacts" data-testid="gcs-status-server">
            <div>
              <dt>{t("facts.version")}</dt>
              <dd>
                {GCS_APP_VERSION} · {t(`editions.${s.edition}`)}
              </dd>
            </div>
            <div>
              <dt>{t("facts.node")}</dt>
              <dd>{s.server.node}</dd>
            </div>
            <div>
              <dt>{t("facts.platform")}</dt>
              <dd>
                {s.server.platform} / {s.server.arch}
              </dd>
            </div>
            <div>
              <dt>{t("facts.uptime")}</dt>
              <dd>{format.relativeTime(new Date(s.checkedAt - s.server.uptimeSec * 1000), s.checkedAt)}</dd>
            </div>
            <div>
              <dt>{t("facts.memory")}</dt>
              <dd>{t("memoryValue", { rss: bytes(s.server.rss), heap: bytes(s.server.heapUsed) })}</dd>
            </div>
            <div>
              <dt>{t("facts.timezone")}</dt>
              <dd>{s.server.timezone}</dd>
            </div>
            <div className="gcs-sysFacts__wide">
              <dt>{t("facts.disk")}</dt>
              <dd>
                {s.server.disk ? (
                  <span className="gcs-sysDisk" data-level={diskLevel}>
                    <span className="gcs-sysDisk__bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, 100 - (freePct ?? 0))}%` }} />
                    </span>
                    {t("diskValue", { free: bytes(s.server.disk.free), total: bytes(s.server.disk.total), pct: freePct ?? 0 })}
                  </span>
                ) : (
                  t("diskUnknown")
                )}
              </dd>
            </div>
          </dl>
        </GcsCard>
      </div>

      <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-sys-jobs">
        <div className="gcs-acpPanel__head">
          <h2 id="gcs-sys-jobs" className="gcs-acpPanel__title">
            <GcsIcon name="fa-solid fa-list-check" /> {t("jobsTitle")}
          </h2>
          <span className="gcs-sysMuted">{t("jobsCount", { count: s.jobs.length })}</span>
        </div>
        <div className="gcs-memberList__scroll">
          <table className="gcs-table__table gcs-sysJobs" data-testid="gcs-status-jobs">
            <caption className="gcs-srOnly">{t("jobsTitle")}</caption>
            <thead>
              <tr>
                <th className="gcs-table__th" scope="col">{t("col.job")}</th>
                <th className="gcs-table__th" scope="col">{t("col.interval")}</th>
                <th className="gcs-table__th" scope="col">{t("col.last")}</th>
                <th className="gcs-table__th" scope="col">{t("col.duration")}</th>
                <th className="gcs-table__th" scope="col">{t("col.state")}</th>
                <th className="gcs-table__th" scope="col">
                  <span className="gcs-srOnly">{t("col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {s.jobs.map((j) => {
                const level: Level = j.failing ? "down" : j.stat ? "ok" : "off";
                const label = jobLabel(j.name);
                return (
                  <tr key={j.name} className="gcs-table__row" data-job={j.name} data-testid="gcs-status-job">
                    <td className="gcs-table__td">
                      <span className="gcs-sysJob">
                        <strong>{label ?? j.name}</strong>
                        {label && <code>{j.name}</code>}
                        {j.failing && j.stat?.lastError && (
                          <small className="gcs-sysJob__error" title={j.stat.lastError}>
                            {j.stat.lastError}
                          </small>
                        )}
                      </span>
                    </td>
                    <td className="gcs-table__td">{interval(j)}</td>
                    <td className="gcs-table__td">{j.stat ? ago(j.stat.lastStartAt) : t("never")}</td>
                    <td className="gcs-table__td gcs-memberTable__num">{j.stat ? t("ms", { ms: format.number(j.stat.durationMs) }) : "—"}</td>
                    <td className="gcs-table__td">
                      {chip(level)}
                      {j.stat && j.stat.failures > 0 && <small className="gcs-sysMuted"> {t("failures", { count: j.stat.failures, runs: j.stat.runs })}</small>}
                    </td>
                    <td className="gcs-table__td gcs-sysJobs__actions">
                      {canEdit && (j.everyMs || j.pattern) && (
                        <GcsActionForm action={runJobNow.bind(null, j.name)} submitLabel={t("runNow")} submitKind="recompute" variant="ghost" compact>
                          {null}
                        </GcsActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </GcsCard>
    </>
  );
}
