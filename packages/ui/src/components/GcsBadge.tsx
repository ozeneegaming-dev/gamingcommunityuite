import type { HTMLAttributes } from "react";
import { cx } from "../cx";

export type GcsBadgeTone = "accent" | "ok" | "warn" | "info" | "vip" | "neutral";

export type GcsBadgeProps = HTMLAttributes<HTMLSpanElement> & { tone: GcsBadgeTone };

export function GcsBadge({ tone, className, ...props }: GcsBadgeProps) {
  return <span className={cx("gcs-badge", `gcs-badge--${tone}`, className)} {...props} />;
}
