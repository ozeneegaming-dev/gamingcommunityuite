import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type GcsBadgeTone = "accent" | "ok" | "warn" | "info" | "vip" | "neutral";

export type GcsBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone: GcsBadgeTone;
  /**
   * Iconița din fața textului: `<GcsIcon name="fa-solid fa-…" />` în componentele server sau
   * `<GcsIconSvg icon={faX} />` în cele client (pachetul complet de iconițe nu ajunge în browser).
   */
  icon?: ReactNode;
};

export function GcsBadge({ tone, className, icon, children, ...props }: GcsBadgeProps) {
  return (
    <span className={cx("gcs-badge", `gcs-badge--${tone}`, className)} {...props}>
      {icon && (
        <span className="gcs-badge__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
