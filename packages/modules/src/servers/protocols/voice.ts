import { safeDiscordInvite } from "../games";
import { GcsQueryFailure } from "./reader";

/**
 * Mumble (pingul UDP public al serverului) și Discord (widget-ul JSON public al unui server). Totul e pur (fără rețea).
 */

/** Pingul Mumble: 4 octeți 0 (tipul cererii) + 8 octeți de identificare, ecou în răspuns. */
export function mumblePing(ident: Buffer): Buffer {
  if (ident.length !== 8) throw new Error("ident: 8 octeți");
  return Buffer.concat([Buffer.alloc(4), ident]);
}

/** Răspunsul pingului (24 de octeți, big-endian): versiunea, ecoul, utilizatorii, sloturile, lățimea de bandă. */
export function parseMumblePong(buf: Buffer, ident: Buffer): { version: string; users: number; maxUsers: number } {
  if (buf.length < 24) throw new GcsQueryFailure("invalid_response");
  if (!buf.subarray(4, 12).equals(ident)) throw new GcsQueryFailure("invalid_response");
  const v = buf.readUInt32BE(0);
  const users = buf.readUInt32BE(12);
  const maxUsers = buf.readUInt32BE(16);
  if (users > 1_000_000 || maxUsers > 1_000_000) throw new GcsQueryFailure("invalid_response");
  return { version: `${(v >> 16) & 0xffff}.${(v >> 8) & 0xff}.${v & 0xff}`, users, maxUsers };
}

/** Widget-ul unui server de Discord are cel mult atâția octeți (lista membrilor e plafonată de Discord la ~100). */
export const DISCORD_MAX_BYTES = 512 * 1024;
const MAX_MEMBERS = 128;

export type GcsDiscordWidget = { name: string; online: number; invite: string | null; channels: number; members: string[] };

/**
 * Widget-ul JSON public (`/api/guilds/<id>/widget.json`): numele, membrii online (`presence_count`), invitația (doar
 * una `discord.gg` validă), câte canale de voce publice și numele membrilor (doar ca text; avatarele nu se folosesc).
 * Codul 50004 („Widget Disabled”) devine `widget_disabled`; un server inexistent (10004) devine `not_found`.
 */
export function parseDiscordWidget(json: unknown): GcsDiscordWidget {
  if (!json || typeof json !== "object") throw new GcsQueryFailure("invalid_response");
  const j = json as Record<string, unknown>;
  if (j.code === 50004) throw new GcsQueryFailure("widget_disabled");
  if (j.code === 10004) throw new GcsQueryFailure("not_found");
  if (typeof j.id !== "string" || typeof j.name !== "string") throw new GcsQueryFailure("invalid_response");
  const presence = typeof j.presence_count === "number" && Number.isInteger(j.presence_count) && j.presence_count >= 0 ? Math.min(j.presence_count, 10_000_000) : 0;
  const members = Array.isArray(j.members)
    ? j.members
        .map((m) => (m && typeof m === "object" && typeof (m as { username?: unknown }).username === "string" ? (m as { username: string }).username : ""))
        .filter((n) => n !== "")
        .slice(0, MAX_MEMBERS)
    : [];
  return {
    name: j.name,
    online: presence,
    invite: safeDiscordInvite(j.instant_invite),
    channels: Array.isArray(j.channels) ? Math.min(j.channels.length, 1000) : 0,
    members,
  };
}
