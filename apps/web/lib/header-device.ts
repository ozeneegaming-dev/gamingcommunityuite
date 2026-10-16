/**
 * Dispozitivul pentru aspectul antetului (constructorul de antet, specul 2026-10-10-hero-cockpit §9): telefon sub
 * 768 px, tabletă până la 1099 px, desktop de la 1100 px. Pe server se ghicește din user-agent (prima randare), apoi
 * clientul folosește lățimea reală. Fără dependențe de server: se folosește și în browser.
 */
export type GcsDevice = "desktop" | "tablet" | "mobile";

export const MOBILE_MAX = 767;
export const TABLET_MAX = 1099;

export function deviceForWidth(width: number): GcsDevice {
  if (width <= MOBILE_MAX) return "mobile";
  if (width <= TABLET_MAX) return "tablet";
  return "desktop";
}

/** Prima randare (server): `Sec-CH-UA-Mobile: ?1` sau un user-agent de telefon → mobil; tabletele → tabletă. */
export function guessDevice(userAgent: string | null | undefined, chMobile: string | null | undefined): GcsDevice {
  const ua = userAgent ?? "";
  if (chMobile === "?1") return "mobile";
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}
