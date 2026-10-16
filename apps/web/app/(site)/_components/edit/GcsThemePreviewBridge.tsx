"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { designClass, isStudioApplyMessage, PREVIEW_MESSAGE_SOURCE, type GcsPreviewReadyMessage, type GcsStudioApplyMessage } from "@/lib/theme-preview";

/** Aplică starea editorului: CSS-ul (ultimul în `<head>`, peste cel randat de server), modul și textul logo-ului. */
function apply(m: GcsStudioApplyMessage) {
  let style = document.getElementById("gcs-theme-live");
  if (!style) {
    style = document.createElement("style");
    style.id = "gcs-theme-live";
  }
  // `textContent`: CSS-ul nu poate deveni HTML; e compilat din valori validate, iar CSS-ul extra e sanitizat.
  style.textContent = m.css;
  document.head.appendChild(style);
  if (m.mode) document.documentElement.dataset.theme = m.mode;
  // Designul temei (Nova / clasic): markup-ul e același, doar clasa de pe `<html>` se schimbă.
  if (m.preset) document.documentElement.classList.toggle("gcs-nova", designClass(m.preset) === "gcs-nova");
  // Constructorul de antet: antetul construit își schimbă aspectul și opțiunile live.
  if (m.header) window.dispatchEvent(new CustomEvent("gcs:header-preview", { detail: m.header }));
  const logo = m.logo;
  if (!logo) return;
  document.querySelectorAll<HTMLElement>("[data-gcs-logo-text]").forEach((el) => {
    el.textContent = logo.text || el.dataset.siteName || "";
    const mark = el.closest(".gcs-brand")?.querySelector(".gcs-brand__mark > span");
    if (mark) mark.textContent = (el.textContent ?? "").trim().charAt(0).toUpperCase() || "G";
  });
  document.querySelectorAll<HTMLElement>("[data-gcs-logo-slogan]").forEach((el) => {
    el.textContent = logo.slogan;
  });
}

/**
 * Puntea previzualizării (randată de layout doar în `iframe`-ul editorului vizual, pentru un admin cu drept pe teme):
 * primește starea editorului prin `postMessage`, doar de la fereastra părinte și doar de pe aceeași origine.
 */
export function GcsThemePreviewBridge() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      if (isStudioApplyMessage(e.data)) apply(e.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (window.parent === window) return;
    const ready: GcsPreviewReadyMessage = { source: PREVIEW_MESSAGE_SOURCE, type: "ready", path: `${window.location.pathname}${window.location.search}` };
    window.parent.postMessage(ready, window.location.origin);
  }, [pathname]);

  return null;
}
