import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
import { cx } from "../cx";

export type GcsIconSvgProps = {
  icon: Pick<IconDefinition, "icon" | "iconName" | "prefix">;
  /** Text pentru cititoarele de ecran; fără el, iconița e decorativă (`aria-hidden`). */
  label?: string;
  className?: string;
};

/**
 * O iconiță Font Awesome Free randată ca SVG inline (fără runtime-ul Font Awesome). Primește definiția iconiței,
 * deci în componentele client se importă doar iconițele folosite; iconițele alese din ACP se rezolvă pe server
 * (`@gcs/ui/icons`) și ajung la client ca markup.
 */
export function GcsIconSvg({ icon, label, className }: GcsIconSvgProps) {
  const [width, height, , , path] = icon.icon;
  const paths = Array.isArray(path) ? path : [path];
  return (
    <svg
      className={cx("gcs-icon", className)}
      viewBox={`0 0 ${width} ${height}`}
      width="1em"
      height="1em"
      fill="currentColor"
      focusable="false"
      data-icon={`${icon.prefix}-${icon.iconName}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
