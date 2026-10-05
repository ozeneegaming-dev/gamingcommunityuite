import type { HTMLAttributes } from "react";
import { cx } from "../cx";

export type GcsCardProps = HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" };

export function GcsCard({ as: Tag = "div", className, ...props }: GcsCardProps) {
  return <Tag className={cx("gcs-card", className)} {...props} />;
}
