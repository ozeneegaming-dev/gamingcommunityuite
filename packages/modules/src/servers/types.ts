import type { GcsQueryError } from "./protocols/reader";

export type { GcsQueryError } from "./protocols/reader";

/** Un jucător din lista serverului (Minecraft dă doar numele). */
export type GcsServerPlayer = { name: string; score: number | null; time: number | null };

/**
 * Statusul unui server la ultima interogare (Redis, specul 2026-10-07-servere §3.4). Textele sunt deja curățate
 * (`cleanGameText`) și se afișează doar ca text.
 */
export type GcsServerStatus = {
  online: boolean;
  /** Numele raportat de server (adminul alege numele afișat). */
  name: string | null;
  map: string | null;
  players: number;
  maxPlayers: number;
  bots: number;
  ping: number | null;
  version: string | null;
  /** `null` = protocolul nu dă lista (sau nu s-a cerut). */
  playerList: GcsServerPlayer[] | null;
  /** Folderul jocului raportat prin A2S (`cstrike`, `csgo`; verificarea înrolărilor); lipsă la celelalte protocoale. */
  folder?: string | null;
  /** Câte canale are serverul de voce (TeamSpeak) sau de Discord; lipsă la jocuri. */
  channels?: number | null;
  /** Invitația serverului de Discord (deja verificată, `https://discord.gg/…`), din widget. */
  invite?: string | null;
  /** De când e online fără întrerupere (ISO), ținut de worker între interogări. */
  onlineSince?: string | null;
  /** Ultima interogare reușită (ISO): „Ultima dată” la un server căzut. */
  lastOnlineAt?: string | null;
  updatedAt: string;
  error: GcsQueryError | null;
};

/** Partea publică a statusului (fără lista jucătorilor), trimisă live și prin `/api/servers/status`. */
export type GcsServerLive = Omit<GcsServerStatus, "playerList" | "error"> & { id: number };

export function liveStatus(id: number, s: GcsServerStatus): GcsServerLive {
  const { playerList: _players, error: _error, folder: _folder, ...rest } = s;
  return { id, ...rest };
}
