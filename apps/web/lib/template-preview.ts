/**
 * Protocolul `postMessage` dintre editorul de șabloane (ACP → Aspect → Șabloane) și previzualizarea lui din `iframe`
 * (`/admin/template-preview`, aceeași origine, cu stilurile temei editate). Editorul trimite HTML-ul randat și
 * sanitizat pe server; previzualizarea anunță că e gata, ca editorul să i-l retrimită.
 */
export const TEMPLATE_EDITOR_SOURCE = "gcs-template-editor";
export const TEMPLATE_FRAME_SOURCE = "gcs-template-frame";

export type GcsTemplateHtmlMessage = { source: typeof TEMPLATE_EDITOR_SOURCE; type: "html"; html: string; mode: "site" | "email" };
export type GcsTemplateFrameReady = { source: typeof TEMPLATE_FRAME_SOURCE; type: "ready" };

export const isTemplateHtmlMessage = (d: unknown): d is GcsTemplateHtmlMessage => {
  if (!d || typeof d !== "object") return false;
  const m = d as Record<string, unknown>;
  return m.source === TEMPLATE_EDITOR_SOURCE && m.type === "html" && typeof m.html === "string" && (m.mode === "site" || m.mode === "email");
};

export const isTemplateFrameReady = (d: unknown): d is GcsTemplateFrameReady =>
  !!d && typeof d === "object" && (d as Record<string, unknown>).source === TEMPLATE_FRAME_SOURCE && (d as Record<string, unknown>).type === "ready";
