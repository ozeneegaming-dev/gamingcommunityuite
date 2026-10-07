import { resolveIcon } from "../icons/registry";
import { badgeIconName, type GcsBadgeArtSpec } from "./art";
import { renderBadgeArtSvg, type GcsBadgeIconShape } from "./svg";

/**
 * Desenul complet al unei insigne, pe server: iconița se caută în registrul Font Awesome Free (toate pachetele;
 * nu ajunge în browser). O iconiță care nu există primește glifa implicită (`fa-solid fa-award`).
 */
export function badgeArtSvg(spec: GcsBadgeArtSpec): string {
  let icon: GcsBadgeIconShape | null = null;
  if (spec.glyph.kind === "icon") {
    const def = resolveIcon(badgeIconName(spec.glyph)) ?? resolveIcon("fa-solid fa-award");
    if (def) {
      const [width, height, , , path] = def.icon;
      icon = { width, height, paths: Array.isArray(path) ? path : [path] };
    }
  }
  return renderBadgeArtSvg(spec, icon);
}

export { renderBadgeArtSvg, type GcsBadgeIconShape } from "./svg";
