import { GcsContentRenderer, type GcsDoc, type GcsRendered, type GcsRenderOptions } from "@gcs/core";
import type { GcsContentFormat } from "../types";
import { convertBbcode } from "./bbcode";
import type { GcsConvertContext } from "./context";
import { plainDoc } from "./doc";
import { convertHtml, type GcsConvertResult } from "./html";
import { plainText } from "../source/values";

export type { GcsConvertContext } from "./context";
export type { GcsConvertResult } from "./html";

/** Textul simplu al conținutului vechi (rezerva când conversia sau validarea eșuează). */
export function stripMarkup(format: GcsContentFormat, raw: string): string {
  if (format === "html") return plainText(raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ""));
  return raw.replace(/\[\/?[a-z*][^\]]{0,200}\]/gi, "").trim();
}

/** Conținutul vechi → documentul GCS. O eroare neașteptată a convertorului → textul simplu. */
export function convertContent(format: GcsContentFormat, raw: string, ctx: GcsConvertContext): GcsConvertResult {
  try {
    return format === "html" ? convertHtml(raw, ctx) : convertBbcode(raw, ctx);
  } catch {
    return { doc: plainDoc(stripMarkup(format, raw)), unrecognized: 1, attachments: [] };
  }
}

const renderer = new GcsContentRenderer();
const EMPTY: GcsDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "…" }] }] };

/**
 * Documentul convertit, trecut prin renderer-ul GCS (validare strictă + sanitizare), ca o postare nouă.
 * Dacă documentul e respins, se încearcă textul simplu; un conținut gol devine „…”. `fallback` = s-a pierdut formatarea.
 */
export function renderImported(doc: GcsDoc | null, format: GcsContentFormat, raw: string, opts: GcsRenderOptions): GcsRendered & { fallback: boolean } {
  if (doc) {
    try {
      return { ...renderer.render(doc, opts), fallback: false };
    } catch {
      // Respins de validator: rămâne textul.
    }
  }
  const text = plainDoc(stripMarkup(format, raw));
  if (text) {
    try {
      return { ...renderer.render(text, opts), fallback: doc !== null };
    } catch {
      // Nici textul nu trece (ex. prea mare): conținut gol.
    }
  }
  return { ...renderer.render(EMPTY, opts), fallback: true };
}
