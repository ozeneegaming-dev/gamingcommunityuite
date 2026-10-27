"use client";

import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import { GcsButton } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { useRef, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

/** Unde se încarcă imaginea: ținta (forumul sau amplasarea widget-ului), extensia, tabul și câmpul (limitele le știe serverul). */
export type GcsExtImageUpload = { scope: "forum" | "widget"; id: number; extension: string; tab: string; field: string };

type Labels = { upload: string; replace: string; remove: string; uploading: string; preview: string };

/**
 * Un câmp imagine dintr-un tab contribuit (Aspect forumuri): încărcarea pleacă imediat spre `/api/decor-image` (stocarea
 * platformei: WebP, SVG curățat), iar id-ul fișierului intră în câmpul ascuns, salvat cu formularul. Schimbarea anunță
 * formularul (`input`), ca previzualizarea live să se actualizeze.
 */
export function GcsExtImageField({ name, value, upload, labels, hint, testId }: { name: string; value: string; upload: GcsExtImageUpload; labels: Labels; hint?: string; testId?: string }) {
  const [id, setId] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GcsErrorPayload | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const message = useErrorMessage();

  const change = (next: string) => {
    setId(next);
    // Câmpul ascuns primește valoarea înainte de eveniment (previzualizarea citește formularul).
    if (hidden.current) {
      hidden.current.value = next;
      hidden.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const send = async (picked: File) => {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", picked);
    for (const [k, v] of Object.entries(upload)) body.set(k, String(v));
    try {
      const res = await fetch("/api/decor-image", { method: "POST", body });
      const result = (await res.json()) as GcsResult<{ id: string; url: string }>;
      if (result.ok) change(result.data.id);
      else setError(result.error);
    } catch {
      setError({ code: "network", status: 0 });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="gcs-extImage" data-testid={testId}>
      <input ref={hidden} type="hidden" name={name} defaultValue={value} />
      <span className="gcs-extImage__preview" aria-hidden={id ? undefined : true}>
        {id ? <img src={`/files/${id}`} alt={labels.preview} /> : <GcsIcon name="fa-regular fa-image" />}
      </span>
      <span className="gcs-extImage__tools">
        <input
          ref={file}
          type="file"
          className="gcs-srOnly"
          accept="image/png,image/webp,image/gif,image/jpeg,image/svg+xml,.svg"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void send(picked);
          }}
          data-testid={testId ? `${testId}-file` : undefined}
          tabIndex={-1}
        />
        <GcsButton type="button" variant="ghost" size="sm" loading={busy} disabled={busy} onClick={() => file.current?.click()} icon={<GcsIcon name="fa-solid fa-upload" />} data-testid={testId ? `${testId}-upload` : undefined}>
          {busy ? labels.uploading : id ? labels.replace : labels.upload}
        </GcsButton>
        {id && (
          <GcsButton type="button" variant="ghost" size="sm" disabled={busy} onClick={() => change("")} icon={<GcsIcon name="fa-solid fa-xmark" />} data-testid={testId ? `${testId}-remove` : undefined}>
            {labels.remove}
          </GcsButton>
        )}
        {hint && <span className="gcs-muted gcs-acpHint">{hint}</span>}
        {error && (
          <span className="gcs-field__error" role="alert">
            {message(error)}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Un gradient din două culori și un unghi (Aspect forumuri): valoarea compusă (`linear-gradient(90deg, #A, #B)`) stă în
 * câmpul ascuns; gol = fără gradient.
 */
export function GcsExtGradientField({ name, value, labels, testId }: { name: string; value: string; labels: { from: string; to: string; angle: string; none: string }; testId?: string }) {
  const parsed = /^linear-gradient\((\d{1,3})deg, (#[0-9A-F]{6}), (#[0-9A-F]{6})\)$/i.exec(value);
  const [on, setOn] = useState(parsed !== null);
  const [from, setFrom] = useState(parsed?.[2] ?? "#FF6A3D");
  const [to, setTo] = useState(parsed?.[3] ?? "#FFD36A");
  const [angle, setAngle] = useState(parsed ? Number(parsed[1]) : 90);
  const hidden = useRef<HTMLInputElement>(null);
  const composed = on ? `linear-gradient(${angle}deg, ${from.toUpperCase()}, ${to.toUpperCase()})` : "";

  const update = (fn: () => void) => {
    fn();
    queueMicrotask(() => hidden.current?.dispatchEvent(new Event("input", { bubbles: true })));
  };

  return (
    <div className="gcs-extGradient" data-testid={testId}>
      <input ref={hidden} type="hidden" name={name} value={composed} readOnly />
      <label className="gcs-check">
        <input type="checkbox" checked={!on} onChange={(e) => update(() => setOn(!e.target.checked))} />
        {labels.none}
      </label>
      {on && (
        <span className="gcs-extGradient__row">
          <span className="gcs-extGradient__swatch" style={{ backgroundImage: composed }} aria-hidden="true" />
          <label>
            <span className="gcs-srOnly">{labels.from}</span>
            <input type="color" value={from} onChange={(e) => update(() => setFrom(e.target.value))} title={labels.from} data-testid={testId ? `${testId}-from` : undefined} />
          </label>
          <label>
            <span className="gcs-srOnly">{labels.to}</span>
            <input type="color" value={to} onChange={(e) => update(() => setTo(e.target.value))} title={labels.to} data-testid={testId ? `${testId}-to` : undefined} />
          </label>
          <label className="gcs-extGradient__angle">
            {labels.angle}
            <input className="gcs-input" type="number" min={0} max={360} step={15} value={angle} onChange={(e) => update(() => setAngle(Math.max(0, Math.min(360, Number(e.target.value) || 0))))} />
          </label>
        </span>
      )}
    </div>
  );
}
