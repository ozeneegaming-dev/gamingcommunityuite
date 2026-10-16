import { cx } from "../cx";

export type GcsSpinnerProps = {
  /** `sm` (14 px), `md` (20 px), `lg` (36 px); într-un buton, cât textul. */
  size?: "sm" | "md" | "lg";
  /** Textul pentru cititoarele de ecran (`role="status"`); fără el, loaderul e doar decor (`aria-hidden`). */
  label?: string;
  className?: string;
};

/**
 * Loaderul sistemului (butoane, liste, modale, chat), în orice temă. Markup-ul e același pentru toate stilurile; stilul
 * vine din setarea temei „Stil loader” (`data-gcs-loader` pe `<html>`, CSS-ul din `loaders.css`).
 */
export function GcsSpinner({ size = "md", label, className }: GcsSpinnerProps) {
  const a11y = label ? { role: "status", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span className={cx("gcs-spinner", size !== "md" && `gcs-spinner--${size}`, className)} data-testid="gcs-spinner" {...a11y}>
      <span className="gcs-spinner__i" />
      <span className="gcs-spinner__i" />
      <span className="gcs-spinner__i" />
    </span>
  );
}
