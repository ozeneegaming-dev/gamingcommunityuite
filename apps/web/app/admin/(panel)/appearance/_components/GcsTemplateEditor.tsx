"use client";

import {
  faArrowsRotate,
  faBoxOpen,
  faCheck,
  faCode,
  faCircleExclamation,
  faClockRotateLeft,
  faCodeCompare,
  faEye,
  faFloppyDisk,
  faMagnifyingGlass,
  faPuzzlePiece,
  faRotateLeft,
  faTriangleExclamation,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsErrorPayload, GcsTemplateDetail, GcsTemplateStatus } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTemplateFrameReady, TEMPLATE_EDITOR_SOURCE, type GcsTemplateHtmlMessage } from "@/lib/template-preview";
import { useErrorMessage } from "@/lib/use-error-message";
import { markTemplateReviewed, previewTemplate, restoreTemplateVersion, revertTemplate, saveTemplate } from "../templates/actions";
import { GcsCodeEditor, type GcsCodeEditorApi } from "./GcsCodeEditor";
import { GcsDiffView } from "./GcsDiffView";
import { GcsVersionHistory } from "./GcsVersionHistory";
import type { GcsAcpIconDef } from "../../_components/types";

/** Un șablon din arbore; iconița e rezolvată pe server (doar datele SVG ajung în browser). */
export type GcsTemplateTreeItem = { key: string; group: string; icon: GcsAcpIconDef | null; title: string; status: GcsTemplateStatus; partial: boolean };

type Template = {
  key: string;
  title: string;
  description: string;
  mode: "site" | "email";
  partial: boolean;
  defaultSource: string;
  variables: { name: string; type: string; text: string }[];
  slots: { name: string; required: boolean; text: string }[];
};
type Detail = Pick<GcsTemplateDetail, "status" | "override" | "versions">;
type TemplateError = { line: number; column: number; message: string };

const PREVIEW_DELAY = 450;

/**
 * Editorul ACP → Aspect → Șabloane: arborele pe zone (stânga), editorul de cod (mijloc) și panoul din dreapta cu
 * previzualizarea pe date reale, variabilele disponibile (click = inserare) și istoricul. Previzualizarea și salvarea
 * validează sursa pe server; eroarea apare cu rândul și coloana, marcată în editor.
 */
export function GcsTemplateEditor({
  themeKey,
  items,
  groups,
  template,
  detail: initialDetail,
  completions,
  canEdit,
  previewUrl,
}: {
  themeKey: string;
  items: GcsTemplateTreeItem[];
  groups: { key: string; icon: GcsAcpIconDef | null; label: string }[];
  template: Template;
  detail: Detail;
  completions: { tags: string[]; filters: string[] };
  canEdit: boolean;
  previewUrl: string;
}) {
  const t = useTranslations("acp.templatesEditor");
  const tc = useTranslations("acp.codeEditor");
  const te = useTranslations("acp.templatesEditor.errors");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const pathname = usePathname();

  const [detail, setDetail] = useState(initialDetail);
  const initialSource = initialDetail.override?.source ?? template.defaultSource;
  const [value, setValue] = useState(initialSource);
  const [saved, setSaved] = useState(initialSource);
  const [historyKey, setHistoryKey] = useState(0);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "muted"; text: string } | null>(null);
  const [error, setError] = useState<TemplateError | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"preview" | "variables" | "history">("preview");
  const [query, setQuery] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const editor = useRef<GcsCodeEditorApi>(null);
  const dirty = value !== saved;
  const statusOf = (key: string) => (key === template.key ? detail.status : (items.find((i) => i.key === key)?.status ?? "default"));

  const href = (key: string) => `${pathname}?theme=${encodeURIComponent(themeKey)}&template=${encodeURIComponent(key)}`;

  /** Mesajul unei erori de șablon (rândul, coloana, ce e greșit). */
  const templateError = useCallback(
    (e: GcsErrorPayload): TemplateError | null => {
      if (e.fields?.source !== "template_syntax" || !e.params) return null;
      const code = e.params.error ?? "";
      const detailText = e.params.detail ?? "";
      const what = te.has(code) ? te(code, { detail: detailText }) : code;
      const where = e.params.template ? t("inTemplate", { template: e.params.template }) : "";
      return { line: Number(e.params.line) || 1, column: Number(e.params.column) || 1, message: `${what}${where}` };
    },
    [t, te],
  );

  // ─── Previzualizarea (randată pe server, cu sursa nesalvată) ───────────────
  const postPreview = useCallback(
    (html: string | null) => {
      if (html === null) return;
      const message: GcsTemplateHtmlMessage = { source: TEMPLATE_EDITOR_SOURCE, type: "html", html, mode: template.mode };
      frame.current?.contentWindow?.postMessage(message, window.location.origin);
    },
    [template.mode],
  );

  const runPreview = useCallback(
    async (source: string) => {
      setPreviewing(true);
      const res = await previewTemplate(themeKey, template.key, source);
      setPreviewing(false);
      if (!res.ok) {
        const e = templateError(res.error);
        setError(e ?? { line: 1, column: 1, message: errorMessage(res.error) });
        return;
      }
      setError(null);
      setPreviewHtml(res.data.html);
      postPreview(res.data.html);
    },
    [errorMessage, postPreview, template.key, templateError, themeKey],
  );

  useEffect(() => {
    const id = setTimeout(() => void runPreview(value), PREVIEW_DELAY);
    return () => clearTimeout(id);
  }, [value, runPreview]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.source === frame.current?.contentWindow && isTemplateFrameReady(e.data)) postPreview(previewHtml);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postPreview, previewHtml]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ─── Acțiuni ───────────────────────────────────────────────────────────────
  const applyDetail = (next: GcsTemplateDetail, message: string) => {
    const source = next.override?.source ?? template.defaultSource;
    setDetail({ status: next.status, override: next.override, versions: next.versions });
    setValue(source);
    setSaved(source);
    setHistoryKey((k) => k + 1);
    setError(null);
    setStatus({ tone: "ok", text: message });
    router.refresh();
  };

  const save = async () => {
    if (!canEdit || busy) return;
    setBusy(true);
    setStatus({ tone: "muted", text: tc("saving") });
    const res = await saveTemplate(themeKey, template.key, value);
    setBusy(false);
    if (!res.ok) {
      const e = templateError(res.error);
      if (e) setError(e);
      return setStatus({ tone: "error", text: e ? `${tc("line", { line: e.line })}, ${tc("column", { column: e.column })}: ${e.message}` : errorMessage(res.error) });
    }
    applyDetail(res.data, t("saved"));
  };

  const revert = async () => {
    if (!canEdit || busy || !window.confirm(t("confirmRevert"))) return;
    setBusy(true);
    const res = await revertTemplate(themeKey, template.key);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    applyDetail(res.data, t("reverted"));
  };

  const restore = async (versionId: number) => {
    if (!canEdit || busy) return;
    if (dirty && !window.confirm(tc("unsavedConfirm"))) return;
    setBusy(true);
    const res = await restoreTemplateVersion(themeKey, template.key, versionId);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    applyDetail(res.data, tc("restored"));
  };

  const markReviewed = async () => {
    setBusy(true);
    const res = await markTemplateReviewed(themeKey, template.key);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    setDetail({ status: res.data.status, override: res.data.override, versions: res.data.versions });
    setShowReview(false);
    setStatus({ tone: "ok", text: t("reviewed") });
    router.refresh();
  };

  const insert = (text: string) => {
    if (!canEdit) return;
    editor.current?.insert(text);
  };

  // ─── Arborele ──────────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const visible = items.filter((i) => !q || i.title.toLowerCase().includes(q) || i.key.includes(q));
  const variableGroups = useMemo(() => {
    const map = new Map<string, Template["variables"]>();
    for (const v of template.variables) {
      const root = v.name.split(".")[0]!;
      map.set(root, [...(map.get(root) ?? []), v]);
    }
    return [...map.entries()];
  }, [template.variables]);

  const badge = (s: GcsTemplateStatus) =>
    s === "default" ? null : (
      <span className={`gcs-tree__badge gcs-tree__badge--${s}`} data-testid={`gcs-template-badge-${s}`}>
        {t(`status.${s}`)}
      </span>
    );

  return (
    <section className="gcs-card gcs-codeWs gcs-codeWs--templates" aria-label={t("title")} data-testid="gcs-template-editor">
      {/* ─── Arborele ─── */}
      <nav className="gcs-codeWs__nav" aria-label={t("tree")}>
        <label className="gcs-codeWs__search">
          <GcsIconSvg icon={faMagnifyingGlass} />
          <input className="gcs-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} data-testid="gcs-template-search" />
        </label>
        <div className="gcs-tree">
          {groups.map((g) => {
            const list = visible.filter((i) => i.group === g.key);
            if (list.length === 0) return null;
            return (
              <div key={g.key} className="gcs-tree__group">
                <h3 className="gcs-tree__groupTitle">
                  {g.icon && <GcsIconSvg icon={g.icon} />}
                  {g.label}
                </h3>
                <ul className="gcs-tree__items">
                  {list.map((i) => (
                    <li key={i.key}>
                      <a
                        href={href(i.key)}
                        className={`gcs-tree__item${i.key === template.key ? " gcs-tree__item--active" : ""}`}
                        aria-current={i.key === template.key ? "page" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (i.key === template.key) return;
                          if (dirty && !window.confirm(tc("unsavedConfirm"))) return;
                          router.push(href(i.key));
                        }}
                        data-testid="gcs-template-item"
                        data-key={i.key}
                      >
                        {i.icon && <GcsIconSvg icon={i.icon} className="gcs-tree__icon" />}
                        <span className="gcs-tree__text">
                          <span className="gcs-tree__title">{i.title}</span>
                          <code className="gcs-tree__key">{i.key}</code>
                        </span>
                        {badge(statusOf(i.key))}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {visible.length === 0 && <p className="gcs-muted gcs-tree__empty">{t("noResults")}</p>}
        </div>
      </nav>

      {/* ─── Editorul ─── */}
      <div className="gcs-codeWs__main">
        <div className="gcs-codeWs__toolbar">
          <div className="gcs-codeWs__titleBlock">
            <h2 className="gcs-codeWs__title" data-testid="gcs-template-title">
              <GcsIconSvg icon={faCode} />
              {template.title}
              {badge(detail.status)}
              {dirty && <span className="gcs-badge gcs-badge--warn gcs-codeWs__badge">{tc("unsaved")}</span>}
            </h2>
            <p className="gcs-codeWs__sub">
              <code>{template.key}</code> · {template.description}
            </p>
          </div>
          <div className="gcs-codeWs__actions">
            <button type="button" className="gcs-codeWs__iconBtn" onClick={() => editor.current?.openSearch()} aria-label={tc("search")} title={tc("search")}>
              <GcsIconSvg icon={faMagnifyingGlass} />
            </button>
            {canEdit && detail.override && (
              <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faRotateLeft} />} onClick={() => void revert()} disabled={busy} data-testid="gcs-template-revert">
                {t("revert")}
              </GcsButton>
            )}
            {canEdit && (
              <button type="button" className="gcs-codeWs__iconBtn" onClick={() => setValue(saved)} disabled={!dirty || busy} aria-label={tc("discard")} title={tc("discard")} data-testid="gcs-template-discard">
                <GcsIconSvg icon={faArrowsRotate} />
              </button>
            )}
            {canEdit && (
              <GcsButton variant="primary" size="sm" icon={<GcsIconSvg icon={faFloppyDisk} />} onClick={() => void save()} disabled={busy || !dirty} data-testid="gcs-template-save">
                {tc("save")}
              </GcsButton>
            )}
          </div>
        </div>

        {detail.status === "review" && detail.override && (
          <div className="gcs-codeWs__notice gcs-codeWs__notice--warn" data-testid="gcs-template-review">
            <p>
              <GcsIconSvg icon={faTriangleExclamation} /> {t("reviewNotice")}
            </p>
            <div className="gcs-codeWs__noticeActions">
              <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faCodeCompare} />} onClick={() => setShowReview((s) => !s)} aria-expanded={showReview}>
                {t("reviewDiff")}
              </GcsButton>
              {canEdit && (
                <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faCheck} />} onClick={() => void markReviewed()} disabled={busy} data-testid="gcs-template-reviewed">
                  {t("markReviewed")}
                </GcsButton>
              )}
            </div>
            {showReview && (
              <GcsDiffView
                before={detail.override.baseSource}
                after={template.defaultSource}
                labels={{ same: tc("diff.same"), added: tc("diff.added"), removed: tc("diff.removed"), skipped: tc.raw("diff.skipped") as string }}
                testId="gcs-template-review-diff"
              />
            )}
          </div>
        )}

        {error && (
          <div className="gcs-codeWs__notice gcs-codeWs__notice--error" role="alert" data-testid="gcs-template-error">
            <GcsIconSvg icon={faCircleExclamation} />
            <span>
              <strong>
                {tc("line", { line: error.line })}, {tc("column", { column: error.column })}
              </strong>
              : {error.message}
            </span>
          </div>
        )}

        <GcsCodeEditor
          ref={editor}
          value={value}
          onChange={setValue}
          onSave={() => void save()}
          language="liquid"
          label={t("editorLabel", { name: template.title })}
          loadingLabel={tc("loading")}
          completions={{ variables: template.variables.map((v) => ({ name: v.name, detail: v.type })), tags: completions.tags, filters: completions.filters }}
          error={error}
          testId="gcs-template-code"
        />
        <div className="gcs-codeWs__foot">
          <p role="status" className={`gcs-codeWs__status gcs-codeWs__status--${status?.tone ?? "muted"}`} data-testid="gcs-template-status">
            {status?.tone === "error" && <GcsIconSvg icon={faTriangleExclamation} />}
            {status?.tone === "ok" && <GcsIconSvg icon={faCheck} />}
            {status?.text ?? (detail.override ? t("usingOverride") : t("usingDefault"))}
          </p>
          <p className="gcs-codeWs__help">{t("securityHint")}</p>
        </div>
      </div>

      {/* ─── Previzualizare / variabile / istoric ─── */}
      <aside className="gcs-codeWs__side" aria-label={t("sidePanel")}>
        <div className="gcs-codeWs__tabs" role="tablist">
          {(
            [
              ["preview", faEye, tc("preview")],
              ["variables", faBoxOpen, t("variables")],
              ["history", faClockRotateLeft, tc("history.title")],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`gcs-codeWs__tab${tab === id ? " gcs-codeWs__tab--active" : ""}`}
              onClick={() => setTab(id)}
              data-testid={`gcs-template-tab-${id}`}
            >
              <GcsIconSvg icon={icon} />
              {label}
              {id === "history" && <span className="gcs-codeWs__count">{detail.versions.length}</span>}
            </button>
          ))}
        </div>
        <div className="gcs-codeWs__panel" hidden={tab !== "preview"}>
          <div className="gcs-codeWs__previewBar">
            <p className="gcs-codeWs__help">
              <GcsIconSvg icon={faWandMagicSparkles} /> {t("previewHint")}
            </p>
            <button type="button" className="gcs-codeWs__iconBtn" onClick={() => void runPreview(value)} aria-label={t("refreshPreview")} title={t("refreshPreview")} data-testid="gcs-template-preview-refresh" disabled={previewing}>
              <GcsIconSvg icon={faArrowsRotate} />
            </button>
          </div>
          <div className="gcs-codeWs__frameWrap">
            <iframe ref={frame} src={previewUrl} title={tc("preview")} className="gcs-codeWs__frame" data-testid="gcs-template-preview" />
          </div>
        </div>
        <div className="gcs-codeWs__panel" hidden={tab !== "variables"}>
          <p className="gcs-codeWs__help">{t("variablesHint")}</p>
          <div className="gcs-varList" data-testid="gcs-template-variables">
            {variableGroups.map(([root, list]) => (
              <details key={root} className="gcs-varList__group" open={root !== "site" && root !== "viewer" && root !== "locale"}>
                <summary>
                  <GcsIconSvg icon={faBoxOpen} />
                  <code>{root}</code>
                </summary>
                <ul>
                  {list.map((v) => (
                    <li key={v.name}>
                      <button type="button" className="gcs-varList__item" onClick={() => insert(`{{ ${v.name} }}`)} disabled={!canEdit} data-testid="gcs-template-var" data-name={v.name}>
                        <code className="gcs-varList__name">{v.name}</code>
                        <span className="gcs-varList__type">{v.type}</span>
                        <span className="gcs-varList__text">{v.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {template.slots.length > 0 && (
              <details className="gcs-varList__group" open>
                <summary>
                  <GcsIconSvg icon={faPuzzlePiece} />
                  {t("slots")}
                </summary>
                <ul>
                  {template.slots.map((s) => (
                    <li key={s.name}>
                      <button type="button" className="gcs-varList__item" onClick={() => insert(`{% slot "${s.name}" %}`)} disabled={!canEdit}>
                        <code className="gcs-varList__name">{`{% slot "${s.name}" %}`}</code>
                        <span className="gcs-varList__type">{s.required ? t("slotRequired") : t("slotOptional")}</span>
                        <span className="gcs-varList__text">{s.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <details className="gcs-varList__group">
              <summary>
                <GcsIconSvg icon={faCode} />
                {t("syntax")}
              </summary>
              <ul className="gcs-varList__syntax">
                {["{% if x %}…{% elsif y %}…{% else %}…{% endif %}", "{% for item in list limit: 5 %}{{ forloop.index }}{% endfor %}", '{{ value | default: "—" }}', '{{ "forum.topics" | t }}', '{{ date | date: "long" }}', '{% icon "fa-solid fa-star" %}', '{% avatar user, size: "s" %}', "{% username user %}", "{% time date %}", '{% include "postbit.fields" %}', '{% hook "postbit.after_fields" %}'].map(
                  (snippet) => (
                    <li key={snippet}>
                      <button type="button" className="gcs-varList__item" onClick={() => insert(snippet)} disabled={!canEdit}>
                        <code className="gcs-varList__name">{snippet}</code>
                      </button>
                    </li>
                  ),
                )}
              </ul>
              <p className="gcs-codeWs__help">{t("filtersList", { filters: completions.filters.join(", ") })}</p>
            </details>
          </div>
        </div>
        <div className="gcs-codeWs__panel" hidden={tab !== "history"}>
          <GcsVersionHistory
            key={historyKey}
            versions={detail.versions.map((v) => ({ id: v.id, action: v.action, authorName: v.authorName, createdAt: v.createdAt, text: v.source }))}
            original={template.defaultSource}
            canRestore={canEdit}
            busy={busy}
            onRestore={(id) => void restore(id)}
          />
        </div>
      </aside>
    </section>
  );
}
