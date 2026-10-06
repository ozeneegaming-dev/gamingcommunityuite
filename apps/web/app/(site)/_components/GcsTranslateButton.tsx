"use client";

import { faLanguage } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useState } from "react";

export type GcsTranslateLabels = { translate: string; translating: string; original: string; translated: string; failed: string; limited: string };

/**
 * Butonul „Traduce” (specul etapei 5): cere traducerea conținutului în limba interfeței și o afișează sub original
 * (originalul rămâne), cu „Ascunde traducerea”. HTML-ul primit e deja sanitizat pe server.
 */
export function GcsTranslateButton({ contentType, contentId, labels }: { contentType: string; contentId: number | string; labels: GcsTranslateLabels }) {
  const [state, setState] = useState<"idle" | "loading" | "shown" | "hidden" | "error">("idle");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (html) {
      setState(state === "shown" ? "hidden" : "shown");
      return;
    }
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentType, contentId: String(contentId) }),
      });
      const body = (await res.json()) as { html?: string; error?: string };
      if (!res.ok || typeof body.html !== "string") {
        setError(res.status === 429 ? labels.limited : labels.failed);
        setState("error");
        return;
      }
      setHtml(body.html);
      setState("shown");
    } catch {
      setError(labels.failed);
      setState("error");
    }
  };

  return (
    <div className="gcs-translate" data-testid="gcs-translate">
      <button type="button" className="gcs-linkButton gcs-translate__button" onClick={() => void run()} disabled={state === "loading"} aria-expanded={state === "shown"}>
        <GcsIconSvg icon={faLanguage} /> {state === "loading" ? labels.translating : state === "shown" ? labels.original : labels.translate}
      </button>
      {state === "shown" && html && (
        <div className="gcs-translate__result" lang="" data-testid="gcs-translate-result">
          <span className="gcs-translate__label">{labels.translated}</span>
          <div className="gcs-postBody" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
      {error && (
        <p role="alert" className="gcs-translate__error">
          {error}
        </p>
      )}
    </div>
  );
}
