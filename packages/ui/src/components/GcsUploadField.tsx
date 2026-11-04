"use client";

import { faArrowUpFromBracket, faCheck, faFile, faFolderOpen, faImage, faTrash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { cx } from "../cx";
import { GcsIconSvg } from "../icons/svg";
import { GcsButton } from "./GcsButton";
import { GcsModal } from "./GcsModal";
import { checkUploadFile, formatBytes, type GcsUploadCheck, type GcsUploadRules } from "./uploadChecks";

export type GcsUploadLabels = {
  /** Butonul câmpului fără fișier / cu fișier. */
  upload: string;
  replace: string;
  remove: string;
  /** „Nicio imagine” / „Niciun fișier”. */
  noImage: string;
  noFile: string;
  dropHere: string;
  dropRelease: string;
  or: string;
  browse: string;
  paste: string;
  use: string;
  chooseOther: string;
  cancel: string;
  close: string;
  uploading: string;
  /** Regulile și verificările: `{types}`, `{max}`, `{size}`, `{w}`, `{h}`, `{min}`. */
  rulesTypes: string;
  rulesMax: string;
  rulesMin: string;
  rulesSquare: string;
  okType: string;
  okSize: string;
  okDims: string;
  okReal: string;
  errType: string;
  errSize: string;
  errMin: string;
  errMax: string;
  errSquare: string;
  errReal: string;
  errUpload: string;
  /** Mai multe fișiere odată (`multiple`): `{count}` = câte s-au ales, `{bad}` = câte nu trec. Lipsă = textele de mai sus. */
  dropHereMany?: string;
  useMany?: string;
  many?: string;
  manyBad?: string;
};

export type GcsUploadFieldProps = {
  /** Titlul popupului („Încarcă emblema”). */
  title: string;
  /** Numele câmpului din formular: fișierul ales ajunge într-un `<input type="file">` ascuns, trimis cu formularul. */
  name?: string;
  rules: GcsUploadRules;
  labels: GcsUploadLabels;
  /** Fișierul de acum (imaginea arătată în câmp). */
  current?: { url?: string | null; name?: string | null; meta?: string | null } | null;
  /** Fișierul ales (sau `null` la „Scoate”); pentru componentele care încarcă singure. */
  onFile?: (file: File | null) => void;
  /**
   * Încărcarea din popup, cu progres: întoarce `null` la succes sau mesajul erorii. Fără ea, fișierul pleacă odată cu
   * formularul (câmpul `name`).
   */
  upload?: (file: File, onProgress: (fraction: number) => void) => Promise<string | null>;
  /**
   * Popupul primește mai multe fișiere odată (tragere, alegere, lipire): fiecare e verificat, cele care nu trec se sar.
   * Fișierele bune ajung în `onFiles` / `uploadMany` (și în câmpul `name`).
   */
  multiple?: boolean;
  /** Fișierele alese cu `multiple` (sau `[]` la „Scoate”). */
  onFiles?: (files: File[]) => void;
  /** Încărcarea mai multor fișiere din popup, cu progres (`multiple`): `null` la succes sau mesajul erorii. */
  uploadMany?: (files: File[], onProgress: (fraction: number) => void) => Promise<string | null>;
  /** Butonul „Scoate” (doar dacă există un fișier și componenta știe să-l scoată). */
  onRemove?: () => void;
  disabled?: boolean;
  /** Câmpul e obligatoriu în formular. */
  required?: boolean;
  testId?: string;
  className?: string;
};

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** Textul regulilor sub zona de tragere: tipurile, mărimea maximă și dimensiunile cerute. */
export function uploadRulesText(rules: GcsUploadRules, labels: GcsUploadLabels): string {
  const parts = [fill(labels.rulesTypes, { types: rules.typesLabel }), fill(labels.rulesMax, { max: formatBytes(rules.maxBytes) })];
  if (rules.image?.minWidth || rules.image?.minHeight) parts.push(fill(labels.rulesMin, { w: rules.image.minWidth ?? 0, h: rules.image.minHeight ?? 0 }));
  if (rules.image?.square) parts.push(labels.rulesSquare);
  return parts.join(" · ");
}

/** Textul unei verificări (reușite sau nu). */
function checkText(c: GcsUploadCheck, rules: GcsUploadRules, labels: GcsUploadLabels): string {
  const vars = { types: rules.typesLabel, max: formatBytes(rules.maxBytes), size: c.size ? formatBytes(c.size) : "", w: c.width ?? 0, h: c.height ?? 0, min: `${rules.image?.minWidth ?? 0} × ${rules.image?.minHeight ?? 0}` };
  return fill(labels[c.key], vars);
}

/**
 * Câmpul de încărcare al sistemului: arată fișierul de acum (miniatura sau iconița) și un buton care deschide popupul.
 * În popup fișierul se trage, se alege din calculator sau se lipește (Ctrl+V); înainte de orice trimitere se verifică
 * tipul (după conținut, nu după nume), mărimea și dimensiunile, cu previzualizare. „Folosește” îl pune în formular
 * (sau îl încarcă, cu progres, când componenta dă `upload`).
 */
export function GcsUploadField({ title, name, rules, labels, current, onFile, upload, multiple, onFiles, uploadMany, onRemove, disabled, required, testId, className }: GcsUploadFieldProps) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<{ file: File; url: string | null } | null>(null);
  const [many, setMany] = useState<File[] | null>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const isImage = Boolean(rules.image);

  // Miniatura fișierului ales trăiește cât componenta.
  useEffect(() => () => void (chosen?.url && URL.revokeObjectURL(chosen.url)), [chosen]);

  const shownUrl = many ? null : (chosen?.url ?? current?.url ?? null);
  const shownName = many ? fill(labels.many ?? "{count}", { count: many.length }) : (chosen?.file.name ?? current?.name ?? null);
  const shownMeta = many ? formatBytes(many.reduce((sum, f) => sum + f.size, 0)) : chosen ? formatBytes(chosen.file.size) : (current?.meta ?? null);
  const has = Boolean(shownUrl || shownName);

  function accept(file: File, previewUrl: string | null) {
    setChosen({ file, url: previewUrl });
    if (name && hidden.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      hidden.current.files = dt.files;
    }
    onFile?.(file);
    setOpen(false);
  }

  function acceptMany(files: File[]) {
    setChosen(null);
    setMany(files);
    if (name && hidden.current) {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      hidden.current.files = dt.files;
    }
    onFiles?.(files);
    setOpen(false);
  }

  function clear() {
    setChosen(null);
    setMany(null);
    if (hidden.current) hidden.current.value = "";
    if (multiple) onFiles?.([]);
    else onFile?.(null);
    onRemove?.();
  }

  return (
    <div className={cx("gcs-upfield", disabled && "gcs-upfield--disabled", className)} data-testid={testId}>
      {name && <input ref={hidden} type="file" name={name} accept={rules.accept.includes("*") ? undefined : rules.accept.join(",")} multiple={multiple} required={required && !current?.url} className="gcs-upfield__input" tabIndex={-1} aria-hidden="true" data-testid={testId ? `${testId}-input` : undefined} />}
      <span className={cx("gcs-upfield__thumb", !shownUrl && "gcs-upfield__thumb--empty")} aria-hidden="true">
        {shownUrl && isImage ? <img src={shownUrl} alt="" /> : <GcsIconSvg icon={isImage ? faImage : faFile} />}
      </span>
      <span className="gcs-upfield__meta">
        <b>{shownName ?? (isImage ? labels.noImage : labels.noFile)}</b>
        <span>{shownMeta ?? uploadRulesText(rules, labels)}</span>
      </span>
      <GcsButton variant="ghost" size="sm" disabled={disabled} icon={<GcsIconSvg icon={faArrowUpFromBracket} />} onClick={() => setOpen(true)} data-testid={testId ? `${testId}-open` : undefined}>
        {has ? labels.replace : labels.upload}
      </GcsButton>
      {has && (onRemove || chosen || many) && (
        <button type="button" className="gcs-iconBtn" aria-label={labels.remove} title={labels.remove} disabled={disabled} onClick={clear}>
          <GcsIconSvg icon={faTrash} />
        </button>
      )}
      {open && <GcsUploadDialog title={title} rules={rules} labels={labels} upload={upload} multiple={multiple} uploadMany={uploadMany} onAcceptMany={acceptMany} onClose={() => setOpen(false)} onAccept={accept} testId={testId} />}
    </div>
  );
}

type DialogProps = {
  title: string;
  rules: GcsUploadRules;
  labels: GcsUploadLabels;
  upload?: GcsUploadFieldProps["upload"];
  onClose: () => void;
  onAccept: (file: File, previewUrl: string | null) => void;
  /** Mai multe fișiere odată: lista cu verificările fiecăruia; „Folosește” trimite doar fișierele bune. */
  multiple?: boolean;
  uploadMany?: GcsUploadFieldProps["uploadMany"];
  onAcceptMany?: (files: File[]) => void;
  testId?: string;
};

/** Popupul: zona de tragere, alegerea din calculator, lipirea, verificările, previzualizarea și (opțional) progresul. */
export function GcsUploadDialog({ title, rules, labels, upload, onClose, onAccept, multiple, uploadMany, onAcceptMany, testId }: DialogProps) {
  const picker = useRef<HTMLInputElement>(null);
  const browse = () => picker.current?.click();
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [checks, setChecks] = useState<GcsUploadCheck[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [many, setMany] = useState<{ file: File; checks: GcsUploadCheck[] }[]>([]);
  const isImage = Boolean(rules.image);
  const good = many.filter((m) => m.checks.every((c) => c.ok)).map((m) => m.file);
  const picked = multiple ? many.length > 0 : file !== null;
  const ok = multiple ? good.length > 0 : file !== null && checks.length > 0 && checks.every((c) => c.ok);

  async function take(next: File | undefined | null) {
    if (!next) return;
    setError(null);
    setProgress(null);
    if (preview) URL.revokeObjectURL(preview);
    const url = isImage ? URL.createObjectURL(next) : null;
    setFile(next);
    setPreview(url);
    setChecks(await checkUploadFile(next, rules));
  }

  async function takeMany(list: File[]) {
    if (list.length === 0) return;
    setError(null);
    setProgress(null);
    setMany(await Promise.all(list.map(async (f) => ({ file: f, checks: await checkUploadFile(f, rules) }))));
  }

  /** Fișierele trase, alese sau lipite: toate cu `multiple`, altfel primul. */
  function takeList(list: FileList | File[] | null | undefined) {
    const files = list ? [...list] : [];
    if (multiple) void takeMany(files);
    else void take(files[0]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    takeList(e.dataTransfer.files);
  }

  function onPaste(e: ClipboardEvent) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length > 0) {
      e.preventDefault();
      takeList(pasted);
    }
  }

  async function acceptAll() {
    if (!ok) return;
    if (!uploadMany) {
      onAcceptMany?.(good);
      return;
    }
    setProgress(0);
    const err = await uploadMany(good, setProgress);
    if (err) {
      setProgress(null);
      setError(err || labels.errUpload);
      return;
    }
    onAcceptMany?.(good);
  }

  async function use() {
    if (multiple) return acceptAll();
    if (!file || !ok) return;
    if (!upload) {
      onAccept(file, preview);
      return;
    }
    setProgress(0);
    const err = await upload(file, setProgress);
    if (err) {
      setProgress(null);
      setError(err || labels.errUpload);
      return;
    }
    onAccept(file, preview);
  }

  return (
    <GcsModal title={title} icon={<GcsIconSvg icon={faArrowUpFromBracket} />} onClose={onClose} closeLabel={labels.close} className="gcs-updialog">
      <div className="gcs-updialog__body" onPaste={onPaste} data-testid={testId ? `${testId}-dialog` : "gcs-upload-dialog"}>
        {multiple && many.length > 0 ? (
          <div className="gcs-updialog__many">
            <ul className="gcs-updialog__manyList" data-testid={testId ? `${testId}-list` : undefined}>
              {many.map((m, i) => {
                const bad = m.checks.find((c) => !c.ok);
                return (
                  <li key={`${i}-${m.file.name}`} className={bad ? "gcs-updialog__bad" : "gcs-updialog__ok"} data-check={bad?.key ?? "ok"}>
                    <GcsIconSvg icon={bad ? faTriangleExclamation : faCheck} />
                    <b>{m.file.name}</b>
                    <span>{bad ? checkText(bad, rules, labels) : formatBytes(m.file.size)}</span>
                  </li>
                );
              })}
            </ul>
            {good.length < many.length && <p className="gcs-updialog__manyNote">{fill(labels.manyBad ?? "{bad} / {count}", { bad: many.length - good.length, count: many.length })}</p>}
          </div>
        ) : !multiple && file && checks.length > 0 ? (
          <div className="gcs-updialog__preview">
            <span className="gcs-updialog__pv" aria-hidden="true">
              {preview ? <img src={preview} alt="" /> : <GcsIconSvg icon={faFile} />}
            </span>
            <ul className="gcs-updialog__checks" aria-label={file.name}>
              <li className="gcs-updialog__file">
                <b>{file.name}</b>
              </li>
              {checks.map((c) => (
                <li key={c.key} className={c.ok ? "gcs-updialog__ok" : "gcs-updialog__bad"} data-check={c.key}>
                  <GcsIconSvg icon={c.ok ? faCheck : faTriangleExclamation} />
                  {checkText(c, rules, labels)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div
            className={cx("gcs-updialog__drop", over && "gcs-updialog__drop--over")}
            onClick={browse}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <span className="gcs-updialog__big" aria-hidden="true">
              <GcsIconSvg icon={faArrowUpFromBracket} />
            </span>
            <b>{over ? labels.dropRelease : multiple ? (labels.dropHereMany ?? labels.dropHere) : labels.dropHere}</b>
            <span className="gcs-muted">{labels.or}</span>
            <GcsButton
              variant="ghost"
              size="sm"
              icon={<GcsIconSvg icon={faFolderOpen} />}
              onClick={(e) => {
                e.stopPropagation();
                browse();
              }}
              data-testid={testId ? `${testId}-browse` : "gcs-upload-browse"}
            >
              {labels.browse}
            </GcsButton>
          </div>
        )}
        <input
          ref={picker}
          type="file"
          accept={rules.accept.includes("*") ? undefined : rules.accept.join(",")}
          multiple={multiple}
          className="gcs-srOnly"
          onChange={(e) => {
            takeList(e.target.files);
            e.target.value = "";
          }}
          data-testid={testId ? `${testId}-pick` : "gcs-upload-pick"}
        />
        <p className="gcs-updialog__rules">
          {uploadRulesText(rules, labels)}. {labels.paste}
        </p>
        {progress !== null && (
          <div className="gcs-updialog__bar" role="progressbar" aria-label={labels.uploading} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {error && (
          <p role="alert" className="gcs-updialog__error">
            <GcsIconSvg icon={faTriangleExclamation} /> {error}
          </p>
        )}
        <div className="gcs-updialog__actions">
          {picked ? (
            <GcsButton variant="ghost" onClick={browse}>
              {labels.chooseOther}
            </GcsButton>
          ) : (
            <GcsButton variant="ghost" onClick={onClose}>
              {labels.cancel}
            </GcsButton>
          )}
          <GcsButton variant="primary" disabled={!ok} loading={progress !== null} icon={<GcsIconSvg icon={faCheck} />} onClick={() => void use()} data-testid={testId ? `${testId}-use` : "gcs-upload-use"}>
            {multiple ? (labels.useMany ?? labels.use) : labels.use}
          </GcsButton>
        </div>
      </div>
    </GcsModal>
  );
}
