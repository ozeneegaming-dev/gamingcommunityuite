import { Slot, Slottable } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { GcsSpinner } from "./GcsSpinner";

export type GcsButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: "primary" | "ghost";
  size?: "md" | "sm";
  /** Randează copilul (ex. un `<a>`) cu stilul butonului, în loc de `<button>`. */
  asChild?: boolean;
  /**
   * Iconița din fața textului: `<GcsIcon name="fa-solid fa-…" />` în componentele server sau
   * `<GcsIconSvg icon={faX} />` în cele client (pachetul complet de iconițe nu ajunge în browser).
   */
  icon?: ReactNode;
  /** Acțiunea rulează: loaderul temei în locul iconiței, butonul dezactivat și `aria-busy`. */
  loading?: boolean;
};

export function GcsButton({ variant, size = "md", asChild = false, className, type, icon, loading = false, disabled, children, ...props }: GcsButtonProps) {
  const classes = cx("gcs-btn", `gcs-btn--${variant}`, size === "sm" && "gcs-btn--sm", loading && "gcs-btn--loading", className);
  const lead = loading ? <GcsSpinner size="sm" /> : icon;
  const iconEl = lead ? (
    <span className="gcs-btn__icon" aria-hidden="true">
      {lead}
    </span>
  ) : null;
  const busy = loading ? { "aria-busy": true as const } : {};
  if (asChild) {
    return (
      <Slot className={classes} {...busy} {...(disabled !== undefined ? { disabled } : {})} {...props}>
        {iconEl}
        <Slottable>{children}</Slottable>
      </Slot>
    );
  }
  return (
    <button type={type ?? "button"} className={classes} disabled={disabled || loading} {...busy} {...props}>
      {iconEl}
      {children}
    </button>
  );
}
