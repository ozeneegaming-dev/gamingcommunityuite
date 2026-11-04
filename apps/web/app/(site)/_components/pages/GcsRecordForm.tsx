"use client";

import type { GcsPagesFieldDef } from "@gcs/modules";
import { GcsButton } from "@gcs/ui";
import { GcsEditor, type GcsEditorBlock, type GcsEditorHandle } from "@gcs/ui/editor";
import { GcsIcon } from "@/lib/pages-icons";
import type { JSONContent } from "@tiptap/core";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { useUploadPost } from "@/lib/upload-request";
import { useErrorMessage } from "@/lib/use-error-message";
import { submitPagesRecord, updatePagesRecord } from "../../pages-actions";
import { useBlockLabels, useEditorLabels } from "../topic/useEditorLabels";

type FileValue = { id: string; url: string; name: string } | null;

/**
 * Fișierele câmpurilor „fișier” (config-uri, arhive, documente): verificarea finală (tipul real, extensiile permise din
 * ACP › Fișiere) o face serverul.
 */
const FILE_ACCEPT = ["application/*", "text/*", "image/*", "audio/*", "video/*", ".cfg", ".txt", ".ini", ".json", ".xml", ".lua", ".zip", ".rar", ".7z", ".sp", ".smx", ".amxx", ".sma", ".dem"];
export type GcsRecordFormInitial = {
  recordId: number;
  title: string;
  categoryId: number | null;
  content: JSONContent | null;
  image: FileValue;
  /** Valorile câmpurilor (fișierele cu numele lor, membrii cu numele). */
  fields: Record<string, string | number | boolean | string[]>;
  files: Record<string, FileValue>;
  featured: boolean;
  pinned: boolean;
};

type Props = {
  databaseId: number;
  noun: string;
  fields: GcsPagesFieldDef[];
  categories: { id: number; name: string; depth: number }[];
  /** Categoria aleasă dinainte (`?c=` din linkul „Adaugă” al unei categorii). */
  categoryId: number | null;
  recordImage: boolean;
  blocks: GcsEditorBlock[];
  servers: { id: number; name: string }[];
  staff: boolean;
  /** Aprobarea: trimiterea ajunge în coada staff-ului (textul de sub buton). */
  needsApproval: boolean;
  initial?: GcsRecordFormInitial;
  cancelHref: string;
};

/**
 * Formularul unei înregistrări (trimitere sau editare): titlul, categoria, conținutul (editorul comun, cu @mențiuni,
 * încărcări și blocurile permise), imaginea (popupul de încărcare) și câmpurile bazei, pe tipuri, în secțiuni. Erorile
 * vin pe câmp. Staff-ul are și „Recomandată” / „Fixată”.
 */
export function GcsRecordForm(props: Props) {
  const t = useTranslations("pages.form");
  const labels = useEditorLabels();
  const blockLabels = useBlockLabels();
  const errorMessage = useErrorMessage();
  const post = useUploadPost();
  const router = useRouter();
  const editor = useRef<GcsEditorHandle>(null);
  const init = props.initial;
  const [title, setTitle] = useState(init?.title ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(init?.categoryId ?? props.categoryId);
  const [image, setImage] = useState<FileValue>(init?.image ?? null);
  const [values, setValues] = useState<Record<string, string | number | boolean | string[]>>(init?.fields ?? {});
  const [files, setFiles] = useState<Record<string, FileValue>>(init?.files ?? {});
  const [featured, setFeatured] = useState(init?.featured ?? false);
  const [pinned, setPinned] = useState(init?.pinned ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tf = useTranslations("errors.fields");
  const fieldError = (key: string) =>
    errors[key] ? (
      <span className="gcs-formError" role="alert" data-testid={`gcs-pages-error-${key.replace(".", "-")}`}>
        {tf.has(errors[key]!) ? tf(errors[key]!) : errors[key]}
      </span>
    ) : null;

  async function upload(file: File, onProgress: (fraction: number) => void): Promise<{ ok: true; data: { id: string; url: string; filename: string } } | { ok: false; error: string }> {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("forumId", String(props.databaseId));
    return post<{ id: string; url: string; filename: string }>("/api/pages/uploads", fd, onProgress);
  }

  const set = (key: string, v: string | number | boolean | string[]) => setValues((cur) => ({ ...cur, [key]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editor.current) return;
    setPending(true);
    setErrors({});
    setFormError(null);
    const fieldValues: Record<string, string | number | boolean | string[]> = {};
    for (const f of props.fields) {
      if (f.type === "image" || f.type === "file") {
        const v = files[f.key];
        if (v) fieldValues[f.key] = v.id;
      } else if (values[f.key] !== undefined) fieldValues[f.key] = values[f.key]!;
    }
    const input = {
      title,
      categoryId,
      content: editor.current.isEmpty() ? null : editor.current.getJSON(),
      imageId: image?.id ?? null,
      fields: fieldValues,
      ...(props.staff ? { featured, pinned } : {}),
    };
    const res = init ? await updatePagesRecord({ recordId: init.recordId, input }) : await submitPagesRecord({ databaseId: props.databaseId, input });
    setPending(false);
    if (!res.ok) {
      if (res.error.fields) setErrors(res.error.fields);
      setFormError(errorMessage(res.error));
      return;
    }
    editor.current.clear();
    router.push(res.data.href);
    router.refresh();
  }

  const fileField = (key: string, kind: "image" | "file", value: FileValue, onChange: (v: FileValue) => void, label: string) => (
    <GcsUploadInput
      title={label}
      rules={kind === "image" ? UPLOAD_RULES.image(10) : { accept: FILE_ACCEPT, typesLabel: t("fileTypes"), maxBytes: 100 * 1024 * 1024 }}
      current={value ? { url: kind === "image" ? value.url : null, name: value.name } : null}
      upload={async (file, onProgress) => {
        const res = await upload(file, onProgress);
        if (!res.ok) return res.error;
        onChange({ id: res.data.id, url: res.data.url, name: res.data.filename });
        return null;
      }}
      onRemove={() => onChange(null)}
      testId={`gcs-pages-upload-${key}`}
    />
  );

  const top = props.fields.filter((f) => f.position === "top");
  const bottom = props.fields.filter((f) => f.position !== "top");
  const renderField = (f: GcsPagesFieldDef) => {
    const id = `gcs-pg-f-${f.key}`;
    const v = values[f.key];
    const common = { id, "aria-describedby": f.help ? `${id}-help` : undefined };
    let control;
    switch (f.type) {
      case "textarea":
        control = <textarea {...common} className="gcs-input" rows={5} maxLength={5000} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} required={f.required} />;
        break;
      case "code":
        control = <textarea {...common} className="gcs-input gcs-pgCodeInput" rows={8} spellCheck={false} maxLength={20000} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} required={f.required} />;
        break;
      case "number":
        control = <input {...common} className="gcs-input" type="number" step="any" value={v === undefined ? "" : String(v)} onChange={(e) => set(f.key, e.target.value)} required={f.required} />;
        break;
      case "date":
        control = <input {...common} className="gcs-input" type="date" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} required={f.required} />;
        break;
      case "url":
      case "youtube":
        control = <input {...common} className="gcs-input" type="url" inputMode="url" placeholder="https://" maxLength={500} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} required={f.required} />;
        break;
      case "select":
        control = (
          <select {...common} className="gcs-input" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} required={f.required}>
            <option value="">{t("choose")}</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
        break;
      case "server":
        control = (
          <select {...common} className="gcs-input" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} required={f.required}>
            <option value="">{t("choose")}</option>
            {props.servers.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        );
        break;
      case "multiselect": {
        const list = Array.isArray(v) ? v : [];
        control = (
          <span className="gcs-pgChecks" role="group" aria-labelledby={`${id}-label`}>
            {f.options.map((o) => (
              <label key={o} className="gcs-check">
                <input type="checkbox" checked={list.includes(o)} onChange={(e) => set(f.key, e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
                {o}
              </label>
            ))}
          </span>
        );
        break;
      }
      case "checkbox":
        control = (
          <label className="gcs-toggleRow">
            <span>{t("yes")}</span>
            <input {...common} type="checkbox" checked={v === true} onChange={(e) => set(f.key, e.target.checked)} />
          </label>
        );
        break;
      case "image":
      case "file":
        control = fileField(f.key, f.type, files[f.key] ?? null, (nv) => setFiles((cur) => ({ ...cur, [f.key]: nv })), f.label);
        break;
      case "member":
        control = <input {...common} className="gcs-input" maxLength={40} placeholder={t("memberPlaceholder")} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} required={f.required} />;
        break;
      default:
        control = <input {...common} className="gcs-input" maxLength={200} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} required={f.required} />;
    }
    return (
      <div key={f.key} className="gcs-field" data-field-type={f.type}>
        <label className="gcs-field__label" htmlFor={id} id={`${id}-label`}>
          {f.label}
          {f.required && <span className="gcs-field__req" aria-hidden="true"> *</span>}
        </label>
        {control}
        {f.help && (
          <span className="gcs-field__hint" id={`${id}-help`}>
            {f.help}
          </span>
        )}
        {fieldError(`field.${f.key}`)}
      </div>
    );
  };

  return (
    <form className="gcs-card gcs-formCard gcs-pgForm" onSubmit={onSubmit} data-testid="gcs-pages-form" noValidate>
      <fieldset className="gcs-formSec">
        <legend>{t("basics", { noun: props.noun })}</legend>
        <div className="gcs-field">
          <label className="gcs-field__label" htmlFor="gcs-pg-title">
            {t("title")}
          </label>
          <input id="gcs-pg-title" className="gcs-input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={150} required data-testid="gcs-pages-title" />
          {fieldError("title")}
        </div>
        {props.categories.length > 0 && (
          <div className="gcs-field">
            <label className="gcs-field__label" htmlFor="gcs-pg-cat">
              {t("category")}
            </label>
            <select id="gcs-pg-cat" className="gcs-input" value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t("noCategory")}</option>
              {props.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {"— ".repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </select>
            {fieldError("categoryId")}
          </div>
        )}
        {props.recordImage && (
          <div className="gcs-field">
            <span className="gcs-field__label">{t("image")}</span>
            {fileField("image", "image", image, setImage, t("image"))}
          </div>
        )}
      </fieldset>

      {top.length > 0 && (
        <fieldset className="gcs-formSec">
          <legend>{t("details")}</legend>
          <div className="gcs-formGrid gcs-formGrid--2">{top.map(renderField)}</div>
        </fieldset>
      )}

      <div className="gcs-field">
        <span className="gcs-field__label" id="gcs-pg-content">
          {t("content")}
        </span>
        <GcsEditor
          ref={editor}
          id="gcs-pg-editor"
          labelledBy="gcs-pg-content"
          labels={labels}
          forumId={props.databaseId}
          uploadUrl="/api/pages/uploads"
          mentionUrl="/api/forums/mentions"
          initialContent={init?.content ?? null}
          {...(init ? {} : { draftKey: `pages-record-${props.databaseId}` })}
          blocks={props.blocks}
          blockLabels={blockLabels}
        />
        {fieldError("content")}
      </div>

      {bottom.length > 0 && (
        <fieldset className="gcs-formSec">
          <legend>{t("fields")}</legend>
          <div className="gcs-formGrid gcs-formGrid--2">{bottom.map(renderField)}</div>
        </fieldset>
      )}

      {props.staff && (
        <fieldset className="gcs-formSec">
          <legend>{t("staff")}</legend>
          <label className="gcs-toggleRow">
            <span>{t("featured")}</span>
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
          </label>
          <label className="gcs-toggleRow">
            <span>{t("pinned")}</span>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          </label>
        </fieldset>
      )}

      {formError && (
        <p className="gcs-formError" role="alert" data-testid="gcs-pages-form-error">
          {formError}
        </p>
      )}
      <div className="gcs-pgForm__actions">
        <a className="gcs-btn gcs-btn--ghost" href={props.cancelHref}>
          {t("cancel")}
        </a>
        <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIcon name={init ? "fa-solid fa-floppy-disk" : "fa-solid fa-paper-plane"} />} data-testid="gcs-pages-save">
          {init ? t("save") : props.needsApproval ? t("submitForReview") : t("publish")}
        </GcsButton>
      </div>
      {!init && props.needsApproval && <p className="gcs-muted gcs-pgForm__note">{t("approvalNote")}</p>}
    </form>
  );
}
