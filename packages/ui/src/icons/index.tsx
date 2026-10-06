import type { IconDefinition, IconPack } from "@fortawesome/fontawesome-common-types";
import { fab } from "@fortawesome/free-brands-svg-icons";
import { far } from "@fortawesome/free-regular-svg-icons";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "./svg";

/**
 * Iconițele Font Awesome Free după nume (`fa-solid fa-gamepad`), pentru iconițele alese din ACP (forumuri, meniu,
 * grupuri, câmpuri, widget-uri). Importă toate pachetele: se folosește doar pe server (componente server, validare,
 * API-ul selectorului). Componentele client folosesc `GcsIconSvg` cu iconițe importate individual.
 */
export const GCS_ICON_STYLES = ["fa-solid", "fa-regular", "fa-brands"] as const;
export type GcsIconStyle = (typeof GCS_ICON_STYLES)[number];

const PACKS: Record<GcsIconStyle, IconPack> = { "fa-solid": fas, "fa-regular": far, "fa-brands": fab };
const NAME_RE = /^(fa-solid|fa-regular|fa-brands) fa-([a-z0-9-]{1,60})$/;

let index: Map<string, IconDefinition> | undefined;

/** `fa-solid fa-gamepad` → definiția; pachetele au și aliasuri, deci indexul e după `iconName`. */
function iconIndex(): Map<string, IconDefinition> {
  if (index) return index;
  index = new Map();
  for (const style of GCS_ICON_STYLES) {
    for (const def of Object.values(PACKS[style])) {
      const key = `${style} fa-${def.iconName}`;
      if (!index.has(key)) index.set(key, def);
    }
  }
  return index;
}

export function resolveIcon(name: string | null | undefined): IconDefinition | null {
  if (typeof name !== "string" || !NAME_RE.test(name)) return null;
  return iconIndex().get(name) ?? null;
}

/** Validarea pe server a unei iconițe trimise din formulare. */
export function isGcsIcon(name: unknown): name is string {
  return typeof name === "string" && resolveIcon(name) !== null;
}

export type GcsIconMatch = { name: string; width: number; height: number; path: string };

/** Căutarea din selectorul de iconițe: primele `limit` iconițe care conțin textul (cu datele SVG, ca să fie randate). */
export function searchIcons(query: string, limit = 60): GcsIconMatch[] {
  const q = query.trim().toLowerCase().replace(/^fa-/, "");
  const out: GcsIconMatch[] = [];
  for (const [name, def] of iconIndex()) {
    if (q && !name.includes(q)) continue;
    const [width, height, , , path] = def.icon;
    out.push({ name, width, height, path: Array.isArray(path) ? path.join(" ") : path });
    if (out.length >= limit) break;
  }
  return out;
}

export type GcsIconProps = { name: string | null | undefined; label?: string; className?: string };

/** Iconiță după nume; un nume necunoscut nu randează nimic. */
export function GcsIcon({ name, label, className }: GcsIconProps) {
  const icon = resolveIcon(name);
  if (!icon) return null;
  return <GcsIconSvg icon={icon} {...(label ? { label } : {})} {...(className ? { className } : {})} />;
}

export { GcsIconSvg, type GcsIconSvgProps } from "./svg";
