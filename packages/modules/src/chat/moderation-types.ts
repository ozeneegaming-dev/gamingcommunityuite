import type { GcsUserRef } from "../forums/queries";
import type { GcsChatBlock, GcsChatRight } from "./rights";

/** Felurile liniilor de sistem din chat (anunțurile moderării, verzi, în cameră). */
export type GcsChatSystemKind = "mute" | "kick" | "ban" | "warn" | "grant" | "revoke";

/**
 * O linie de sistem a moderării („X a primit mute 15 minute: spam”, „X a primit acces de moderator în chat de la Y”),
 * păstrată ca mesaj al moderatorului cu `meta.system`. Clientul o traduce; `target` e completat la citire.
 */
export type GcsChatSystemLine = {
  kind: GcsChatSystemKind;
  targetId: string;
  target: GcsUserRef | null;
  /** Durata (mute, kick, ban, acces) în minute; `null` = permanent. */
  minutes: number | null;
  reason: string;
  /** Drepturile date (acces de moderator). */
  rights?: GcsChatRight[];
};

/** Un acces de moderator în chat, pentru liste (ACP, `/acces`). */
export type GcsChatGrantView = {
  id: number;
  user: GcsUserRef;
  rights: GcsChatRight[];
  rooms: string[];
  expiresAt: string | null;
  grantedBy: GcsUserRef | null;
  createdAt: string;
};

/** Rezultatul unei comenzi de moderare (`/acces`, `/revoca`), vizibil doar celui care a scris-o; nu se salvează. */
export type GcsChatEphemeral =
  | { kind: "granted"; grant: GcsChatGrantView }
  | { kind: "revoked"; user: GcsUserRef }
  | { kind: "list"; grants: GcsChatGrantView[] };

/** Mesajul ascuns de staff: când și de cine (vizibil doar celor cu dreptul `hide`). */
export type GcsChatHidden = { at: string; byId: string | null; by: GcsUserRef | null };

/** Starea de moderare a viewer-ului într-o cameră: mute-ul, kick-ul / banul și slow mode-ul personal. */
export type GcsChatViewerState = {
  mute: { reason: string; until: string | null } | null;
  block: GcsChatBlock | null;
  slowSeconds: number;
};

/** Ce poate face viewer-ul în meniul „⋯” al unei camere. */
export type GcsChatModMenu = {
  rights: GcsChatRight[];
  /** Linkul „Ban pe site…” (formularul de ban din ACP, cu dreptul pe membri). */
  siteBan: boolean;
  /** Motivele gata scrise (ACP → Chat → Moderare). */
  reasons: string[];
  /** Poate da acces de moderator în chat (`/acces`). */
  canGrant: boolean;
};
