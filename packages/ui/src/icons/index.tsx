import { resolveIcon } from "./registry";
import { GcsIconSvg } from "./svg";

export type GcsIconProps = { name: string | null | undefined; label?: string; className?: string };

/** Iconiță după nume; un nume necunoscut nu randează nimic. */
export function GcsIcon({ name, label, className }: GcsIconProps) {
  const icon = resolveIcon(name);
  if (!icon) return null;
  return <GcsIconSvg icon={icon} {...(label ? { label } : {})} {...(className ? { className } : {})} />;
}

export { GcsIconSvg, type GcsIconSvgProps } from "./svg";
export { GCS_ICON_STYLES, isGcsIcon, resolveIcon, searchIcons, type GcsIconMatch, type GcsIconStyle } from "./registry";
