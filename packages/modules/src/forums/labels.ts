import type { GcsRenderOptions } from "@gcs/core";

/**
 * Textele care ajung în HTML-ul salvat al postărilor (citat, spoiler), în limba implicită a site-ului (`site.locale`).
 * Sunt singurele texte din modul care nu trec prin `messages/*.json`, fiindcă HTML-ul se generează la salvare, pe server.
 */
export const RENDER_LABELS: Record<string, GcsRenderOptions["labels"]> = {
  ro: { quoteWrote: "{name} a scris:", spoiler: "Spoiler" },
  en: { quoteWrote: "{name} wrote:", spoiler: "Spoiler" },
};
