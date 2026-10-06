import type { GcsPluginRow } from "@gcs/core";

/** Starea unui plugin, ca insignă: activ, dezactivat (de admin, automat, din consolă) sau dezinstalat cu datele păstrate. */
export function pluginStatus(row: Pick<GcsPluginRow, "enabled" | "status" | "disabledReason">): { key: string; tone: "ok" | "warn" | "neutral"; icon: string } {
  if (row.status !== "installed") return { key: "removed", tone: "neutral", icon: "fa-solid fa-box-archive" };
  if (row.enabled) return { key: "enabled", tone: "ok", icon: "fa-solid fa-circle-check" };
  if (row.disabledReason === "auto") return { key: "auto", tone: "warn", icon: "fa-solid fa-triangle-exclamation" };
  if (row.disabledReason === "cli") return { key: "cli", tone: "neutral", icon: "fa-solid fa-terminal" };
  return { key: "disabled", tone: "neutral", icon: "fa-solid fa-circle-pause" };
}

/** Autorul din manifest (text sau `{ name, url }`). */
export function pluginAuthor(p: Pick<GcsPluginRow, "manifest">): string {
  return typeof p.manifest.author === "string" ? p.manifest.author : p.manifest.author.name;
}
