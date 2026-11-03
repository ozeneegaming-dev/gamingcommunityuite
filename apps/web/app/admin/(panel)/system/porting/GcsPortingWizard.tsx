"use client";

import {
  faBoxOpen,
  faCircleCheck,
  faCircleInfo,
  faCircleNotch,
  faCircleXmark,
  faClock,
  faClockRotateLeft,
  faCode,
  faCodeCompare,
  faDatabase,
  faDownload,
  faFileCode,
  faFileContract,
  faFileZipper,
  faFlagCheckered,
  faFolderOpen,
  faGear,
  faKey,
  faLanguage,
  faLayerGroup,
  faListCheck,
  faPalette,
  faPlus,
  faPuzzlePiece,
  faRoute,
  faScaleBalanced,
  faScrewdriverWrench,
  faShieldHalved,
  faTableCellsLarge,
  faTrashCan,
  faTriangleExclamation,
  faUpload,
  faUserShield,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import type { GcsPortAnalysis, GcsPortArea, GcsPortListItem, GcsPortNote, GcsPortReport, GcsPortView } from "@gcs/modules";
import { GcsButton, GcsCard, GcsField, GcsIconSvg, cx, type GcsIconSvgProps, type GcsUploadRules } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { postWithProgress } from "@/lib/upload-request";
import { useErrorMessage } from "@/lib/use-error-message";
import { convertPortAction, deletePortAction, handoffPortAction } from "./actions";

type Icon = GcsIconSvgProps["icon"];

const PATH = "/admin/system/porting";
const STEPS = ["upload", "rights", "convert", "result"] as const;
type Phase = (typeof STEPS)[number];
/** Temeiurile confirmării (aceleași ca `GCS_PORT_RIGHTS` din modul; constanta nu se importă în bundle-ul clientului). */
const BASES = ["author", "consent", "license"] as const;
const FORMATS = ["app-json", "plugin-xml", "addon-json"] as const;

const COUNT_ICONS: Record<keyof GcsPortAnalysis["counts"], Icon> = {
  files: faFolderOpen,
  settings: faGear,
  permissions: faUserShield,
  routes: faRoute,
  phrases: faLanguage,
  tables: faDatabase,
  templates: faLayerGroup,
  styles: faPalette,
  tasks: faClock,
  widgets: faTableCellsLarge,
  php: faFileCode,
  javascript: faCode,
};

const AREA_ICONS: Record<GcsPortArea, Icon> = {
  manifest: faPuzzlePiece,
  settings: faGear,
  permissions: faUserShield,
  routes: faRoute,
  phrases: faLanguage,
  schema: faDatabase,
  templates: faLayerGroup,
  styles: faPalette,
  tasks: faClock,
  widgets: faTableCellsLarge,
  code: faFileCode,
  javascript: faCode,
};

const CHECK_ICONS = { ok: faCircleCheck, warn: faTriangleExclamation, error: faCircleXmark } as const;

/** Argumentele mesajelor (notele portării, verificările pachetului): cele lipsă devin text gol, nu o eroare de formatare. */
const NOTE_ARGS = ["path", "count", "table", "column", "type", "index", "issue", "rules", "declarations", "scripts", "styles", "inline", "handlers", "max", "what"];
const CHECK_ARGS = ["path", "issue", "detail", "key", "keyId", "files", "version", "current", "count", "capability", "required", "range", "found", "installed", "reason", "max"];
const args = (names: string[], params: Record<string, string> | undefined) => ({ ...Object.fromEntries(names.map((n) => [n, ""])), ...params });

type Props = {
  /** Portarea deschisă (`?id=`), sau `null` pentru o încărcare nouă. */
  port: GcsPortView | null;
  /** `?id=` cerea o portare care nu (mai) există. */
  missing: boolean;
  recent: GcsPortListItem[];
  canEdit: boolean;
  canDelete: boolean;
  /** Mărimea maximă a arhivei (octeți) și numărul maxim de fișiere din ea. */
  maxBytes: number;
  maxFiles: number;
};

type Pending = "upload" | "convert" | "handoff" | "delete" | null;

/**
 * Asistentul de portare (designul portării, §2.2): încărcarea (analiza, fără conversie) → confirmarea dreptului de a
 * modifica și folosi pluginul (temeiul + bifa, obligatorii) → conversia → rezultatul (procentul automat, tabelul pe
 * tipuri, verificările pachetului, fișierele de portat manual, avertismentele) cu descărcarea, predarea la instalator și
 * ștergerea. Tot ce vine din arhivă e afișat ca text simplu; nimic nu se instalează sau activează de aici.
 */
export function GcsPortingWizard({ port: initial, missing, recent, canEdit, canDelete, maxBytes, maxFiles }: Props) {
  const t = useTranslations("porting");
  const tChecks = useTranslations("acp.plugins.checks");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [port, setPort] = useState<GcsPortView | null>(initial);
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(missing ? { ok: false, text: t("errors.not_found") } : null);

  /** Mesajul unei erori: codul arhivei respinse, confirmarea lipsă, cheia invalidă, conflictele, apoi mesajele generale. */
  const errorText = (error: GcsErrorPayload): string => {
    const fields = error.fields ?? {};
    const file = fields.file;
    if (file) {
      const params = { path: "", max: "", ...error.params };
      if (t.has(`errors.${file}`)) return t(`errors.${file}`, params);
      if (tChecks.has(file)) return tChecks(file, params);
    }
    if (fields.rights) return t("errors.rights_required");
    if (fields.key) return t("errors.key_invalid");
    if (fields.package) return t("errors.package_invalid");
    const reason = error.params?.reason;
    if (reason && t.has(`errors.${reason}`)) return t(`errors.${reason}`);
    if (error.code === "not_found") return t("errors.not_found");
    return errorMessage(error);
  };

  /** Rulează o acțiune: butoanele se dezactivează, eroarea apare sub asistent. */
  async function act<T>(kind: Exclude<Pending, null>, fn: () => Promise<GcsResult<T>>, onOk: (data: T) => void): Promise<void> {
    setPending(kind);
    setMessage(null);
    let result: GcsResult<T>;
    try {
      result = await fn();
    } catch {
      setPending(null);
      setMessage({ ok: false, text: t("upload.network") });
      return;
    }
    if (!result.ok) {
      setPending(null);
      setMessage({ ok: false, text: errorText(result.error) });
      return;
    }
    onOk(result.data);
  }

  /**
   * Încărcarea din popupul sistemului (tipul și mărimea verificate înainte, progresul real): eroarea serverului (arhiva
   * respinsă și motivul) rămâne în popup, ca să se poată alege alt fișier.
   */
  async function upload(file: File, onProgress: (fraction: number) => void): Promise<string | null> {
    setMessage(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await postWithProgress<{ id: string }>("/api/acp/porting/upload", fd, onProgress);
    if (!res.ok) return res.error.code === "network" ? t("upload.network") : errorText(res.error);
    setPending("upload");
    // Pagina se reîncarcă pe portarea nouă (adresa ei rămâne valabilă la un refresh).
    router.push(`${PATH}?id=${encodeURIComponent(res.data.id)}`);
    return null;
  }

  const phase: Phase = !port ? "upload" : port.status === "converted" ? "result" : pending === "convert" ? "convert" : "rights";
  const order = STEPS.indexOf(phase);

  const remove = (id: string) => {
    if (!window.confirm(t("report.deleteConfirm"))) return;
    void act(
      "delete",
      () => deletePortAction(id),
      () => {
        setPort(null);
        setPending(null);
        router.push(PATH);
      },
    );
  };

  return (
    <div className="gcs-porting" data-testid="gcs-porting">
      <ol className="gcs-import__stepper" aria-label={t("stepsLabel")} data-testid="gcs-porting-steps">
        {STEPS.map((key, i) => (
          <li
            key={key}
            className={cx("gcs-import__stepperItem", i === order && "is-current", i < order && "is-done")}
            aria-current={i === order ? "step" : undefined}
            data-step={key}
          >
            <span className="gcs-import__stepperDot" aria-hidden="true">
              {i < order ? <GcsIconSvg icon={faCircleCheck} /> : i + 1}
            </span>
            {t(`steps.${key}`)}
          </li>
        ))}
      </ol>

      {!port && <UploadPanel canEdit={canEdit} pending={pending === "upload"} maxBytes={maxBytes} maxFiles={maxFiles} onUpload={upload} />}

      {port && (
        <DetectedPanel
          port={port}
          actions={
            <>
              {canEdit && (
                <GcsButton variant="ghost" size="sm" disabled={pending !== null} onClick={() => router.push(PATH)} icon={<GcsIconSvg icon={faPlus} />} data-testid="gcs-porting-new">
                  {t("detected.newUpload")}
                </GcsButton>
              )}
              {canDelete && port.status === "analyzed" && (
                <GcsButton variant="ghost" size="sm" disabled={pending !== null} onClick={() => remove(port.id)} icon={<GcsIconSvg icon={faTrashCan} />} data-testid="gcs-porting-delete">
                  {t("report.delete")}
                </GcsButton>
              )}
            </>
          }
        />
      )}

      {port && port.status === "analyzed" && (
        <RightsPanel
          port={port}
          canEdit={canEdit}
          pending={pending === "convert"}
          onSubmit={(fd) =>
            act(
              "convert",
              () => convertPortAction(port.id, fd),
              (data) => {
                setPort(data);
                setPending(null);
                setMessage(null);
              },
            )
          }
        />
      )}

      {port && port.status === "converted" && port.report && (
        <ResultPanels
          port={port}
          report={port.report}
          canEdit={canEdit}
          canDelete={canDelete}
          pending={pending}
          onHandoff={() =>
            act(
              "handoff",
              () => handoffPortAction(port.id),
              // Ecranul de validare al instalatorului: adminul decide acolo (nimic nu se instalează de aici).
              (data) => router.push(`/admin/system/applications/install/${encodeURIComponent(data.uploadId)}`),
            )
          }
          onDelete={() => remove(port.id)}
        />
      )}

      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "gcs-import__ok" : "gcs-import__error"} data-testid="gcs-porting-message">
          <GcsIconSvg icon={message.ok ? faCircleCheck : faTriangleExclamation} />
          {message.text}
        </p>
      )}

      {!port && <RecentPanel items={recent} />}
    </div>
  );
}

function Panel({ icon, title, sub, actions, children, testId }: { icon: Icon; title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <GcsCard as="section" className="gcs-acpPanel gcs-import__panel" data-testid={testId}>
      <header className="gcs-acpPanel__head gcs-import__panelHead">
        <div>
          <h2 className="gcs-acpPanel__title">
            <GcsIconSvg icon={icon} className="gcs-acpTitle__icon" />
            {title}
          </h2>
          {sub && <p className="gcs-acpPanel__sub">{sub}</p>}
        </div>
        {actions && <div className="gcs-import__headActions">{actions}</div>}
      </header>
      <div className="gcs-acpPanel__body">{children}</div>
    </GcsCard>
  );
}

/** Ce primește `/api/acp/porting/upload`: arhivele (.zip, .tar, .tar.gz) și pluginurile într-un singur fișier XML. */
const SOURCE_TYPES = [".zip", ".tar", ".tgz", ".gz", ".xml", "application/zip", "application/x-zip-compressed", "application/x-tar", "application/gzip", "application/x-gzip", "application/xml", "text/xml"];

function UploadPanel({
  canEdit,
  pending,
  maxBytes,
  maxFiles,
  onUpload,
}: {
  canEdit: boolean;
  pending: boolean;
  maxBytes: number;
  maxFiles: number;
  onUpload: (file: File, onProgress: (fraction: number) => void) => Promise<string | null>;
}) {
  const t = useTranslations("porting");
  const format = useFormatter();
  const rules: GcsUploadRules = { accept: SOURCE_TYPES, typesLabel: "ZIP, TAR, TAR.GZ, XML", maxBytes };
  return (
    <Panel icon={faUpload} title={t("upload.title")} sub={t("upload.hint")} testId="gcs-porting-upload">
      <div className="gcs-pluginUpload">
        <GcsUploadInput title={t("upload.file")} rules={rules} upload={onUpload} disabled={!canEdit || pending} testId="gcs-porting-file" />
        <small className="gcs-muted">{t("upload.limits", { size: format.number(Math.round(maxBytes / (1024 * 1024))), files: format.number(maxFiles) })}</small>
        <p className="gcs-import__label">{t("upload.formats")}</p>
        <ul className="gcs-porting__formats">
          {FORMATS.map((f) => (
            <li key={f}>
              <strong>{t(`formats.${f}`)}</strong>
              <small>{t(`formatHints.${f}`)}</small>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function DetectedPanel({ port, actions }: { port: GcsPortView; actions: ReactNode }) {
  const t = useTranslations("porting");
  const format = useFormatter();
  const a = port.analysis;
  const m = a.meta;
  const description = m.description.length > 400 ? `${m.description.slice(0, 399)}…` : m.description;
  return (
    <Panel icon={faCodeCompare} title={t("detected.title", { format: t(`formats.${a.format}`) })} sub={m.name} actions={actions} testId="gcs-porting-detected">
      <dl className="gcs-porting__facts" data-testid="gcs-porting-facts">
        <div>
          <dt>{t("detected.name")}</dt>
          <dd data-testid="gcs-porting-name">
            <strong>{m.name}</strong>
          </dd>
        </div>
        <div>
          <dt>{t("detected.version")}</dt>
          <dd data-testid="gcs-porting-version">{m.version || "—"}</dd>
        </div>
        <div>
          <dt>{t("detected.author")}</dt>
          <dd data-testid="gcs-porting-author">{m.author || "—"}</dd>
        </div>
        {m.url && (
          <div>
            <dt>{t("detected.website")}</dt>
            <dd>
              <code>{m.url}</code>
            </dd>
          </div>
        )}
        {description && (
          <div>
            <dt>{t("detected.about")}</dt>
            <dd>{description}</dd>
          </div>
        )}
        <div>
          <dt>{t("detected.license")}</dt>
          <dd data-testid="gcs-porting-license">
            {a.license.spdx ?? t("detected.noLicense")}
            {a.license.gpl && (
              <span className="gcs-acpPill gcs-acpPill--bad" data-testid="gcs-porting-gpl-pill">
                GPL
              </span>
            )}
            {a.license.files.length > 0 && <small className="gcs-porting__muted">{t("detected.licenseFiles", { files: a.license.files.slice(0, 3).join(", ") })}</small>}
          </dd>
        </div>
        <div>
          <dt>{t("detected.file")}</dt>
          <dd>
            {port.fileName} · <code title={port.sha256}>{port.sha256.slice(0, 16)}…</code>
          </dd>
        </div>
      </dl>
      <p className="gcs-import__label">{t("detected.counts")}</p>
      <ul className="gcs-import__counts" data-testid="gcs-porting-counts">
        {(Object.keys(COUNT_ICONS) as (keyof GcsPortAnalysis["counts"])[]).map((key) => (
          <li key={key} className={cx("gcs-import__count", a.counts[key] === 0 && "gcs-porting__count--zero")} data-count={key}>
            <span className="gcs-import__countIcon" aria-hidden="true">
              <GcsIconSvg icon={COUNT_ICONS[key]} />
            </span>
            <span className="gcs-import__countValue">{format.number(a.counts[key])}</span>
            <span className="gcs-import__countLabel">{t(`counts.${key}`)}</span>
          </li>
        ))}
      </ul>
      {a.notes.length > 0 && (
        <>
          <p className="gcs-import__label">{t("detected.warnings")}</p>
          <NoteList notes={a.notes} testId="gcs-porting-analysis-notes" />
        </>
      )}
      <p className="gcs-import__hint">{t("detected.expires", { date: format.dateTime(port.expiresAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
    </Panel>
  );
}

function RightsPanel({ port, canEdit, pending, onSubmit }: { port: GcsPortView; canEdit: boolean; pending: boolean; onSubmit: (fd: FormData) => void }) {
  const t = useTranslations("porting");
  const [basis, setBasis] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const ready = basis !== "" && confirmed;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ready || pending) return;
    onSubmit(new FormData(e.currentTarget));
  };
  return (
    <Panel icon={faScaleBalanced} title={t("rights.title")} sub={t("rights.hint")} testId="gcs-porting-rights">
      <form onSubmit={submit} className="gcs-import__form" noValidate>
        {port.analysis.license.gpl && (
          <div role="alert" className="gcs-pluginWarn gcs-porting__gpl" data-testid="gcs-porting-gpl">
            <strong>
              <GcsIconSvg icon={faTriangleExclamation} /> {t("rights.gplTitle")}
            </strong>
            <span>{t("rights.gplBody")}</span>
          </div>
        )}
        <fieldset className="gcs-import__fieldset" disabled={!canEdit || pending}>
          <legend className="gcs-field__label">{t("rights.basis")}</legend>
          <div className="gcs-porting__bases" role="radiogroup" aria-label={t("rights.basis")}>
            {BASES.map((b) => (
              <label key={b} className={cx("gcs-import__choice", basis === b && "is-selected")}>
                <input type="radio" name="basis" value={b} checked={basis === b} onChange={() => setBasis(b)} data-testid={`gcs-porting-basis-${b}`} />
                {t(`rights.bases.${b}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="gcs-porting__notice">
          <GcsIconSvg icon={faCircleInfo} />
          <span>{t("rights.purchased")}</span>
        </p>
        <GcsField label={t("rights.key")} hint={t("rights.keyHint")}>
          <input
            name="key"
            defaultValue={port.analysis.suggestedKey}
            placeholder={port.analysis.suggestedKey}
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            disabled={!canEdit || pending}
            className="gcs-porting__key"
            data-testid="gcs-porting-key"
          />
        </GcsField>
        <label className={cx("gcs-porting__confirm", confirmed && "is-checked")}>
          <input type="checkbox" name="confirmed" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!canEdit || pending} data-testid="gcs-porting-confirm" />
          <span>
            <GcsIconSvg icon={faKey} /> {t("rights.confirm")}
          </span>
        </label>
        {canEdit ? (
          <div className="gcs-acpForm__actions gcs-import__actions">
            <GcsButton
              variant="primary"
              type="submit"
              disabled={!ready || pending}
              icon={<GcsIconSvg icon={pending ? faCircleNotch : faWandMagicSparkles} className={pending ? "gcs-import__spin" : undefined} />}
              data-testid="gcs-porting-convert"
            >
              {pending ? t("rights.converting") : t("rights.submit")}
            </GcsButton>
            {!ready && <span className="gcs-porting__muted">{t("rights.needsConfirm")}</span>}
          </div>
        ) : (
          <p className="gcs-import__hint">{t("rights.readOnly")}</p>
        )}
      </form>
    </Panel>
  );
}

function ResultPanels({
  port,
  report,
  canEdit,
  canDelete,
  pending,
  onHandoff,
  onDelete,
}: {
  port: GcsPortView;
  report: GcsPortReport;
  canEdit: boolean;
  canDelete: boolean;
  pending: Pending;
  onHandoff: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("porting");
  const tChecks = useTranslations("acp.plugins.checks");
  const format = useFormatter();
  const percent = Math.max(0, Math.min(100, Math.round(report.automatedPercent)));
  const valid = report.validation.ok;
  const rights = port.rights;
  const checkText = (c: GcsPortReport["validation"]["checks"][number]) =>
    tChecks.has(c.code) ? tChecks(c.code, args(CHECK_ARGS, c.params)) : `${c.code}${c.params ? ` ${JSON.stringify(c.params)}` : ""}`;
  const validPill = (
    <span className={cx("gcs-acpPill", valid ? "gcs-acpPill--good" : "gcs-acpPill--bad")} data-testid="gcs-porting-valid">
      <GcsIconSvg icon={valid ? faCircleCheck : faCircleXmark} />
      {valid ? t("checks.ok") : t("checks.failed")}
    </span>
  );
  return (
    <>
      <Panel
        icon={faFlagCheckered}
        title={t("report.title")}
        sub={t("report.subtitle", { name: report.plugin.name, key: report.plugin.key, version: report.plugin.version })}
        actions={validPill}
        testId="gcs-porting-report"
      >
        <div className="gcs-porting__summary">
          <div className="gcs-porting__percent" data-testid="gcs-porting-percent" data-percent={percent}>
            <strong>{format.number(percent / 100, { style: "percent" })}</strong>
            <span>{t("report.percentLabel")}</span>
            <span className="gcs-acpKpi__bar gcs-porting__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("report.percentLabel")}>
              <span style={{ width: `${percent}%` }} />
            </span>
          </div>
          <ul className="gcs-porting__meta">
            {rights && (
              <li data-testid="gcs-porting-rights-confirmed">
                <GcsIconSvg icon={faScaleBalanced} />
                {t("report.rights", { basis: t(`rights.bases.${rights.basis}`), date: format.dateTime(rights.confirmedAt, { dateStyle: "medium", timeStyle: "short" }) })}
              </li>
            )}
            <li>
              <GcsIconSvg icon={faFileContract} />
              {t("report.todos", { count: format.number(report.todos) })}
            </li>
            {port.resultSize !== null && (
              <li>
                <GcsIconSvg icon={faFileZipper} />
                {t("report.size", { size: format.number(port.resultSize / 1024, { maximumFractionDigits: 1 }) })}
              </li>
            )}
          </ul>
        </div>
        <p className="gcs-import__hint">{t("report.percentHint")}</p>

        <p className="gcs-import__label gcs-porting__spaced">{t("report.areas")}</p>
        <div className="gcs-import__tableWrap">
          <table className="gcs-import__table" data-testid="gcs-porting-areas">
            <thead>
              <tr>
                <th scope="col">{t("report.area")}</th>
                <th scope="col">{t("report.auto")}</th>
                <th scope="col">{t("report.manual")}</th>
              </tr>
            </thead>
            <tbody>
              {report.areas.map((a) => (
                <tr key={a.area} data-area={a.area}>
                  <th scope="row">
                    <GcsIconSvg icon={AREA_ICONS[a.area] ?? faListCheck} />
                    {t.has(`areas.${a.area}`) ? t(`areas.${a.area}`) : a.area}
                  </th>
                  <td className={a.auto > 0 ? "is-good" : undefined} data-col="auto">
                    {format.number(a.auto)}
                  </td>
                  <td className={a.manual > 0 ? "is-warn" : undefined} data-col="manual">
                    {format.number(a.manual)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="gcs-porting__safe" data-testid="gcs-porting-safe">
          <GcsIconSvg icon={faShieldHalved} />
          <span>{t("report.nothingInstalled")}</span>
        </p>
        <p className="gcs-import__hint">{t("report.contents", { file: report.plugin.fileName })}</p>

        <div className="gcs-acpForm__actions gcs-import__actions">
          <GcsButton variant="primary" asChild icon={<GcsIconSvg icon={faDownload} />}>
            <a href={`/admin/porting-result.zip?id=${encodeURIComponent(port.id)}`} download data-testid="gcs-porting-download">
              {t("report.download")}
            </a>
          </GcsButton>
          {canEdit && (
            <GcsButton
              variant="ghost"
              disabled={!port.canHandoff || pending !== null}
              onClick={onHandoff}
              icon={<GcsIconSvg icon={pending === "handoff" ? faCircleNotch : faBoxOpen} className={pending === "handoff" ? "gcs-import__spin" : undefined} />}
              data-testid="gcs-porting-handoff"
            >
              {pending === "handoff" ? t("report.handing") : t("report.handoff")}
            </GcsButton>
          )}
          {canDelete && (
            <GcsButton variant="ghost" disabled={pending !== null} onClick={onDelete} icon={<GcsIconSvg icon={faTrashCan} />} data-testid="gcs-porting-delete">
              {t("report.delete")}
            </GcsButton>
          )}
        </div>
        {canEdit && <p className={port.canHandoff ? "gcs-import__hint" : "gcs-import__error gcs-porting__blocked"}>{port.canHandoff ? t("report.handoffHint") : t("report.handoffBlocked")}</p>}
      </Panel>

      <div className="gcs-import__columns">
        <Panel icon={faListCheck} title={t("checks.title")} sub={t("checks.hint")} actions={validPill} testId="gcs-porting-checks">
          <ul className="gcs-pluginChecks gcs-porting__checks">
            {report.validation.checks.map((c, i) => (
              <li key={i} className={`gcs-pluginChecks__item gcs-pluginChecks__item--${c.level}`} data-level={c.level} data-code={c.code}>
                <GcsIconSvg icon={CHECK_ICONS[c.level]} />
                <span>{checkText(c)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel icon={faTriangleExclamation} title={t("notes.title")} testId="gcs-porting-notes">
          {report.notes.length > 0 ? <NoteList notes={report.notes} /> : <p className="gcs-import__hint">{t("notes.none")}</p>}
        </Panel>
      </div>

      <Panel icon={faScrewdriverWrench} title={t("manual.title")} sub={t("manual.hint")} testId="gcs-porting-manual">
        {report.manual.length === 0 ? (
          <p className="gcs-import__hint">{t("manual.none")}</p>
        ) : (
          <div className="gcs-import__tableWrap">
            <table className="gcs-import__table gcs-porting__manual">
              <thead>
                <tr>
                  <th scope="col">{t("manual.file")}</th>
                  <th scope="col">{t("manual.kind")}</th>
                  <th scope="col">{t("manual.lines")}</th>
                  <th scope="col">{t("manual.equivalent")}</th>
                </tr>
              </thead>
              <tbody>
                {report.manual.map((m) => (
                  <tr key={m.path} data-kind={m.kind}>
                    <th scope="row">
                      <code>{m.path}</code>
                    </th>
                    <td>{t.has(`kinds.${m.kind}`) ? t(`kinds.${m.kind}`) : m.kind}</td>
                    <td>{format.number(m.lines)}</td>
                    <td>{t.has(`equivalents.${m.kind}`) ? t(`equivalents.${m.kind}`) : m.suggestion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function NoteList({ notes, testId }: { notes: GcsPortNote[]; testId?: string }) {
  const t = useTranslations("porting");
  return (
    <ul className="gcs-import__logs gcs-porting__notes" data-testid={testId}>
      {notes.map((n, i) => (
        <li key={i} className="gcs-import__log is-warn" data-code={n.code}>
          <GcsIconSvg icon={faTriangleExclamation} />
          <span>{t.has(`notes.${n.code}`) ? t(`notes.${n.code}`, args(NOTE_ARGS, n.params)) : n.code}</span>
        </li>
      ))}
    </ul>
  );
}

function RecentPanel({ items }: { items: GcsPortListItem[] }) {
  const t = useTranslations("porting");
  const format = useFormatter();
  return (
    <Panel icon={faClockRotateLeft} title={t("recent.title")} sub={t("recent.hint")} testId="gcs-porting-recent">
      {items.length === 0 ? (
        <p className="gcs-import__hint">{t("recent.empty")}</p>
      ) : (
        <ul className="gcs-porting__recent">
          {items.map((p) => (
            <li key={p.id} data-status={p.status}>
              <span className="gcs-porting__recentMain">
                <strong>{p.sourceName || p.fileName}</strong>
                <small>
                  {t(`formats.${p.format}`)} · {p.fileName}
                  {p.pluginKey && (
                    <>
                      {" · "}
                      <code>{p.pluginKey}</code>
                    </>
                  )}
                  {" · "}
                  {format.dateTime(p.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                </small>
              </span>
              <span className={cx("gcs-acpPill", p.status === "converted" ? "gcs-acpPill--good" : "gcs-acpPill--flat")}>
                {p.status === "converted" && p.automatedPercent !== null ? t("recent.percent", { percent: String(p.automatedPercent) }) : t(`recent.${p.status}`)}
              </span>
              <Link href={`${PATH}?id=${encodeURIComponent(p.id)}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm">
                {t("recent.open")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
