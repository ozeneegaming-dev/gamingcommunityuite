"use client";

import {
  faArrowRight,
  faCircleCheck,
  faCircleNotch,
  faCircleXmark,
  faClock,
  faCommentDots,
  faComments,
  faDatabase,
  faEnvelope,
  faFaceSmile,
  faFileCsv,
  faFlagCheckered,
  faFlask,
  faFolderOpen,
  faForwardStep,
  faGlobe,
  faIdCard,
  faKey,
  faLayerGroup,
  faListCheck,
  faMagnifyingGlass,
  faMessage,
  faPaperclip,
  faPause,
  faPen,
  faPlay,
  faPlug,
  faPlus,
  faRotate,
  faRoute,
  faStop,
  faTag,
  faTriangleExclamation,
  faUserGroup,
  faUserPlus,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import type { GcsImportLogView, GcsImportStepState, GcsImportView, GcsRedirectConfig } from "@gcs/modules";
import { GcsButton, GcsCard, GcsField, GcsIconSvg, cx, type GcsIconSvgProps } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  checkImportRedirectAction,
  controlImportAction,
  deleteImportAction,
  deleteImportCredentialsAction,
  importStatusAction,
  saveAndTestImportAction,
  setImportRedirectsAction,
  startImportAction,
  type GcsImportState,
} from "./actions";

type Icon = GcsIconSvgProps["icon"];

/** Opțiunile bifabile (aceleași ca `GCS_IMPORT_OPTIONS` din modul; grupurile și membrii se importă mereu). */
const OPTIONS = ["profile_fields", "forums", "attachments", "reactions", "conversations", "follows", "warnings", "statuses"] as const;

const ENTITY_ICONS: Record<string, Icon> = {
  groups: faUserGroup,
  members: faUsers,
  profile_fields: faIdCard,
  forums: faComments,
  prefixes: faTag,
  topics: faLayerGroup,
  attachments: faPaperclip,
  posts: faMessage,
  reactions: faFaceSmile,
  conversations: faEnvelope,
  follows: faUserPlus,
  warnings: faTriangleExclamation,
  statuses: faCommentDots,
  finalize: faFlagCheckered,
};

const STEP_ICONS: Record<GcsImportStepState["status"], Icon> = {
  pending: faClock,
  running: faCircleNotch,
  done: faCircleCheck,
  skipped: faForwardStep,
  failed: faCircleXmark,
};

const ACTIVE = new Set(["QUEUED", "RUNNING"]);
const TERMINAL = new Set(["DONE", "CANCELLED", "FAILED"]);

type Props = {
  initial: GcsImportState;
  redirects: GcsRedirectConfig;
  samples: { from: string; to: string | null }[];
  canEdit: boolean;
  canDelete: boolean;
};

const fmt = (n: number) => n.toLocaleString("ro-RO");

/**
 * Asistentul de import (specul importului, §9): conexiunea → opțiunile → importul (progres live, pauză, reluare,
 * anulare) → raportul și redirecturile. Starea se actualizează prin polling cât timp worker-ul rulează.
 */
export function GcsImportWizard({ initial, redirects, samples, canEdit, canDelete }: Props) {
  const t = useTranslations("importer");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const [state, setState] = useState<GcsImportState>(initial);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [speed, setSpeed] = useState<number | null>(null);
  const last = useRef<{ done: number; at: number } | null>(null);
  const job = state.job;
  const status = job?.status ?? "DRAFT";

  const errorText = (result: Extract<GcsResult<unknown>, { ok: false }>) => {
    const reason = result.error.params?.reason;
    if (reason && t.has(`reasons.${reason}`)) return t(`reasons.${reason}`);
    if (reason && tErr.has(`reasons.${reason}`)) return tErr(`reasons.${reason}`);
    // Erorile de validare: câmpul și motivul, pe fiecare câmp.
    const fields = Object.entries(result.error.fields ?? {});
    if (fields.length > 0) {
      return fields
        .map(([name, code]) => `${t.has(`connection.${name}`) ? t(`connection.${name}`) : name}: ${t.has(`fields.${code}`) ? t(`fields.${code}`) : code}`)
        .join(" · ");
    }
    return tErr.has(result.error.code) ? tErr(result.error.code) : result.error.code;
  };

  /** Eroarea testului de conexiune (codul salvat pe import). */
  const connectionError = (code: string) => {
    if (code.startsWith("mysql:")) return t("errors.mysql", { code: code.slice(6) });
    return t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic", { code });
  };

  /** Rulează o acțiune: butoanele se dezactivează, eroarea apare sub ele. */
  async function act<T>(fn: () => Promise<GcsResult<T>>, onOk: (data: T) => void): Promise<void> {
    setPending(true);
    setMessage(null);
    const result = await fn();
    setPending(false);
    if (!result.ok) {
      setMessage({ ok: false, text: errorText(result) });
      return;
    }
    onOk(result.data);
  }

  // Polling cât timp importul e în coadă sau rulează (sau o pauză/anulare cerută încă nu s-a aplicat).
  useEffect(() => {
    if (!job || !(ACTIVE.has(job.status) || (job.status === "PAUSED" && job.control))) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const result = await importStatusAction(job.id);
      if (stopped || !result.ok) return;
      const done = (result.data.job?.steps ?? []).reduce((sum, s) => sum + s.done, 0);
      const now = Date.now();
      if (last.current && now > last.current.at) setSpeed(Math.max(0, Math.round(((done - last.current.done) * 1000) / (now - last.current.at))));
      last.current = { done, at: now };
      setState(result.data);
      if (result.data.job && TERMINAL.has(result.data.job.status)) router.refresh();
    }, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.status, job?.control, router]);

  const phase: "connection" | "options" | "run" | "report" =
    !job || status === "DRAFT" || editing ? "connection" : status === "READY" ? "options" : ACTIVE.has(status) || status === "PAUSED" ? "run" : "report";

  return (
    <div className="gcs-import" data-testid="gcs-import">
      <ol className="gcs-import__stepper" aria-label={t("stepsLabel")}>
        {(["connection", "options", "run", "report"] as const).map((key, i) => {
          const order = ["connection", "options", "run", "report"].indexOf(phase);
          return (
            <li key={key} className={cx("gcs-import__stepperItem", i === order && "is-current", i < order && "is-done")} aria-current={i === order ? "step" : undefined}>
              <span className="gcs-import__stepperDot" aria-hidden="true">
                {i < order ? <GcsIconSvg icon={faCircleCheck} /> : i + 1}
              </span>
              {t(`steps.${key}`)}
            </li>
          );
        })}
      </ol>

      {phase === "connection" && (
        <ConnectionForm
          job={job}
          canEdit={canEdit}
          pending={pending}
          onSubmit={(fd) =>
            act(
              () => saveAndTestImportAction(fd),
              (data) => {
                setState({ job: data, logs: [], errors: [] });
                setEditing(false);
                if (data.error) setMessage({ ok: false, text: connectionError(data.error) });
              },
            )
          }
          onCancel={job && status !== "DRAFT" ? () => setEditing(false) : undefined}
        />
      )}

      {job?.detected && phase !== "connection" && (
        <DetectedPanel job={job} onEdit={canEdit && !ACTIVE.has(status) ? () => setEditing(true) : undefined} />
      )}
      {job?.detected && phase === "connection" && status === "DRAFT" && <DetectedPanel job={job} />}

      {phase === "options" && job && (
        <OptionsPanel
          job={job}
          canEdit={canEdit}
          pending={pending}
          onStart={(opts) =>
            act(
              () => startImportAction(job.id, opts),
              (data) => {
                last.current = null;
                setSpeed(null);
                setState({ job: data, logs: [], errors: [] });
              },
            )
          }
        />
      )}

      {phase === "run" && job && (
        <ProgressPanel
          job={job}
          logs={state.logs}
          errors={state.errors}
          speed={speed}
          canEdit={canEdit}
          pending={pending}
          onControl={(action) => {
            if (action === "cancel" && !window.confirm(t("progress.cancelConfirm"))) return;
            void act(() => controlImportAction(job.id, action), (data) => setState((s) => ({ ...s, job: data })));
          }}
        />
      )}

      {phase === "report" && job && (
        <>
          <ReportPanel
            job={job}
            errors={state.errors}
            canEdit={canEdit}
            canDelete={canDelete}
            pending={pending}
            onStart={(opts) =>
              act(
                () => startImportAction(job.id, opts),
                (data) => {
                  last.current = null;
                  setSpeed(null);
                  setState({ job: data, logs: [], errors: [] });
                },
              )
            }
            onResume={() => act(() => controlImportAction(job.id, "resume"), (data) => setState((s) => ({ ...s, job: data })))}
            onDeleteCredentials={() =>
              act(
                () => deleteImportCredentialsAction(job.id),
                (data) => {
                  setState((s) => ({ ...s, job: data }));
                  setMessage({ ok: true, text: t("report.credentialsDeleted") });
                },
              )
            }
            onDelete={() => {
              if (!window.confirm(t("report.deleteConfirm"))) return;
              void act(
                () => deleteImportAction(job.id),
                () => {
                  setState({ job: null, logs: [], errors: [] });
                  router.refresh();
                },
              );
            }}
          />
          {!job.dryRun && <RedirectsPanel job={job} config={redirects} samples={samples} canEdit={canEdit} onChanged={() => router.refresh()} />}
        </>
      )}

      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "gcs-import__ok" : "gcs-import__error"} data-testid="gcs-import-message">
          <GcsIconSvg icon={message.ok ? faCircleCheck : faTriangleExclamation} />
          {message.text}
        </p>
      )}
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

function ConnectionForm({ job, canEdit, pending, onSubmit, onCancel }: { job: GcsImportView | null; canEdit: boolean; pending: boolean; onSubmit: (fd: FormData) => void; onCancel?: () => void }) {
  const t = useTranslations("importer");
  const c = job?.config;
  const [mode, setMode] = useState<"none" | "folder" | "url">(c?.filesMode ?? "none");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  };
  return (
    <Panel icon={faDatabase} title={t("connection.title")} sub={t("connection.hint")} testId="gcs-import-form">
      <form onSubmit={submit} className="gcs-import__form" noValidate>
        {job && <input type="hidden" name="id" value={job.id} />}
        <div className="gcs-import__grid">
          <GcsField label={t("connection.host")}>
            <input name="host" defaultValue={c?.host ?? "localhost"} autoComplete="off" required disabled={!canEdit} />
          </GcsField>
          <GcsField label={t("connection.port")}>
            <input name="port" type="number" inputMode="numeric" min={1} max={65535} defaultValue={c?.port ?? 3306} required disabled={!canEdit} />
          </GcsField>
          <GcsField label={t("connection.database")}>
            <input name="database" defaultValue={c?.database ?? ""} autoComplete="off" required disabled={!canEdit} />
          </GcsField>
          <GcsField label={t("connection.user")}>
            <input name="user" defaultValue={c?.user ?? ""} autoComplete="off" disabled={!canEdit} />
          </GcsField>
          <GcsField label={t("connection.password")} hint={job?.hasPassword ? t("connection.passwordSet") : undefined}>
            <input name="password" type="password" autoComplete="new-password" disabled={!canEdit} />
          </GcsField>
          <GcsField label={t("connection.prefix")} hint={t("connection.prefixHint")}>
            <input name="prefix" defaultValue={c?.prefix ?? ""} autoComplete="off" disabled={!canEdit} />
          </GcsField>
        </div>
        <fieldset className="gcs-import__fieldset" disabled={!canEdit}>
          <legend className="gcs-field__label">{t("connection.files")}</legend>
          <div className="gcs-import__choices" role="radiogroup">
            {(
              [
                ["none", faCircleXmark, t("connection.filesNone")],
                ["folder", faFolderOpen, t("connection.filesFolder")],
                ["url", faGlobe, t("connection.filesUrl")],
              ] as const
            ).map(([value, icon, label]) => (
              <label key={value} className={cx("gcs-import__choice", mode === value && "is-selected")}>
                <input type="radio" name="filesMode" value={value} checked={mode === value} onChange={() => setMode(value)} />
                <GcsIconSvg icon={icon} />
                {label}
              </label>
            ))}
          </div>
          {mode === "folder" && (
            <GcsField label={t("connection.filesPath")} hint={t("connection.filesPathHint")}>
              <input name="filesPath" defaultValue={c?.filesMode === "folder" ? c.filesPath : ""} placeholder="/srv/vechi" autoComplete="off" />
            </GcsField>
          )}
          {mode === "url" && (
            <GcsField label={t("connection.filesUrlLabel")} hint={t("connection.filesUrlHint")}>
              <input name="filesUrl" type="url" defaultValue={c?.filesMode === "url" ? c.filesPath : ""} placeholder="https://forum.exemplu.ro/" autoComplete="off" />
            </GcsField>
          )}
        </fieldset>
        <GcsField label={t("connection.oldUrl")} hint={t("connection.oldUrlHint")}>
          <input name="oldUrl" type="url" defaultValue={c?.oldUrl ?? ""} placeholder="https://forum.exemplu.ro/forum" autoComplete="off" disabled={!canEdit} />
        </GcsField>
        {canEdit && (
          <div className="gcs-acpForm__actions">
            <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={pending ? faCircleNotch : faPlug} className={pending ? "gcs-import__spin" : undefined} />}>
              {pending ? t("connection.testing") : t("connection.test")}
            </GcsButton>
            {onCancel && (
              <GcsButton variant="ghost" onClick={onCancel}>
                {t("connection.cancel")}
              </GcsButton>
            )}
          </div>
        )}
      </form>
    </Panel>
  );
}

function DetectedPanel({ job, onEdit }: { job: GcsImportView; onEdit?: () => void }) {
  const t = useTranslations("importer");
  const d = job.detected!;
  const c = job.config;
  return (
    <Panel
      icon={faDatabase}
      title={d.schema === "core-schema" ? t("detected.schemaCore", { version: d.version }) : t("detected.schemaPrefixed", { version: d.version })}
      sub={`${c.host === "fixture" ? t("detected.testSource") : `${c.user}@${c.host}:${c.port}`} · ${c.database}${c.oldUrl ? ` · ${c.oldUrl}` : ""}`}
      testId="gcs-import-detected"
      actions={
        <>
          <span className={cx("gcs-acpPill", d.supported ? "gcs-acpPill--good" : "gcs-acpPill--bad")}>
            <GcsIconSvg icon={d.supported ? faCircleCheck : faTriangleExclamation} />
            {d.supported ? t("detected.supported") : t("detected.unsupportedShort")}
          </span>
          {onEdit && (
            <GcsButton variant="ghost" size="sm" onClick={onEdit} icon={<GcsIconSvg icon={faPen} />}>
              {t("detected.edit")}
            </GcsButton>
          )}
        </>
      }
    >
      {!d.supported && <p className="gcs-import__error">{t("detected.unsupported")}</p>}
      <p className="gcs-import__label">{t("detected.counts")}</p>
      <ul className="gcs-import__counts">
        {Object.entries(d.counts).map(([key, n]) => (
          <li key={key} className="gcs-import__count">
            <span className="gcs-import__countIcon" aria-hidden="true">
              <GcsIconSvg icon={ENTITY_ICONS[key] ?? faListCheck} />
            </span>
            <span className="gcs-import__countValue">{fmt(n)}</span>
            <span className="gcs-import__countLabel">{t(`entities.${key}`)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

type StartOptions = { dryRun: boolean; options: string[]; redirects: boolean };

function OptionsPanel({ job, canEdit, pending, onStart }: { job: GcsImportView; canEdit: boolean; pending: boolean; onStart: (opts: StartOptions) => void }) {
  const t = useTranslations("importer");
  const [selected, setSelected] = useState<string[]>(job.config.options?.length ? job.config.options : [...OPTIONS]);
  const [dryRun, setDryRun] = useState(false);
  const [redirects, setRedirects] = useState(job.config.redirects !== false);
  const toggle = (o: string) => setSelected((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
  const noFiles = job.config.filesMode === "none";
  return (
    <Panel icon={faListCheck} title={t("options.title")} sub={t("options.hint")} testId="gcs-import-options">
      <div className="gcs-import__options">
        <label className="gcs-import__option is-locked">
          <input type="checkbox" checked disabled />
          <GcsIconSvg icon={faUsers} />
          {t("options.membersAlways")}
        </label>
        {OPTIONS.map((o) => (
          <label key={o} className={cx("gcs-import__option", selected.includes(o) && "is-selected")}>
            <input type="checkbox" name="option" value={o} checked={selected.includes(o) && !(o === "attachments" && noFiles)} disabled={!canEdit || (o === "attachments" && noFiles)} onChange={() => toggle(o)} />
            <GcsIconSvg icon={ENTITY_ICONS[o] ?? faListCheck} />
            {t(`entities.${o}`)}
          </label>
        ))}
      </div>
      {noFiles && <p className="gcs-import__hint">{t("options.noFiles")}</p>}
      <div className="gcs-import__switches">
        <label className="gcs-import__switch">
          <input type="checkbox" role="switch" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} disabled={!canEdit} />
          <span>
            <strong>{t("options.dryRun")}</strong>
            <small>{t("options.dryRunHint")}</small>
          </span>
        </label>
        <label className="gcs-import__switch">
          <input type="checkbox" role="switch" checked={redirects} onChange={(e) => setRedirects(e.target.checked)} disabled={!canEdit || dryRun} />
          <span>
            <strong>{t("options.redirects")}</strong>
            <small>{t("options.redirectsHint")}</small>
          </span>
        </label>
      </div>
      {canEdit && (
        <div className="gcs-acpForm__actions">
          <GcsButton
            variant="primary"
            data-testid="gcs-import-start"
            disabled={pending || !job.detected?.supported}
            // Alegerea redirecturilor se salvează și la rularea de probă (care nu le pornește), ca importul real pornit
            // din raportul ei să o păstreze.
            onClick={() => onStart({ dryRun, options: selected, redirects })}
            icon={<GcsIconSvg icon={dryRun ? faFlask : faPlay} />}
          >
            {dryRun ? t("options.startDry") : t("options.start")}
          </GcsButton>
        </div>
      )}
    </Panel>
  );
}

function StepRow({ step, current }: { step: GcsImportStepState; current: boolean }) {
  const t = useTranslations("importer");
  const pct = step.total > 0 ? Math.min(100, Math.round((step.done / step.total) * 100)) : step.status === "done" ? 100 : 0;
  return (
    <li className={cx("gcs-import__step", `is-${step.status}`, current && "is-current")} data-step={step.key}>
      <span className="gcs-import__stepIcon" aria-hidden="true">
        <GcsIconSvg icon={step.status === "pending" || step.status === "skipped" || step.status === "failed" ? STEP_ICONS[step.status] : ENTITY_ICONS[step.key] ?? faListCheck} />
      </span>
      <span className="gcs-import__stepMain">
        <span className="gcs-import__stepName">
          {t(`entities.${step.key}`)}
          <span className="gcs-import__stepStatus">
            {step.status === "running" && <GcsIconSvg icon={faCircleNotch} className="gcs-import__spin" />}
            {t(`stepStatus.${step.status}`)}
          </span>
        </span>
        {step.status !== "skipped" && (
          <span className="gcs-acpKpi__bar gcs-import__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t(`entities.${step.key}`)}>
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      <span className="gcs-import__stepNums">
        {step.status !== "skipped" && (
          <>
            {fmt(step.done)}
            {step.total > 0 && ` / ${fmt(step.total)}`}
            {step.errors > 0 && <span className="gcs-acpPill gcs-acpPill--bad">{t("report.errorsShort", { count: step.errors })}</span>}
          </>
        )}
      </span>
    </li>
  );
}

function LogList({ items, empty, testId }: { items: GcsImportLogView[]; empty: string; testId: string }) {
  const t = useTranslations("importer");
  if (items.length === 0) return <p className="gcs-import__hint">{empty}</p>;
  return (
    <ul className="gcs-import__logs" data-testid={testId}>
      {items.map((l) => (
        <li key={l.id} className={cx("gcs-import__log", `is-${l.level}`)}>
          <GcsIconSvg icon={l.level === "error" ? faCircleXmark : l.level === "warn" ? faTriangleExclamation : faCircleCheck} />
          <span className="gcs-import__logStep">{t.has(`entities.${l.step}`) ? t(`entities.${l.step}`) : l.step}</span>
          {l.sourceId && <code>#{l.sourceId}</code>}
          <span>{l.message}</span>
        </li>
      ))}
    </ul>
  );
}

function ProgressPanel({
  job,
  logs,
  errors,
  speed,
  canEdit,
  pending,
  onControl,
}: {
  job: GcsImportView;
  logs: GcsImportLogView[];
  errors: GcsImportLogView[];
  speed: number | null;
  canEdit: boolean;
  pending: boolean;
  onControl: (action: "pause" | "resume" | "cancel") => void;
}) {
  const t = useTranslations("importer");
  const paused = job.status === "PAUSED";
  const current = job.steps.find((s) => s.key === job.currentStep);
  return (
    <>
      <Panel
        icon={job.dryRun ? faFlask : faRotate}
        title={job.dryRun ? t("progress.titleDry") : t("progress.title")}
        sub={
          <>
            <span className={cx("gcs-acpPill", paused ? "gcs-acpPill--flat" : "gcs-acpPill--good")}>{t(`status.${job.status}`)}</span>{" "}
            {current && t("progress.current", { step: t(`entities.${current.key}`) })}
            {speed !== null && speed > 0 && ` · ${t("progress.speed", { count: fmt(speed) })}`}
            {job.control && ` · ${t(`progress.requested.${job.control}`)}`}
          </>
        }
        testId="gcs-import-progress"
        actions={
          canEdit && (
            <>
              {paused ? (
                <GcsButton variant="primary" size="sm" disabled={pending} onClick={() => onControl("resume")} icon={<GcsIconSvg icon={faPlay} />}>
                  {t("progress.resume")}
                </GcsButton>
              ) : (
                <GcsButton variant="ghost" size="sm" disabled={pending || !!job.control} onClick={() => onControl("pause")} icon={<GcsIconSvg icon={faPause} />}>
                  {t("progress.pause")}
                </GcsButton>
              )}
              <GcsButton variant="ghost" size="sm" disabled={pending || job.control === "cancel"} onClick={() => onControl("cancel")} icon={<GcsIconSvg icon={faStop} />}>
                {t("progress.cancel")}
              </GcsButton>
            </>
          )
        }
      >
        {job.stale && (
          <p className="gcs-import__error" role="alert">
            <GcsIconSvg icon={faTriangleExclamation} />
            {t("progress.stale")}
          </p>
        )}
        <ol className="gcs-import__steps">
          {job.steps.map((s) => (
            <StepRow key={s.key} step={s} current={s.key === job.currentStep} />
          ))}
        </ol>
      </Panel>
      <div className="gcs-import__columns">
        <Panel icon={faListCheck} title={t("progress.logs")}>
          <LogList items={logs} empty={t("progress.noLogs")} testId="gcs-import-logs" />
        </Panel>
        <Panel icon={faTriangleExclamation} title={t("progress.errors")}>
          <LogList items={errors} empty={t("progress.noErrors")} testId="gcs-import-errors" />
        </Panel>
      </div>
    </>
  );
}

function ReportPanel({
  job,
  errors,
  canEdit,
  canDelete,
  pending,
  onStart,
  onResume,
  onDeleteCredentials,
  onDelete,
}: {
  job: GcsImportView;
  errors: GcsImportLogView[];
  canEdit: boolean;
  canDelete: boolean;
  pending: boolean;
  onStart: (opts: StartOptions) => void;
  onResume: () => void;
  onDeleteCredentials: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("importer");
  const steps = job.steps.filter((s) => s.status !== "skipped");
  const dry = job.detected?.dryRun;
  const opts = { options: job.config.options, redirects: job.config.redirects };
  return (
    <>
      <Panel
        icon={job.dryRun ? faFlask : faFlagCheckered}
        title={job.dryRun ? t("report.dryTitle") : t("report.title")}
        sub={
          <span className={cx("gcs-acpPill", job.status === "DONE" ? "gcs-acpPill--good" : "gcs-acpPill--bad")} data-testid="gcs-import-status">
            {t(`status.${job.status}`)}
          </span>
        }
        testId="gcs-import-report"
        actions={
          !job.dryRun && (
            <GcsButton variant="ghost" size="sm" asChild icon={<GcsIconSvg icon={faFileCsv} />}>
              <a href={`/admin/import-report.csv?id=${encodeURIComponent(job.id)}`} download>
                {t("report.csv")}
              </a>
            </GcsButton>
          )
        }
      >
        {job.error && (
          <p className="gcs-import__error" role="alert">
            <GcsIconSvg icon={faTriangleExclamation} />
            {job.error}
          </p>
        )}
        {dry && job.dryRun && (
          <ul className="gcs-import__dry">
            <li>
              <GcsIconSvg icon={faUsers} />
              {t("report.linked", { count: fmt(dry.linkedByEmail) })}
            </li>
            <li>
              <GcsIconSvg icon={faMessage} />
              {t("report.sample", { sampled: fmt(dry.sampledPosts), unrecognized: fmt(dry.unrecognized), fallbacks: fmt(dry.fallbacks) })}
            </li>
          </ul>
        )}
        <div className="gcs-import__tableWrap">
          <table className="gcs-import__table">
            <thead>
              <tr>
                <th scope="col">{t("report.step")}</th>
                <th scope="col">{t("report.total")}</th>
                {!job.dryRun && (
                  <>
                    <th scope="col">{t("report.imported")}</th>
                    <th scope="col">{t("report.skipped")}</th>
                    <th scope="col">{t("report.errors")}</th>
                    <th scope="col">{t("report.unrecognized")}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.key} data-step={s.key}>
                  <th scope="row">
                    <GcsIconSvg icon={ENTITY_ICONS[s.key] ?? faListCheck} />
                    {t(`entities.${s.key}`)}
                  </th>
                  <td>{s.key === "finalize" ? "—" : fmt(s.total)}</td>
                  {!job.dryRun && (
                    <>
                      <td className="is-good">{fmt(s.imported)}</td>
                      <td>{fmt(s.skipped)}</td>
                      <td className={s.errors > 0 ? "is-bad" : undefined}>{fmt(s.errors)}</td>
                      <td className={s.unrecognized > 0 ? "is-warn" : undefined}>{fmt(s.unrecognized)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="gcs-acpForm__actions gcs-import__actions">
            {job.dryRun ? (
              <GcsButton variant="primary" disabled={pending} onClick={() => onStart({ dryRun: false, ...opts })} icon={<GcsIconSvg icon={faPlay} />} data-testid="gcs-import-start-real">
                {t("report.runReal")}
              </GcsButton>
            ) : job.status === "FAILED" ? (
              <GcsButton variant="primary" disabled={pending} onClick={onResume} icon={<GcsIconSvg icon={faPlay} />}>
                {t("progress.resume")}
              </GcsButton>
            ) : (
              <GcsButton variant="ghost" disabled={pending} onClick={() => onStart({ dryRun: false, ...opts })} icon={<GcsIconSvg icon={faRotate} />}>
                {t("report.sync")}
              </GcsButton>
            )}
            {job.hasPassword && (
              <GcsButton variant="ghost" disabled={pending} onClick={onDeleteCredentials} icon={<GcsIconSvg icon={faKey} />}>
                {t("report.deleteCredentials")}
              </GcsButton>
            )}
            {canDelete && (
              <GcsButton variant="ghost" disabled={pending} onClick={onDelete} icon={<GcsIconSvg icon={faPlus} />}>
                {t("report.newImport")}
              </GcsButton>
            )}
          </div>
        )}
      </Panel>
      {errors.length > 0 && (
        <Panel icon={faTriangleExclamation} title={t("progress.errors")}>
          <LogList items={errors} empty={t("progress.noErrors")} testId="gcs-import-errors" />
        </Panel>
      )}
    </>
  );
}

function RedirectsPanel({
  job,
  config,
  samples,
  canEdit,
  onChanged,
}: {
  job: GcsImportView;
  config: GcsRedirectConfig;
  samples: { from: string; to: string | null }[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("importer");
  const tErr = useTranslations("errors");
  const rule = config.rules.find((r) => r.mapKey === job.mapKey);
  const defaultPrefix = rule?.prefix ?? (job.config.oldUrl && URL.canParse(job.config.oldUrl) ? new URL(job.config.oldUrl).pathname.replace(/\/+$/, "") : "");
  const [prefix, setPrefix] = useState(defaultPrefix);
  const [checkUrl, setCheckUrl] = useState("");
  const [result, setResult] = useState<{ from: string; to: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = config.enabled && rule !== undefined;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const r = await setImportRedirectsAction(job.id, next, prefix);
    setBusy(false);
    if (!r.ok) setError(tErr.has(r.error.code) ? tErr(r.error.code) : r.error.code);
    else onChanged();
  }

  async function check(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await checkImportRedirectAction(checkUrl);
    setBusy(false);
    if (!r.ok) setError(tErr.has(r.error.code) ? tErr(r.error.code) : r.error.code);
    else setResult(r.data);
  }

  return (
    <Panel
      icon={faRoute}
      title={t("redirects.title")}
      sub={t("redirects.hint")}
      testId="gcs-import-redirects"
      actions={
        <span className={cx("gcs-acpPill", enabled ? "gcs-acpPill--good" : "gcs-acpPill--flat")} data-testid="gcs-import-redirects-state">
          {enabled ? t("redirects.enabled") : t("redirects.disabled")}
        </span>
      }
    >
      <div className="gcs-import__redirectRow">
        <GcsField label={t("redirects.prefix")} hint={t("redirects.prefixHint")}>
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="/forum" disabled={!canEdit} autoComplete="off" />
        </GcsField>
        {canEdit && (
          <GcsButton variant={enabled ? "ghost" : "primary"} disabled={busy} onClick={() => toggle(!enabled)} icon={<GcsIconSvg icon={enabled ? faStop : faPlay} />}>
            {enabled ? t("redirects.disable") : t("redirects.enable")}
          </GcsButton>
        )}
        {canEdit && enabled && prefix !== (rule?.prefix ?? "") && (
          <GcsButton variant="ghost" disabled={busy} onClick={() => toggle(true)} icon={<GcsIconSvg icon={faRotate} />}>
            {t("redirects.savePrefix")}
          </GcsButton>
        )}
      </div>
      <form onSubmit={check} className="gcs-import__check" data-testid="gcs-import-redirect-check">
        <GcsField label={t("redirects.checkUrl")}>
          <input value={checkUrl} onChange={(e) => setCheckUrl(e.target.value)} placeholder={`${job.config.oldUrl || "https://forum.exemplu.ro"}/…`} autoComplete="off" />
        </GcsField>
        <GcsButton variant="ghost" type="submit" disabled={busy || checkUrl.trim() === ""} icon={<GcsIconSvg icon={faMagnifyingGlass} />}>
          {t("redirects.check")}
        </GcsButton>
      </form>
      {result && (
        <p className={result.to ? "gcs-import__ok" : "gcs-import__error"} role="status" data-testid="gcs-import-redirect-result">
          <code>{result.from}</code>
          <GcsIconSvg icon={faArrowRight} />
          {result.to ? <a href={result.to}>{result.to}</a> : t("redirects.noMatch")}
        </p>
      )}
      {error && (
        <p className="gcs-import__error" role="alert">
          {error}
        </p>
      )}
      {samples.length > 0 && (
        <>
          <p className="gcs-import__label">{t("redirects.samples")}</p>
          <ul className="gcs-import__samples">
            {samples.map((s) => (
              <li key={s.from}>
                <code>{s.from}</code>
                <GcsIconSvg icon={faArrowRight} />
                {s.to ? <a href={s.to}>{s.to}</a> : <span className="gcs-import__hint">{t("redirects.noMatch")}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="gcs-import__hint">{t("redirects.keepNote")}</p>
    </Panel>
  );
}
