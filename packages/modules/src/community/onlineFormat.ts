/**
 * Formatul timpului online (fără dependențe de server: îl folosesc și componentele din browser, prin
 * `@gcs/modules/online-format`).
 */

/** Durata ca text scurt: „1h 35m”, „37m”, „45s” (fără zile: orele cresc peste 24). */
export function formatOnlineDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
