/**
 * Partea pură a notei cu stele (Forum v2), fără server: o folosesc și componentele client (`@gcs/core/rating-stars`).
 */
export const GCS_RATING_MAX = 5;

/** Eticheta fiecărei note la hover (cheile din `messages`: `rating.labels.<cheie>`). */
export const GCS_RATING_LABELS = ["poor", "fair", "good", "great", "excellent"] as const;

/** Media rotunjită la jumătate de stea (afișarea: 4,3 → 4,5; 4,2 → 4). */
export function roundHalf(avg: number): number {
  return Math.round(Math.min(Math.max(avg, 0), GCS_RATING_MAX) * 2) / 2;
}

/** Cele 5 stele ale unei medii: pline, jumătăți și goale (cu rotunjirea la jumătate). */
export function ratingStars(avg: number): ("full" | "half" | "empty")[] {
  const r = roundHalf(avg);
  return Array.from({ length: GCS_RATING_MAX }, (_x, i) => (r >= i + 1 ? "full" : r >= i + 0.5 ? "half" : "empty"));
}
