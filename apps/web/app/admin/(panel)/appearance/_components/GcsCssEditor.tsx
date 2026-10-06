"use client";

import {
  faArrowDown,
  faArrowUp,
  faCheck,
  faClockRotateLeft,
  faDisplay,
  faEye,
  faFileCode,
  faFloppyDisk,
  faLock,
  faMagnifyingGlass,
  faMobileScreenButton,
  faPen,
  faPlus,
  faRotateLeft,
  faTabletScreenButton,
  faTrashCan,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsCssFileView, GcsCssRemoval, GcsCssVersionView } from "@gcs/core";
import { compileThemeCss, joinThemeCssFiles, type GcsThemeSettings } from "@gcs/core/themes";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPreviewReadyMessage, STUDIO_MESSAGE_SOURCE, type GcsStudioApplyMessage } from "@/lib/theme-preview";
import { useErrorMessage } from "@/lib/use-error-message";
import { createCssFile, cssFileHistory, deleteCssFile, moveCssFile, renameCssFile, restoreCssVersion, saveCssFile } from "../css/actions";
import { GcsCodeEditor, type GcsCodeEditorApi } from "./GcsCodeEditor";
import { GcsVersionHistory } from "./GcsVersionHistory";

type History = { versions: GcsCssVersionView[]; original: GcsCssVersionView | null };
type Size = "desktop" | "tablet" | "mobile";
const SIZES: Record<Size, string> = { desktop: "100%", tablet: "820px", mobile: "390px" };
const PAGES = ["/", "/members", "/search", "/staff"] as const;

/**
 * Editorul ACP → Aspect → CSS: lista fișierelor temei (stânga), editorul de cod (mijloc) și panoul cu previzualizarea
 * live sau istoricul (dreapta). Previzualizarea e site-ul în `iframe` (modul de previzualizare al temei), cu CSS-ul
 * compilat în browser exact ca pe server, inclusiv fișierul nesalvat.
 */
export function GcsCssEditor({
  themeKey,
  settings,
  files,
  selectedId,
  history: initialHistory,
  canEdit,
  canDelete,
  previewBase,
}: {
  themeKey: string;
  settings: GcsThemeSettings;
  files: GcsCssFileView[];
  selectedId: number | null;
  history: History;
  canEdit: boolean;
  canDelete: boolean;
  previewBase: string;
}) {
  const t = useTranslations("acp.cssEditor");
  const tc = useTranslations("acp.codeEditor");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const pathname = usePathname();
  const file = files.find((f) => f.id === selectedId) ?? null;

  const [value, setValue] = useState(file?.content ?? "");
  const [saved, setSaved] = useState(file?.content ?? "");
  const [history, setHistory] = useState(initialHistory);
  const [historyKey, setHistoryKey] = useState(0);
  const [report, setReport] = useState<GcsCssRemoval[] | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "muted"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"preview" | "history">("preview");
  const [size, setSize] = useState<Size>("desktop");
  const [page, setPage] = useState<string>("/");
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const editor = useRef<GcsCodeEditorApi>(null);
  const dirty = value !== saved;

  const href = (fileId: number | null) => `${pathname}?theme=${encodeURIComponent(themeKey)}${fileId ? `&file=${fileId}` : ""}`;
  const leave = (to: string) => {
    if (dirty && !window.confirm(tc("unsavedConfirm"))) return;
    router.push(to);
  };

  // ─── Previzualizarea ───────────────────────────────────────────────────────
  const css = useMemo(
    () => compileThemeCss(settings, joinThemeCssFiles(files.map((f) => (f.id === selectedId ? { name: f.name, content: value } : f)))),
    [settings, files, selectedId, value],
  );
  const post = useCallback(() => {
    const message: GcsStudioApplyMessage = { source: STUDIO_MESSAGE_SOURCE, type: "apply", css };
    frame.current?.contentWindow?.postMessage(message, window.location.origin);
  }, [css]);
  useEffect(() => {
    const id = setTimeout(post, 150);
    return () => clearTimeout(id);
  }, [post]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.source === frame.current?.contentWindow && isPreviewReadyMessage(e.data)) post();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [post]);

  // Plecarea de pe pagină cu modificări nesalvate cere confirmare.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const reloadHistory = async () => {
    if (!file) return;
    const res = await cssFileHistory(themeKey, file.id);
    if (res.ok) {
      setHistory(res.data);
      setHistoryKey((k) => k + 1);
    }
  };

  // ─── Salvare / restaurare ──────────────────────────────────────────────────
  const save = async () => {
    if (!file || !canEdit || busy) return;
    setBusy(true);
    setStatus({ tone: "muted", text: tc("saving") });
    const res = await saveCssFile(themeKey, file.id, value);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    setValue(res.data.file.content);
    setSaved(res.data.file.content);
    setReport(res.data.removed);
    setStatus({ tone: "ok", text: res.data.changed ? t("saved") : t("unchanged") });
    if (res.data.changed) await reloadHistory();
  };

  const restore = async (versionId: number) => {
    if (!file || busy) return;
    if (dirty && !window.confirm(tc("unsavedConfirm"))) return;
    setBusy(true);
    const res = await restoreCssVersion(themeKey, file.id, versionId);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    setValue(res.data.file.content);
    setSaved(res.data.file.content);
    setReport(res.data.removed);
    setStatus({ tone: "ok", text: tc("restored") });
    await reloadHistory();
  };

  // ─── Fișierele ─────────────────────────────────────────────────────────────
  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    if (dirty && !window.confirm(tc("unsavedConfirm"))) return;
    setBusy(true);
    const res = await createCssFile(themeKey, name.endsWith(".css") ? name : `${name}.css`);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    setNewName("");
    setSaved(value);
    router.push(href(res.data.id));
  };

  const rename = async () => {
    if (!file || renaming === null) return;
    setBusy(true);
    const res = await renameCssFile(themeKey, file.id, renaming.endsWith(".css") ? renaming : `${renaming}.css`);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    setRenaming(null);
    router.refresh();
  };

  const remove = async () => {
    if (!file || !window.confirm(t("confirmDelete", { name: file.name }))) return;
    setBusy(true);
    const res = await deleteCssFile(themeKey, file.id);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    setSaved(value);
    router.push(href(null));
  };

  const move = async (fileId: number, direction: -1 | 1) => {
    setBusy(true);
    const res = await moveCssFile(themeKey, fileId, direction);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    router.refresh();
  };

  return (
    <section className="gcs-card gcs-codeWs" aria-label={t("title")} data-testid="gcs-css-editor">
      {/* ─── Fișierele ─── */}
      <nav className="gcs-codeWs__nav" aria-label={t("files")}>
        <h2 className="gcs-codeWs__heading">
          <GcsIconSvg icon={faFileCode} />
          {t("files")}
        </h2>
        <ol className="gcs-codeWs__list">
          {files.map((f, i) => (
            <li key={f.id} className={`gcs-codeWs__item${f.id === selectedId ? " gcs-codeWs__item--active" : ""}`}>
              <a
                href={href(f.id)}
                className="gcs-codeWs__itemLink"
                aria-current={f.id === selectedId ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (f.id !== selectedId) leave(href(f.id));
                }}
                data-testid="gcs-css-file"
              >
                <GcsIconSvg icon={f.locked ? faLock : faFileCode} className="gcs-codeWs__itemIcon" />
                <span className="gcs-codeWs__itemName">{f.name}</span>
                {f.id === selectedId && dirty && <span className="gcs-codeWs__dot" title={tc("unsaved")} aria-label={tc("unsaved")} />}
              </a>
              {canEdit && (
                <span className="gcs-codeWs__itemTools">
                  <button type="button" className="gcs-codeWs__iconBtn" onClick={() => void move(f.id, -1)} disabled={busy || i === 0} aria-label={t("moveUp", { name: f.name })} title={t("moveUp", { name: f.name })}>
                    <GcsIconSvg icon={faArrowUp} />
                  </button>
                  <button
                    type="button"
                    className="gcs-codeWs__iconBtn"
                    onClick={() => void move(f.id, 1)}
                    disabled={busy || i === files.length - 1}
                    aria-label={t("moveDown", { name: f.name })}
                    title={t("moveDown", { name: f.name })}
                  >
                    <GcsIconSvg icon={faArrowDown} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {canEdit && (
          <form
            className="gcs-codeWs__new"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              className="gcs-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("newPlaceholder")}
              aria-label={t("newFile")}
              maxLength={45}
              data-testid="gcs-css-new-name"
            />
            <GcsButton type="submit" variant="ghost" size="sm" icon={<GcsIconSvg icon={faPlus} />} disabled={busy || !newName.trim()} data-testid="gcs-css-new">
              {t("newFile")}
            </GcsButton>
          </form>
        )}
        <p className="gcs-codeWs__help">{t("orderHint")}</p>
      </nav>

      {/* ─── Editorul ─── */}
      <div className="gcs-codeWs__main">
        {file ? (
          <>
            <div className="gcs-codeWs__toolbar">
              {renaming !== null ? (
                <form
                  className="gcs-codeWs__rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename();
                  }}
                >
                  <input className="gcs-input" value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label={t("rename")} autoFocus maxLength={45} data-testid="gcs-css-rename-input" />
                  <button type="submit" className="gcs-codeWs__iconBtn" aria-label={t("rename")} disabled={busy}>
                    <GcsIconSvg icon={faCheck} />
                  </button>
                  <button type="button" className="gcs-codeWs__iconBtn" aria-label={tc("cancel")} onClick={() => setRenaming(null)}>
                    <GcsIconSvg icon={faXmark} />
                  </button>
                </form>
              ) : (
                <h2 className="gcs-codeWs__title" data-testid="gcs-css-title">
                  <GcsIconSvg icon={file.locked ? faLock : faFileCode} />
                  {file.name}
                  {file.locked && <span className="gcs-badge gcs-codeWs__badge">{t("visualEditorFile")}</span>}
                  {dirty && <span className="gcs-badge gcs-badge--warn gcs-codeWs__badge">{tc("unsaved")}</span>}
                </h2>
              )}
              <div className="gcs-codeWs__actions">
                <button type="button" className="gcs-codeWs__iconBtn" onClick={() => editor.current?.openSearch()} aria-label={tc("search")} title={tc("search")}>
                  <GcsIconSvg icon={faMagnifyingGlass} />
                </button>
                {canEdit && !file.locked && renaming === null && (
                  <button type="button" className="gcs-codeWs__iconBtn" onClick={() => setRenaming(file.name)} aria-label={t("rename")} title={t("rename")} data-testid="gcs-css-rename">
                    <GcsIconSvg icon={faPen} />
                  </button>
                )}
                {canDelete && !file.locked && (
                  <button type="button" className="gcs-codeWs__iconBtn gcs-codeWs__iconBtn--danger" onClick={() => void remove()} aria-label={t("delete")} title={t("delete")} data-testid="gcs-css-delete">
                    <GcsIconSvg icon={faTrashCan} />
                  </button>
                )}
                {canEdit && (
                  <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faRotateLeft} />} onClick={() => setValue(saved)} disabled={!dirty || busy} data-testid="gcs-css-discard">
                    {tc("discard")}
                  </GcsButton>
                )}
                {canEdit && (
                  <GcsButton variant="primary" size="sm" icon={<GcsIconSvg icon={faFloppyDisk} />} onClick={() => void save()} disabled={busy || !dirty} data-testid="gcs-css-save">
                    {tc("save")}
                  </GcsButton>
                )}
              </div>
            </div>
            <GcsCodeEditor
              ref={editor}
              value={value}
              onChange={setValue}
              onSave={() => void save()}
              language="css"
              label={t("editorLabel", { name: file.name })}
              loadingLabel={tc("loading")}
              testId="gcs-css-code"
            />
            <div className="gcs-codeWs__foot">
              <p role="status" className={`gcs-codeWs__status gcs-codeWs__status--${status?.tone ?? "muted"}`} data-testid="gcs-css-status">
                {status?.tone === "error" && <GcsIconSvg icon={faTriangleExclamation} />}
                {status?.tone === "ok" && <GcsIconSvg icon={faCheck} />}
                {status?.text ?? tc("shortcuts")}
              </p>
              {report && report.length > 0 && (
                <div className="gcs-codeWs__notice gcs-codeWs__notice--warn" data-testid="gcs-css-report">
                  <strong>
                    <GcsIconSvg icon={faTriangleExclamation} /> {t("report.title", { count: report.length })}
                  </strong>
                  <ul>
                    {report.map((r, i) => (
                      <li key={i}>
                        <span className="gcs-codeWs__line">{tc("line", { line: r.line })}</span> <code>{r.text}</code> — {t(`report.${r.reason}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="gcs-muted">{t("noFiles")}</p>
        )}
      </div>

      {/* ─── Previzualizarea / istoricul ─── */}
      <aside className="gcs-codeWs__side" aria-label={t("sidePanel")}>
        <div className="gcs-codeWs__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "preview"} className={`gcs-codeWs__tab${tab === "preview" ? " gcs-codeWs__tab--active" : ""}`} onClick={() => setTab("preview")} data-testid="gcs-css-tab-preview">
            <GcsIconSvg icon={faEye} />
            {tc("preview")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "history"} className={`gcs-codeWs__tab${tab === "history" ? " gcs-codeWs__tab--active" : ""}`} onClick={() => setTab("history")} data-testid="gcs-css-tab-history">
            <GcsIconSvg icon={faClockRotateLeft} />
            {tc("history.title")}
            <span className="gcs-codeWs__count">{history.versions.length}</span>
          </button>
        </div>
        <div className="gcs-codeWs__panel" hidden={tab !== "preview"}>
          <div className="gcs-codeWs__previewBar">
            <select className="gcs-input gcs-codeWs__pageSelect" value={page} onChange={(e) => setPage(e.target.value)} aria-label={t("previewPage")} data-testid="gcs-css-preview-page">
              {PAGES.map((p) => (
                <option key={p} value={p}>
                  {t(`pages.${p === "/" ? "home" : p.slice(1)}`)}
                </option>
              ))}
            </select>
            <div className="gcs-codeWs__seg" role="group" aria-label={tc("previewSize")}>
              {(
                [
                  ["desktop", faDisplay],
                  ["tablet", faTabletScreenButton],
                  ["mobile", faMobileScreenButton],
                ] as const
              ).map(([s, icon]) => (
                <button key={s} type="button" className={`gcs-codeWs__segBtn${size === s ? " gcs-codeWs__segBtn--active" : ""}`} aria-pressed={size === s} aria-label={tc(`sizes.${s}`)} onClick={() => setSize(s)}>
                  <GcsIconSvg icon={icon} />
                </button>
              ))}
            </div>
          </div>
          <div className="gcs-codeWs__frameWrap">
            <iframe ref={frame} src={`${page}${previewBase}`} title={tc("preview")} className="gcs-codeWs__frame" style={{ width: SIZES[size] }} data-testid="gcs-css-preview" />
          </div>
          <p className="gcs-codeWs__help">{t("previewHint")}</p>
        </div>
        <div className="gcs-codeWs__panel" hidden={tab !== "history"}>
          <GcsVersionHistory
            key={historyKey}
            versions={history.versions.map((v) => ({ id: v.id, action: v.action, authorName: v.authorName, createdAt: v.createdAt, text: v.content }))}
            original={history.original?.content ?? ""}
            canRestore={canEdit}
            busy={busy}
            onRestore={(id) => void restore(id)}
          />
        </div>
      </aside>
    </section>
  );
}
