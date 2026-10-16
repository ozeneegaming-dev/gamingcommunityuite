/**
 * Ce deschide un hover card (`GcsHoverCardHost`): un nume de membru (`[data-user-id]`), o @mențiune salvată în formatul
 * vechi (`.gcs-mention` doar cu `data-user`, înainte de Mențiuni v2) sau pastila unui grup
 * (`.gcs-groupMention[data-group-id]`). Fără client sau server: se testează cu jsdom.
 */
export const HOVER_ANCHOR = "[data-user-id], .gcs-mention[data-user], .gcs-groupMention[data-group-id]";

/** Elementul care deschide un card, de la ținta unui eveniment; nimic în conținutul editabil (editorul). */
export function hoverAnchorOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(HOVER_ANCHOR);
  return el && !el.closest('[contenteditable="true"]') ? el : null;
}

/** Cheia cardului: `u:<id>` pentru un membru, `g:<id>` pentru un grup; `null` fără id. */
export function hoverAnchorKey(el: HTMLElement): string | null {
  if (el.matches(".gcs-groupMention[data-group-id]")) return el.dataset.groupId ? `g:${el.dataset.groupId}` : null;
  const userId = el.dataset.userId ?? el.dataset.user;
  return userId ? `u:${userId}` : null;
}

/** Evenimentul cu care o componentă cere deschiderea imediată a cardului unui element-ancoră (ex. click pe un avatar). */
export const OPEN_CARD_EVENT = "gcs:hover-card";

/** Deschide pe loc cardul ancorei (un element cu `data-user-id`), fără întârzierea hover-ului. */
export function openMemberCard(anchor: HTMLElement): void {
  document.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail: { anchor } }));
}
