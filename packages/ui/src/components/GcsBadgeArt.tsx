import type { ImgHTMLAttributes } from "react";
import type { GcsBadgeSize } from "../badges/art";
import { cx } from "../cx";

/** Ce trebuie să știe componenta despre un badge: numele (textul alternativ), insigna și imaginea proprie. */
export type GcsBadgeArtSource = { name: string; art: string; image?: string | null };

export type GcsBadgeArtProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "width" | "height"> & {
  badge: GcsBadgeArtSource;
  size?: GcsBadgeSize;
  /** Badge încă neobținut: insigna în tonuri de gri (grila profilului). */
  locked?: boolean;
  /** Numele apare oricum lângă insignă: imaginea e decorativă (`alt=""`), ca cititorul de ecran să nu-l repete. */
  decorative?: boolean;
};

/**
 * Insigna unui badge (specul `2026-10-07-insigne-grafice.md`): imaginea proprie încărcată în ACP sau insigna generată
 * (`/badge-art/…svg`, vectorială, clară la orice mărime). Merge în componentele server și în cele client; tooltip-ul
 * (nume + descriere) îl pune locul unde apare.
 */
export function GcsBadgeArt({ badge, size = 32, locked = false, decorative = false, className, ...props }: GcsBadgeArtProps) {
  return (
    <img
      loading="lazy"
      decoding="async"
      {...props}
      src={badge.image ?? badge.art}
      alt={decorative ? "" : badge.name}
      width={size}
      height={size}
      draggable={false}
      className={cx("gcs-badgeArt", `gcs-badgeArt--${size}`, badge.image && "gcs-badgeArt--image", locked && "gcs-badgeArt--locked", className)}
    />
  );
}
