"use client";

import { useEffect, useRef, useState } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";

/** Unde se încarcă imaginea: ținta (forumul sau amplasarea widget-ului), extensia, tabul și câmpul (limitele le știe serverul). */
export type GcsExtImageUpload = { scope: "forum" | "widget"; id: number; extension: string; tab: string; field: string };

type Labels = { upload: string; replace: string; remove: string; uploading: string; preview: string };

/**
 * Un câmp imagine dintr-un tab contribuit (Aspect forumuri): popupul sistemului verifică fișierul (tipurile stocării
 * decorative, inclusiv SVG, și mărimea `maxKb` a câmpului declarat), apoi încărcarea pleacă imediat spre
 * `/api/decor-image` (WebP, SVG curățat), cu progres, iar id-ul fișierului intră în câmpul ascuns, salvat cu formularul.
 * Schimbarea anunță formularul (`input`), ca previzualizarea live să se actualizeze.
 */
export function GcsExtImageField({
  name,
  value,
  upload,
  labels,
  title,
  maxKb,
  hint,
  testId,
}: {
  name: string;
  value: string;
  upload: GcsExtImageUpload;
  labels: Labels;
  /** Titlul popupului (numele câmpului). */
  title: string;
  /** Mărimea maximă a câmpului declarat (KB), aceeași pe care o aplică serverul. */
  maxKb: number;
  hint?: string;
  testId?: string;
}) {
  const [id, setId] = useState(value);
  const hidden = useRef<HTMLInputElement>(null);
  const post = useUploadPost();

  const first = useRef(true);
  // Câmpul ascuns e controlat (altfel React l-ar readuce la valoarea inițială la randare); după fiecare schimbare,
  // formularul primește `input`, ca previzualizarea live să citească noua valoare.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [id]);

  const send = async (picked: File, onProgress: (fraction: number) => void): Promise<string | null> => {
    const body = new FormData();
    body.set("file", picked);
    for (const [k, v] of Object.entries(upload)) body.set(k, String(v));
    const res = await post<{ id: string; url: string }>("/api/decor-image", body, onProgress);
    if (!res.ok) return res.error;
    setId(res.data.id);
    return null;
  };

  const rules = {
    ...UPLOAD_RULES.image(maxKb / 1024),
    accept: ["image/png", "image/webp", "image/gif", "image/jpeg", "image/svg+xml"],
    typesLabel: "PNG, WebP, GIF, JPG, SVG",
  };

  return (
    <div className="gcs-extImageField" data-testid={testId}>
      <input ref={hidden} type="hidden" name={name} value={id} readOnly />
      <GcsUploadInput
        title={title}
        rules={rules}
        current={id ? { url: `/files/${id}`, name: labels.preview } : null}
        upload={send}
        onRemove={() => setId("")}
        {...(testId ? { testId: `${testId}-file` } : {})}
      />
      {hint && <span className="gcs-muted gcs-acpHint">{hint}</span>}
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
