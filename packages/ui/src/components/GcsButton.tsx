import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "../cx";

export type GcsButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: "primary" | "ghost";
  size?: "md" | "sm";
  /** Randează copilul (ex. un `<a>`) cu stilul butonului, în loc de `<button>`. */
  asChild?: boolean;
};

export function GcsButton({ variant, size = "md", asChild = false, className, type, ...props }: GcsButtonProps) {
  const classes = cx("gcs-btn", `gcs-btn--${variant}`, size === "sm" && "gcs-btn--sm", className);
  if (asChild) return <Slot className={classes} {...props} />;
  return <button type={type ?? "button"} className={classes} {...props} />;
}
