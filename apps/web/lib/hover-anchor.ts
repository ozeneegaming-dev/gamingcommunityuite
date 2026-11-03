/**
 * Ce deschide un hover card (`GcsHoverCardHost`): un nume de membru (`[data-user-id]`), o @mențiune salvată în formatul
 * vechi (`.gcs-mention` doar cu `data-user`, înainte de Mențiuni v2) sau pastila unui grup
 * (`.gcs-groupMention[data-group-id]`). Fără client sau server: se testează cu jsdom.
 */
export const HOVER_ANCHOR = "[data-user-id], .gcs-mention[data-user], .gcs-groupMention[data-group-id]";
/**
 * Zonele care refuză explicit hover card-ul (ca `data-gcs-tip-off` pentru tooltip-uri): ex. avatarul din meniul
 * contului, unde cardul propriu s-ar deschide peste meniu.
 */
export const HOVER_OFF = "[data-gcs-card-off]";

/** Elementul care deschide un card, de la ținta unui eveniment; nimic în conținutul editabil (editorul) sau în zonele refuzate. */
export function hoverAnchorOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(HOVER_OFF)) return null;
  const el = target.closest<HTMLElement>(HOVER_ANCHOR);
  return el && !el.closest('[contenteditable="true"]') && !el.closest(HOVER_OFF) ? el : null;
}

/** Cheia cardului: `u:<id>` pentru un membru (și avatarul lui, pe telefon), `g:<id>` pentru un grup; `null` fără id. */
export function hoverAnchorKey(el: HTMLElement): string | null {
  if (el.matches(".gcs-groupMention[data-group-id]")) return el.dataset.groupId ? `g:${el.dataset.groupId}` : null;
  const userId = el.dataset.userId ?? el.dataset.user ?? el.dataset.avatarUser;
  return userId ? `u:${userId}` : null;
}

/** Evenimentul cu care o componentă cere deschiderea imediată a cardului unui element-ancoră (ex. click pe un avatar). */
export const OPEN_CARD_EVENT = "gcs:hover-card";

/** Deschide pe loc cardul ancorei (un element cu `data-user-id`), fără întârzierea hover-ului. */
export function openMemberCard(anchor: HTMLElement): void {
  document.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail: { anchor } }));
}

/**
 * Locurile unde atingerea unui avatar își păstrează rostul (nu deschide cardul): butoanele și meniurile (ex. avatarul
 * din meniul contului), dialogurile, editorul, cardul deschis și zonele care refuză explicit cardul (`data-gcs-card-off`).
 */
const AVATAR_TAP_OFF =
  "button, [role='button'], [role='menuitem'], [role='option'], [role='dialog'], [aria-haspopup], label, summary, [contenteditable='true'], [data-gcs-card-off], .gcs-hoverCardLayer";

/**
 * Avatarul unui membru atins pe telefon (cardul se deschide ca foaie de jos): elementul `.gcs-avatar[data-avatar-user]`
 * (și din rama VIP). Într-un link, doar dacă linkul duce la profilul aceluiași membru — altfel atingerea merge unde
 * mergea (ex. o notificare, o conversație, ultimul mesaj dintr-un forum).
 */
export function avatarAnchorOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(".gcs-avatar[data-avatar-user]") ?? target.closest(".gcs-avatarFrame")?.querySelector<HTMLElement>(".gcs-avatar[data-avatar-user]") ?? null;
  const userId = el?.dataset.avatarUser;
  if (!el || !userId || el.closest(AVATAR_TAP_OFF)) return null;
  const link = el.closest<HTMLAnchorElement>("a[href]");
  if (link && !isProfileLink(link, userId)) return null;
  return el;
}

/** Linkul duce la profilul membrului (`/members/<id>` sau `/members/<id>-<slug>`, cu orice parametri). */
function isProfileLink(link: HTMLAnchorElement, userId: string): boolean {
  if (link.dataset.userId === userId) return true;
  const path = new URL(link.getAttribute("href") ?? "", "http://gcs.local").pathname;
  return path === `/members/${userId}` || path.startsWith(`/members/${userId}-`);
}
