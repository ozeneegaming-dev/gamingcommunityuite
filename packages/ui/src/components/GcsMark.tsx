import { GCS_BRAND, GCS_MARK } from "@gcs/core/themes";
import { cx } from "../cx";

export type GcsMarkProps = {
  /** Latura în px (implicit 40; minim 16, ca favicon). */
  size?: number;
  /** Alb, pentru fundaluri colorate sau foto. */
  mono?: boolean;
  /** Textul pentru cititoarele de ecran; fără el, marca e decor (`aria-hidden`), lângă numele scris. */
  label?: string;
  className?: string;
};

/**
 * Marca GamingCommunitySuite (brandul GCS, `brand.ts`): pătratul plin cu G-ul geometric. Apare pe suprafețele
 * produsului (installer, ACP, „Powered by”), niciodată în locul logo-ului comunității.
 */
export function GcsMark({ size = 40, mono = false, label, className }: GcsMarkProps) {
  const fill = mono ? "#FFFFFF" : GCS_BRAND.color.dark.accent;
  const ink = mono ? GCS_BRAND.color.dark.bg : "#FFFFFF";
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg className={cx("gcs-mark", className)} width={size} height={size} viewBox={GCS_MARK.viewBox} {...a11y}>
      <rect width="64" height="64" rx={GCS_MARK.radius} fill={fill} />
      <path d={GCS_MARK.path} fill="none" stroke={ink} strokeWidth={GCS_MARK.stroke} strokeLinecap="square" />
    </svg>
  );
}
