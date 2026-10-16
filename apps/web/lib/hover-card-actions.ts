import type { ComponentType } from "react";

/**
 * Slotul de extensie al hover card-ului (profil gaming v2 §1): acțiunile rapide pe care alte zone ale site-ului le pun
 * în cardul unui membru. Fiecare furnizor e o componentă React (poate folosi hook-uri, ex. traducerile) care primește
 * contextul cardului și întoarce butoanele lui (sau nimic). Exemplu: chat-ul adaugă Mute / Kick / Avertisment când cardul
 * e deschis din camera în care viewer-ul moderează.
 *
 * Înregistrarea se face o singură dată, la încărcarea modulului furnizorului (`registerHoverCardActions`); o cheie
 * înregistrată din nou își înlocuiește furnizorul (reîncărcarea la dezvoltare). Cardul citește lista la fiecare deschidere.
 */
export type GcsHoverCardActionContext = {
  userId: string;
  name: string;
  /** Elementul pe care s-a deschis cardul (numele, mențiunea, avatarul) — de aici se află locul (ex. camera de chat). */
  anchor: HTMLElement;
  isSelf: boolean;
  /** Închide cardul (înainte de a deschide un dialog). */
  close: () => void;
};

export type GcsHoverCardActionProvider = ComponentType<{ ctx: GcsHoverCardActionContext }>;

const providers = new Map<string, { order: number; Provider: GcsHoverCardActionProvider }>();

export function registerHoverCardActions(key: string, Provider: GcsHoverCardActionProvider, order = 100): void {
  providers.set(key, { order, Provider });
}

export function unregisterHoverCardActions(key: string): void {
  providers.delete(key);
}

/** Furnizorii, în ordine (`order`, apoi cheia). */
export function hoverCardActionProviders(): { key: string; Provider: GcsHoverCardActionProvider }[] {
  return [...providers.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0])).map(([key, p]) => ({ key, Provider: p.Provider }));
}
