"use client";

import { faCloudArrowUp, faFloppyDisk, faLink, faServer, faXmark, faArrowLeft, faArrowRight } from "@fortawesome/free-solid-svg-icons";
import { GCS_RICH_FIELDS } from "@gcs/core/rich-fields";
import type { GcsAssetStatus } from "@gcs/modules";
import { formatBytes } from "@gcs/modules/downloads-text";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import type { GcsEditorTool } from "@gcs/ui/editor";
import { GcsIcon } from "@gcs/ui/icons";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { cancelUpload, uploadInChunks, uploadStatus, type GcsChunkError } from "@/lib/download-upload";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";
import { useErrorMessage } from "@/lib/use-error-message";
import { addDownloadLinkAction, addDownloadVersionAction, editDownloadAction, importDownloadPathAction, listImportableAction, submitDownloadAction, submitManyDownloadsAction } from "../../download-actions";
import { GcsRichTextInput } from "../editor/GcsRichTextInput";

const TOOLS: GcsEditorTool[] = ["bold", "italic", "underline", "strike", "color", "highlight", "clear", "size", "bulletList", "orderedList", "quote", "code", "horizontalRule", "link", "image", "spoiler", "emoji"];

export type GcsDownloadFormContext = {
  categories: { id: number; name: string; depth: number; vip: boolean }[];
  category: {
    id: number;
    name: string;
    extensions: string[];
    maxBytes: number | null;
    multipleFiles: boolean;
    versioning: string;
    requireChangelog: boolean;
    screenshots: boolean;
    requireScreenshots: boolean;
    maxScreenshots: number;
    screenshotMaxKb: number;
    tags: boolean;
    submitTerms: string;
    approval: boolean;
  } | null;
  fields: { id: number; name: string; description: string; type: string; options: string[]; multiple: boolean; required: boolean }[];
  links: boolean;
  importPath: boolean;
  bulk: boolean;
  quota: { limit: number | null; used: number };
};

type Asset = { key: string; id: string | null; name: string; size: number; progress: number; state: GcsAssetStatus["state"] | "sending"; scan: GcsAssetStatus["scan"]; error: string | null; source: "upload" | "link" | "path" };
type Shot = { id: string; url: string };

export type GcsDownloadFormInitial = {
  title: string;
  summary: string;
  description: unknown;
  tags: string[];
  fields: Record<string, unknown>;
  screenshots: Shot[];
  version: string;
};

/**
 * Formularul Descărcărilor: trimiterea unui fișier nou (`submit`), o versiune nouă (`version`) sau editarea detaliilor
 * (`edit`). Fișierele se încarcă imediat, pe bucăți, din popupul sistemului; după ultima bucată serverul verifică tipul
 * real și antivirusul, iar lista arată starea fiecăruia. Capturile trec prin încărcarea imaginilor (cu watermark).
 */
export function GcsDownloadForm({ mode, context, fileId = null, fileHref = null, initial }: { mode: "submit" | "version" | "edit"; context: GcsDownloadFormContext; fileId?: number | null; fileHref?: string | null; initial?: GcsDownloadFormInitial }) {
  const t = useTranslations("downloads.form");
  const tf = useTranslations("errors.fields");
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const post = useUploadPost();
  const uid = useId();
  const cat = context.category;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [description, setDescription] = useState<unknown>(initial?.description ?? "");
  const [version, setVersion] = useState(mode === "version" ? "" : (initial?.version ?? ""));
  const [changelog, setChangelog] = useState<unknown>("");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [fields, setFields] = useState<Record<string, unknown>>(initial?.fields ?? {});
  const [shots, setShots] = useState<Shot[]>(initial?.screenshots ?? []);
  const [terms, setTerms] = useState(false);
  const [separate, setSeparate] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [importable, setImportable] = useState<{ path: string; size: number }[] | null>(null);
  const [importChoice, setImportChoice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const target = { categoryId: cat?.id ?? 0, fileId };
  const withFiles = mode !== "edit";
  const withDetails = mode !== "version";

  const errText = (e: GcsChunkError) => {
    const code = Object.values(e.fields ?? {})[0] ?? e.code;
    return tf.has(code) ? tf(code, e.params ?? {}) : t.has(`errors.${code}`) ? t(`errors.${code}`) : code;
  };
  const fieldError = (key: string) => (fieldErrors[key] ? <span className="gcs-formError" role="alert">{tf.has(fieldErrors[key]!) ? tf(fieldErrors[key]!) : t.has(`errors.${fieldErrors[key]}`) ? t(`errors.${fieldErrors[key]}`) : fieldErrors[key]}</span> : null);

  // Starea verificării: sondaj cât timp un fișier e primit și așteaptă tipul real / antivirusul.
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  useEffect(() => {
    const waiting = assets.filter((a) => a.id && a.state === "received").map((a) => a.id!);
    if (waiting.length === 0) return;
    const timer = setTimeout(async () => {
      const rows = await uploadStatus(waiting);
      setAssets((list) => list.map((a) => {
        const r = rows.find((x) => x.id === a.id);
        return r ? { ...a, state: r.state, scan: r.scan, error: r.error, size: r.size } : a;
      }));
    }, 2000);
    return () => clearTimeout(timer);
  }, [assets]);

  const patch = (key: string, p: Partial<Asset>) => setAssets((list) => list.map((a) => (a.key === key ? { ...a, ...p } : a)));

  async function uploadFiles(files: File[], onProgress: (f: number) => void): Promise<string | null> {
    if (!cat) return t("errors.category");
    if (!cat.multipleFiles && assetsRef.current.length + files.length > 1) return t("errors.single");
    const total = files.reduce((s, f) => s + f.size, 0) || 1;
    let done = 0;
    let firstError: string | null = null;
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setAssets((list) => [...list, { key, id: null, name: file.name, size: file.size, progress: 0, state: "sending", scan: "pending", error: null, source: "upload" }]);
      const res = await uploadInChunks(file, target, (p) => {
        patch(key, { progress: p });
        onProgress((done + p * file.size) / total);
      });
      done += file.size;
      if (res.ok) patch(key, { id: res.id, state: "received", progress: 1 });
      else {
        const text = errText(res.error);
        patch(key, { state: "failed", error: text });
        firstError ??= text;
      }
    }
    return firstError;
  }

  async function addLink() {
    if (!cat || !linkUrl.trim()) return;
    const res = await addDownloadLinkAction({ ...target, url: linkUrl.trim() });
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    const a = res.data;
    setAssets((list) => [...list, { key: a.id, id: a.id, name: a.name, size: 0, progress: 1, state: a.state, scan: a.scan, error: null, source: "link" }]);
    setLinkUrl("");
  }

  async function loadImportable() {
    const res = await listImportableAction({});
    if (res.ok) setImportable(res.data);
    else setStatus({ ok: false, text: errorMessage(res.error) });
  }

  async function addImport() {
    if (!cat || !importChoice) return;
    const res = await importDownloadPathAction({ ...target, path: importChoice });
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    const a = res.data;
    setAssets((list) => [...list, { key: a.id, id: a.id, name: a.name, size: a.size, progress: 1, state: a.state, scan: a.scan, error: null, source: "path" }]);
    setImportChoice("");
  }

  async function removeAsset(a: Asset) {
    setAssets((list) => list.filter((x) => x.key !== a.key));
    if (a.id) await cancelUpload(a.id);
  }

  async function uploadShots(files: File[], onProgress: (f: number) => void): Promise<string | null> {
    if (!cat) return t("errors.category");
    let i = 0;
    for (const file of files) {
      if (shots.length + i >= cat.maxScreenshots) return t("errors.tooManyShots", { max: cat.maxScreenshots });
      const fd = new FormData();
      fd.set("file", file);
      if (fileId) fd.set("fileId", String(fileId));
      else fd.set("categoryId", String(cat.id));
      const res = await post<{ id: string; url: string }>("/api/downloads/screenshots", fd, (p) => onProgress((i + p) / files.length));
      if (!res.ok) return res.error;
      setShots((s) => [...s, res.data]);
      i++;
    }
    return null;
  }

  const moveShot = (index: number, dir: -1 | 1) =>
    setShots((s) => {
      const next = [...s];
      const j = index + dir;
      if (j < 0 || j >= next.length) return s;
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });

  const busy = assets.some((a) => a.state === "sending");
  const ready = assets.filter((a) => a.id && a.state !== "failed");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cat) return;
    setPending(true);
    setStatus(null);
    setFieldErrors({});
    const tagList = tags.split(",").map((x) => x.trim()).filter(Boolean);
    const assetIds = ready.map((a) => a.id!);
    let res;
    if (mode === "edit") res = await editDownloadAction({ fileId: fileId!, title, summary, description, screenshotIds: shots.map((s) => s.id), fields, tags: tagList });
    else if (mode === "version") res = await addDownloadVersionAction({ fileId: fileId!, version, changelog, assetIds, acceptTerms: terms });
    else if (separate && assetIds.length > 1) res = await submitManyDownloadsAction({ categoryId: cat.id, description, assetIds, acceptTerms: terms });
    else res = await submitDownloadAction({ categoryId: cat.id, title, summary, description, version, changelog, assetIds, screenshotIds: shots.map((s) => s.id), fields, tags: tagList, acceptTerms: terms });
    setPending(false);
    if (!res.ok) {
      setFieldErrors(res.error.fields ?? {});
      setStatus({ ok: false, text: errorMessage(res.error) });
      return;
    }
    const data = res.data as { href?: string; fileIds?: number[] } | undefined;
    if (mode === "submit") router.push(data?.href ?? "/downloads/mine");
    else router.push(fileHref ?? "/downloads/mine");
    router.refresh();
  }

  const accept = cat && cat.extensions.length > 0 ? cat.extensions.map((x) => `.${x}`) : ["*"];
  const rules = { accept, typesLabel: cat && cat.extensions.length > 0 ? cat.extensions.map((x) => x.toUpperCase()).join(", ") : t("anyType"), maxBytes: cat?.maxBytes ?? Number.MAX_SAFE_INTEGER };
  const fieldInput = (f: GcsDownloadFormContext["fields"][number]) => {
    const key = String(f.id);
    const value = fields[key];
    const set = (v: unknown) => setFields((s) => ({ ...s, [key]: v }));
    const id = `${uid}-f${f.id}`;
    if (f.type === "textarea") return <textarea id={id} className="gcs-input" rows={4} maxLength={5000} value={String(value ?? "")} onChange={(e) => set(e.target.value)} />;
    if (f.type === "checkbox") return <input id={id} type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} />;
    if (f.type === "select")
      return f.multiple ? (
        <select id={id} className="gcs-input" multiple value={Array.isArray(value) ? (value as string[]) : []} onChange={(e) => set([...e.target.selectedOptions].map((o) => o.value))}>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <select id={id} className="gcs-input" value={String(value ?? "")} onChange={(e) => set(e.target.value)}>
          <option value="">{t("choose")}</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    const type = f.type === "number" ? "number" : f.type === "url" ? "url" : f.type === "date" ? "date" : "text";
    // `member`: id-urile membrilor (co-autori), separate prin virgulă; pagina fișierului îi arată cu numele stilizate.
    if (f.type === "member") return <input id={id} className="gcs-input" value={Array.isArray(value) ? (value as string[]).join(", ") : String(value ?? "")} onChange={(e) => set(f.multiple ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : e.target.value.trim())} placeholder={t("memberIds")} />;
    return <input id={id} className="gcs-input" type={type} value={String(value ?? "")} onChange={(e) => set(e.target.value)} maxLength={255} />;
  };

  if (!cat) return null;
  const scanLabel = (a: Asset) => (a.state === "sending" ? t("state.sending", { pct: Math.round(a.progress * 100) }) : a.state === "received" ? t("state.checking") : a.state === "failed" ? (a.error ?? t("state.failed")) : t(`scan.${a.scan}`));

  return (
    <form className="gcs-dlForm" onSubmit={onSubmit} noValidate data-testid="gcs-download-form">
      {withFiles && (
        <fieldset className="gcs-settingsFieldset gcs-dlForm__files">
          <legend>{t("sections.files")}</legend>
          <p className="gcs-field__hint">
            {cat.maxBytes ? t("rulesMax", { max: formatBytes(cat.maxBytes, locale) }) : t("rulesNoMax")} · {cat.extensions.length > 0 ? t("rulesTypes", { types: cat.extensions.join(", ") }) : t("anyType")}
            {context.quota.limit !== null && ` · ${t("quota", { used: formatBytes(context.quota.used, locale), limit: formatBytes(context.quota.limit, locale) })}`}
          </p>
          <GcsUploadInput title={t("uploadTitle")} rules={rules} multiple={cat.multipleFiles} uploadMany={uploadFiles} upload={(file, onProgress) => uploadFiles([file], onProgress)} testId="gcs-download-files" />
          {assets.length > 0 && (
            <ul className="gcs-dlAssets" data-testid="gcs-download-assets">
              {assets.map((a) => (
                <li key={a.key} className="gcs-dlAsset" data-state={a.state} data-scan={a.scan} data-testid="gcs-download-asset">
                  <GcsIcon name={a.source === "link" ? "fa-solid fa-link" : a.source === "path" ? "fa-solid fa-server" : "fa-solid fa-file-zipper"} className="gcs-dlAsset__icon" />
                  <span className="gcs-dlAsset__name">{a.name}</span>
                  {a.size > 0 && <span className="gcs-dlAsset__size">{formatBytes(a.size, locale)}</span>}
                  <span className="gcs-dlAsset__state" role="status">{scanLabel(a)}</span>
                  {a.state === "sending" && <progress className="gcs-dlAsset__bar" max={1} value={a.progress} />}
                  <button type="button" className="gcs-dlIconBtn gcs-sweep" onClick={() => removeAsset(a)} aria-label={t("removeFile", { name: a.name })} title={t("removeFile", { name: a.name })}>
                    <GcsIconSvg icon={faXmark} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(context.links || context.importPath) && (
            <div className="gcs-dlForm__sources">
              {context.links && (
                <div className="gcs-dlForm__inline">
                  <label htmlFor={`${uid}-link`} className="gcs-srOnly">{t("linkLabel")}</label>
                  <input id={`${uid}-link`} className="gcs-input" type="url" placeholder="https://" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} data-testid="gcs-download-link" />
                  <GcsButton type="button" variant="ghost" icon={<GcsIconSvg icon={faLink} />} onClick={addLink}>{t("addLink")}</GcsButton>
                </div>
              )}
              {context.importPath && (
                <div className="gcs-dlForm__inline">
                  {importable === null ? (
                    <GcsButton type="button" variant="ghost" icon={<GcsIconSvg icon={faServer} />} onClick={loadImportable}>{t("fromServer")}</GcsButton>
                  ) : (
                    <>
                      <label htmlFor={`${uid}-path`} className="gcs-srOnly">{t("fromServer")}</label>
                      <select id={`${uid}-path`} className="gcs-input" value={importChoice} onChange={(e) => setImportChoice(e.target.value)}>
                        <option value="">{importable.length === 0 ? t("importEmpty") : t("choose")}</option>
                        {importable.map((f) => <option key={f.path} value={f.path}>{f.path} ({formatBytes(f.size, locale)})</option>)}
                      </select>
                      <GcsButton type="button" variant="ghost" icon={<GcsIconSvg icon={faServer} />} onClick={addImport} disabled={!importChoice}>{t("import")}</GcsButton>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {fieldError("files")}
          {mode === "submit" && context.bulk && ready.length > 1 && (
            <label className="gcs-check">
              <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
              {t("separate")}
            </label>
          )}
        </fieldset>
      )}

      {withDetails && !separate && (
        <fieldset className="gcs-settingsFieldset">
          <legend>{t("sections.details")}</legend>
          <label className="gcs-field">
            {t("title")} *
            <input className="gcs-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required data-testid="gcs-download-title" />
            {fieldError("title")}
          </label>
          <label className="gcs-field">
            {t("summary")}
            <input className="gcs-input" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={300} data-testid="gcs-download-summary" />
            <span className="gcs-field__hint">{t("summaryHint")}</span>
          </label>
          <div className="gcs-field">
            <span id={`${uid}-desc`}>{t("description")} *</span>
            <GcsRichTextInput initial={initial?.description ?? ""} allow={GCS_RICH_FIELDS.downloadText} tools={TOOLS} maxLength={20000} imageUrl labelledBy={`${uid}-desc`} onValue={setDescription} />
            {fieldError("description")}
          </div>
          {cat.tags && (
            <label className="gcs-field">
              {t("tags")}
              <input className="gcs-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("tagsPlaceholder")} />
              {fieldError("tags")}
            </label>
          )}
          {context.fields.map((f) => (
            <div key={f.id} className="gcs-field">
              <label htmlFor={`${uid}-f${f.id}`}>{f.name}{f.required ? " *" : ""}</label>
              {fieldInput(f)}
              {f.description && <span className="gcs-field__hint">{f.description}</span>}
              {fieldError(`field_${f.id}`)}
            </div>
          ))}
        </fieldset>
      )}
      {separate && withDetails && (
        <fieldset className="gcs-settingsFieldset">
          <legend>{t("sections.details")}</legend>
          <p className="gcs-field__hint">{t("separateHint")}</p>
          <div className="gcs-field">
            <span id={`${uid}-desc2`}>{t("description")} *</span>
            <GcsRichTextInput initial="" allow={GCS_RICH_FIELDS.downloadText} tools={TOOLS} maxLength={20000} labelledBy={`${uid}-desc2`} onValue={setDescription} />
          </div>
        </fieldset>
      )}

      {withFiles && cat.versioning !== "off" && !separate && (
        <fieldset className="gcs-settingsFieldset">
          <legend>{t("sections.version")}</legend>
          <label className="gcs-field">
            {t("version")}{cat.versioning === "required" ? " *" : ""}
            <input className="gcs-input" value={version} onChange={(e) => setVersion(e.target.value)} maxLength={40} placeholder="1.0.0" data-testid="gcs-download-version" />
            {fieldError("version")}
          </label>
          <div className="gcs-field">
            <span id={`${uid}-log`}>{t("changelog")}{cat.requireChangelog ? " *" : ""}</span>
            <GcsRichTextInput initial="" allow={GCS_RICH_FIELDS.downloadText} tools={["bold", "italic", "bulletList", "orderedList", "code", "link"]} maxLength={5000} compact labelledBy={`${uid}-log`} onValue={setChangelog} />
            {fieldError("changelog")}
          </div>
        </fieldset>
      )}

      {withDetails && !separate && cat.screenshots && (
        <fieldset className="gcs-settingsFieldset">
          <legend>{t("sections.screenshots")}{cat.requireScreenshots ? " *" : ""}</legend>
          <GcsUploadInput title={t("shotsTitle")} rules={UPLOAD_RULES.image(cat.screenshotMaxKb > 0 ? cat.screenshotMaxKb / 1024 : 10)} multiple uploadMany={uploadShots} upload={(file, p) => uploadShots([file], p)} testId="gcs-download-shots" />
          {shots.length > 0 && (
            <ul className="gcs-dlShots">
              {shots.map((s, i) => (
                <li key={s.id} className="gcs-dlShots__item">
                  <img src={`${s.url}?thumb=1`} alt={t("shot", { n: i + 1 })} loading="lazy" />
                  <span className="gcs-dlShots__tools">
                    <button type="button" className="gcs-dlIconBtn gcs-sweep" onClick={() => moveShot(i, -1)} disabled={i === 0} aria-label={t("shotLeft")} title={t("shotLeft")}><GcsIconSvg icon={faArrowLeft} /></button>
                    <button type="button" className="gcs-dlIconBtn gcs-sweep" onClick={() => moveShot(i, 1)} disabled={i === shots.length - 1} aria-label={t("shotRight")} title={t("shotRight")}><GcsIconSvg icon={faArrowRight} /></button>
                    <button type="button" className="gcs-dlIconBtn gcs-sweep" onClick={() => setShots((list) => list.filter((x) => x.id !== s.id))} aria-label={t("shotRemove")} title={t("shotRemove")}><GcsIconSvg icon={faXmark} /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {fieldError("screenshots")}
        </fieldset>
      )}

      {withFiles && cat.submitTerms && (
        <fieldset className="gcs-settingsFieldset">
          <legend>{t("sections.terms")}</legend>
          <div className="gcs-dlTerms">{cat.submitTerms}</div>
          <label className="gcs-check">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} data-testid="gcs-download-terms" />
            {t("acceptTerms")}
          </label>
          {fieldError("terms")}
        </fieldset>
      )}

      <div className="gcs-dlForm__actions">
        {withFiles && cat.approval && <p className="gcs-field__hint">{t("approvalHint")}</p>}
        {status && <p className={status.ok ? "gcs-formOk" : "gcs-formError"} role={status.ok ? "status" : "alert"}>{status.text}</p>}
        <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={mode === "edit" ? faFloppyDisk : faCloudArrowUp} />} disabled={pending || busy || (withFiles && ready.length === 0)} data-testid="gcs-download-submit">
          {pending ? t("saving") : t(`submit.${mode}`)}
        </GcsButton>
      </div>
    </form>
  );
}
