import type { JSONContent } from "@tiptap/core";

const PREFIX = "gcs-draft:";

/** Ciornele stau în `localStorage` (per browser). Orice eroare (mod privat, stocare blocată) e ignorată. */
export function loadDraft(key: string): JSONContent | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as JSONContent) : null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, doc: JSONContent): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(doc));
  } catch {
    // Stocarea poate fi plină sau blocată; ciorna e doar o comoditate.
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignorat, ca mai sus
  }
}
