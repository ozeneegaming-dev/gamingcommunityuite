import { Slot, Slottable } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

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
};

export function GcsButton({ variant, size = "md", asChild = false, className, type, icon, children, ...props }: GcsButtonProps) {
  const classes = cx("gcs-btn", `gcs-btn--${variant}`, size === "sm" && "gcs-btn--sm", className);
  const iconEl = icon ? <span className="gcs-btn__icon" aria-hidden="true">{icon}</span> : null;
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {iconEl}
        <Slottable>{children}</Slottable>
      </Slot>
    );
  }
  return (
    <button type={type ?? "button"} className={classes} {...props}>
      {iconEl}
      {children}
    </button>
  );
}
