/**
 * Prima pagină nouă (varianta A, 2026-11-03): regulile pure ale widget-urilor din coloana îngustă (fără server):
 * ce widget se strânge pe telefon, câte nume / avatare arată „Cine e online” și totalul jucătorilor de pe servere.
 */
import type { GcsWidgetPage, GcsWidgetZone } from "@gcs/core";

/** Pragul telefonului (același ca în CSS: widget-urile strânse implicit, consola compactă pe o coloană). */
export const PHONE_QUERY = "(max-width: 767px)";

/**
 * Widget-urile care rămân deschise pe telefon: serverele (lista scurtă pe care o cauți prima) și shoutbox-ul (chatul
 * live, cu antetul lui propriu, fără săgeata de restrângere).
 */
const ALWAYS_OPEN: readonly string[] = ["servers.list", "chat.shoutbox"];

/**
 * Pe telefon, widget-urile din coloana din dreapta a primei pagini coboară sub forumuri ca rânduri care se deschid
 * (banda cu titlul și săgeata), strânse implicit (vezi `ALWAYS_OPEN`). Alegerea membrului (săgeata) rămâne în browser.
 * Doar casetele cu săgeata de restrângere se strâng (CSS-ul cere săgeata), deci un widget fără ea rămâne deschis.
 */
export function foldsOnPhone(page: GcsWidgetPage, zone: GcsWidgetZone, type: string): boolean {
  return page === "index" && zone === "sidebar" && !ALWAYS_OPEN.includes(type);
}

/** „Cine e online” în coloana îngustă: primii `max` membri (avatarele și numele) și câți mai sunt („și încă N”). */
export function onlinePreview<T>(members: readonly T[], total: number, max = 5): { shown: T[]; more: number } {
  const shown = members.slice(0, Math.max(0, max));
  return { shown, more: Math.max(0, total - shown.length) };
}

/** Jucătorii de pe serverele online (din dreapta titlului widget-ului „Servere”). */
export function playersOnline(statuses: Iterable<{ online: boolean; players: number } | null | undefined>): number {
  let n = 0;
  for (const s of statuses) if (s?.online && Number.isFinite(s.players) && s.players > 0) n += s.players;
  return n;
}

/** Starea unui server în bara compactă: plin (roșu), online sau offline / necunoscut. */
export function serverFill(s: { online: boolean; players: number; maxPlayers: number } | null | undefined): "full" | "online" | "offline" {
  if (!s?.online) return "offline";
  return s.maxPlayers > 0 && s.players >= s.maxPlayers ? "full" : "online";
}
