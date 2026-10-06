"use client";

import { useEffect, useRef, useState } from "react";
import { isTemplateHtmlMessage, TEMPLATE_FRAME_SOURCE, type GcsTemplateFrameReady } from "@/lib/template-preview";

/**
 * Conținutul previzualizării: primește prin `postMessage` (doar de la fereastra părinte, aceeași origine) HTML-ul
 * șablonului, deja sanitizat pe server, și îl afișează. Linkurile nu navighează (e doar o previzualizare).
 */
export function GcsTemplatePreviewFrame({ waiting }: { waiting: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"site" | "email" | null>(null);

  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent || !isTemplateHtmlMessage(e.data)) return;
      // HTML-ul vine de la serverul nostru: randat dintr-un șablon și trecut prin sanitizer (fără script, fără on*).
      if (box.current) box.current.innerHTML = e.data.html;
      setMode(e.data.mode);
    };
    window.addEventListener("message", onMessage);
    const ready: GcsTemplateFrameReady = { source: TEMPLATE_FRAME_SOURCE, type: "ready" };
    window.parent.postMessage(ready, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <main
      className={`gcs-tplPreview${mode === "email" ? " gcs-tplPreview--email" : ""}`}
      onClickCapture={(e) => {
        if (e.target instanceof Element && e.target.closest("a, button, form")) e.preventDefault();
      }}
      data-testid="gcs-template-preview-root"
    >
      {mode === null && <p className="gcs-muted">{waiting}</p>}
      <div ref={box} className="gcs-tplPreview__content" data-testid="gcs-template-preview-content" />
    </main>
  );
}
