"use client";

import { useEffect, useRef, useState } from "react";

/** Schița formularului ca text sigur pentru URL (base64url din JSON UTF-8). */
function encodeDraft(form: HTMLFormElement): string {
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form).entries()) if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  const bytes = new TextEncoder().encode(JSON.stringify(values));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Labels = { title: string; dark: string; light: string; unread: string; hint: string };

/**
 * Previzualizarea live a unui tab de aspect (Aspect forumuri): un `iframe` cu rândul și banda (sau widget-ul) desenate de
 * site cu valorile încă nesalvate ale formularului de lângă, în tema închisă sau deschisă. Se reîncarcă la fiecare
 * schimbare (cu o mică pauză); nimic nu ajunge pe site până la „Salvează”.
 */
export function GcsAspectPreview({ base, themes, labels, unreadToggle = false }: { base: string; themes: { dark: string; light: string }; labels: Labels; unreadToggle?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    const form = box.current?.closest("[data-aspect-card]")?.querySelector("form");
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setDraft(encodeDraft(form)), 350);
    };
    setDraft(encodeDraft(form));
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, []);

  const src = `${base}&draft=${draft}&gcs-theme-preview=${encodeURIComponent(themes[theme])}${unread ? "&unread=1" : ""}`;
  return (
    <div ref={box} className="gcs-aspectPreview" data-testid="gcs-aspect-preview">
      <div className="gcs-aspectPreview__bar">
        <strong>{labels.title}</strong>
        <span className="gcs-seg__group" role="group" aria-label={labels.title}>
          {(["dark", "light"] as const).map((m) => (
            <button key={m} type="button" className={`gcs-seg gcs-sweep${theme === m ? " gcs-seg--active" : ""}`} aria-pressed={theme === m} onClick={() => setTheme(m)} data-testid={`gcs-aspect-preview-${m}`}>
              {labels[m]}
            </button>
          ))}
        </span>
        {unreadToggle && (
          <label className="gcs-check">
            <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} />
            {labels.unread}
          </label>
        )}
      </div>
      {draft !== "" && <iframe src={src} title={labels.title} className="gcs-aspectPreview__frame" data-testid="gcs-aspect-preview-frame" />}
      <p className="gcs-muted gcs-acpHint">{labels.hint}</p>
    </div>
  );
}
