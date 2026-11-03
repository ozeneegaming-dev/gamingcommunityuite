"use client";

import { faImage } from "@fortawesome/free-regular-svg-icons";
import { faUpload, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

/** Modurile zonei de imagine a cardului (aceleași ca `GCS_FORUM_PREVIEW_MODES` din `@gcs/modules`). */
const MODES = ["auto", "image", "color"] as const;
type Mode = (typeof MODES)[number];
/** Forma cardului: zona de imagine e de 16 : 7. */
const CARD = 16 / 7;
const STEP = 5;

export type GcsForumPreviewLabels = {
  legend: string;
  hint: string;
  modes: Record<Mode, { label: string; help: string }>;
  upload: string;
  replace: string;
  remove: string;
  uploading: string;
  empty: string;
  crop: string;
  cropHint: string;
  result: string;
  autoNote: string;
};

/**
 * Imaginea de previzualizare a cardului unui forum (ACP › Forumuri › Editează, macheta „Carduri de forum”): modul (automat
 * din ultima postare, imaginea mea, doar culoarea forumului), încărcarea (prin `/api/acp/forum-preview`, ca fișier
 * decorativ al forumului) și decupajul la forma cardului (16 : 7). Imaginea rămâne întreagă: se salvează doar punctul
 * de focalizare, aplicat pe card cu `object-fit: cover` + `object-position`. Chenarul de decupaj se trage cu mouse-ul
 * (sau un click îl mută acolo) ori se mută din săgeți. Valorile intră în formular prin câmpurile ascunse.
 */
export function GcsForumPreviewField({ forumId, initial, labels }: { forumId: number; initial: { mode: Mode; imageId: string | null; focusX: number; focusY: number }; labels: GcsForumPreviewLabels }) {
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [imageId, setImageId] = useState(initial.imageId ?? "");
  const [focus, setFocus] = useState({ x: initial.focusX, y: initial.focusY });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GcsErrorPayload | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const message = useErrorMessage();

  const send = async (picked: File) => {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", picked);
    body.set("forumId", String(forumId));
    try {
      const res = await fetch("/api/acp/forum-preview", { method: "POST", body });
      const result = (await res.json()) as GcsResult<{ id: string; url: string }>;
      if (result.ok) {
        setImageId(result.data.id);
        setNatural(null);
        setFocus({ x: 50, y: 50 });
      } else setError(result.error);
    } catch {
      setError({ code: "network", status: 0 });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  // Chenarul de decupaj, ca fracții din imagine: o imagine mai lată decât cardul se decupează pe orizontală, una mai
  // înaltă pe verticală (chenarul are mereu forma cardului și cea mai mare mărime care încape).
  const aspect = natural ? natural.w / natural.h : CARD;
  const axis: "x" | "y" = aspect >= CARD ? "x" : "y";
  const win = axis === "x" ? { w: CARD / aspect, h: 1 } : { w: 1, h: aspect / CARD };
  const value = axis === "x" ? focus.x : focus.y;
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
  const setValue = (v: number) => setFocus((f) => (axis === "x" ? { ...f, x: clamp(v) } : { ...f, y: clamp(v) }));

  /** Centrul chenarului sub cursor: focalizarea care îl așază acolo. */
  const place = (e: PointerEvent<HTMLDivElement>) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    const free = axis === "x" ? 1 - win.w : 1 - win.h;
    if (free <= 0.001) return;
    const center = axis === "x" ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height;
    const half = (axis === "x" ? win.w : win.h) / 2;
    setValue(((center - half) / free) * 100);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = axis === "x" ? { ArrowLeft: -STEP, ArrowRight: STEP } : { ArrowUp: -STEP, ArrowDown: STEP };
    if (e.key in keys) setValue(value + keys[e.key]!);
    else if (e.key === "Home") setValue(0);
    else if (e.key === "End") setValue(100);
    else return;
    e.preventDefault();
  };

  const position = `${focus.x}% ${focus.y}%`;
  return (
    <fieldset className="gcs-acpFieldset gcs-forumPreview" data-testid="gcs-forum-preview">
      <legend>{labels.legend}</legend>
      <p className="gcs-muted gcs-acpHint">{labels.hint}</p>
      <div className="gcs-forumPreview__modes" role="radiogroup" aria-label={labels.legend}>
        {MODES.map((m) => (
          <label key={m} className="gcs-forumPreview__mode">
            <input type="radio" name="previewMode" value={m} checked={mode === m} onChange={() => setMode(m)} data-testid={`gcs-forum-preview-mode-${m}`} />
            <span>
              {labels.modes[m].label}
              <small className="gcs-muted">{labels.modes[m].help}</small>
            </span>
          </label>
        ))}
      </div>

      <input type="hidden" name="previewImageId" value={imageId} readOnly />
      <input type="hidden" name="previewFocusX" value={focus.x} readOnly />
      <input type="hidden" name="previewFocusY" value={focus.y} readOnly />

      <div className="gcs-forumPreview__editor">
        {imageId ? (
          <div
            ref={frame}
            className="gcs-forumPreview__frame"
            style={{ aspectRatio: String(aspect), width: `min(100%, ${Math.round(300 * aspect)}px)` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              place(e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) place(e);
            }}
          >
            <img src={`/files/${imageId}`} alt="" draggable={false} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 16, h: e.currentTarget.naturalHeight || 7 })} data-testid="gcs-forum-preview-image" />
            <div
              className="gcs-forumPreview__crop"
              style={{ left: `${(1 - win.w) * focus.x}%`, top: `${(1 - win.h) * focus.y}%`, width: `${win.w * 100}%`, height: `${win.h * 100}%` }}
              role="slider"
              tabIndex={0}
              aria-label={labels.crop}
              aria-orientation={axis === "x" ? "horizontal" : "vertical"}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
              onKeyDown={onKey}
              data-testid="gcs-forum-preview-crop"
            />
          </div>
        ) : (
          <div className="gcs-forumPreview__frame gcs-forumPreview__frame--empty">
            <GcsIconSvg icon={faImage} />
            <span>{labels.empty}</span>
          </div>
        )}
        {imageId && (
          <div className="gcs-forumPreview__result" aria-hidden="true" title={labels.result}>
            <img src={`/files/${imageId}`} alt="" style={{ objectPosition: position }} />
          </div>
        )}
      </div>
      {imageId && <p className="gcs-muted gcs-acpHint">{labels.cropHint}</p>}

      <div className="gcs-forumPreview__tools">
        <input
          ref={file}
          type="file"
          className="gcs-srOnly"
          accept="image/png,image/webp,image/gif,image/jpeg,image/svg+xml,.svg"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void send(picked);
          }}
          data-testid="gcs-forum-preview-file"
          tabIndex={-1}
        />
        <GcsButton type="button" variant="ghost" size="sm" loading={busy} disabled={busy} onClick={() => file.current?.click()} icon={<GcsIconSvg icon={faUpload} />} data-testid="gcs-forum-preview-upload">
          {busy ? labels.uploading : imageId ? labels.replace : labels.upload}
        </GcsButton>
        {imageId && (
          <GcsButton type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setImageId("")} icon={<GcsIconSvg icon={faXmark} />} data-testid="gcs-forum-preview-remove">
            {labels.remove}
          </GcsButton>
        )}
        {error && (
          <span className="gcs-field__error" role="alert">
            {message(error)}
          </span>
        )}
      </div>
      {imageId && mode === "auto" && <p className="gcs-muted gcs-acpHint">{labels.autoNote}</p>}
    </fieldset>
  );
}
