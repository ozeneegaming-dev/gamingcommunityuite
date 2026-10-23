import "server-only";
import { guestPresenceId, type GcsActor, type GcsPresenceViewer } from "@gcs/core";
import { MAX_ROOMS } from "@gcs/modules";
import { headers } from "next/headers";
import { currentActor } from "./actor";
import { clientIp } from "./client-ip";
import { services } from "./services";

/**
 * Transporturile de rezervă ale timpului real (ediția Lite, sau când websocket-ul e blocat): SSE
 * (`/api/realtime/stream`) și polling (`/api/realtime/poll`) citesc jurnalul live; mesajele clientului („scrie…”,
 * semnul de prezență, ieșirea dintr-o cameră) vin prin `POST /api/realtime/send`. Fără stare pe server: clientul
 * trimite camerele și cursorul la fiecare conexiune, serverul verifică din nou accesul.
 */

const CID = /^[A-Za-z0-9_-]{8,64}$/;
const ROOM = /^[a-z][a-z0-9_-]{0,20}(?::[A-Za-z0-9_.-]{1,80})?$/;

export type GcsRealtimeCaller = { actor: GcsActor; viewer: GcsPresenceViewer; ip: string };

export async function realtimeCaller(): Promise<GcsRealtimeCaller> {
  const h = await headers();
  const ip = clientIp(h);
  const actor = await currentActor();
  return { actor, viewer: services().realtimeHub.viewerOf(actor, guestPresenceId(ip)), ip };
}

/** Camerele cerute (`?rooms=a,b`), cu formă validă, fără dubluri, cel mult `MAX_ROOMS`. */
export function parseRooms(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((r) => r.trim()).filter((r) => ROOM.test(r)))].slice(0, MAX_ROOMS);
}

/** Id-ul conexiunii din tab (mesajele produse de ea nu-i sunt trimise înapoi). */
export function parseCid(raw: unknown): string | null {
  return typeof raw === "string" && CID.test(raw) ? raw : null;
}

/** Camerele conexiunii: cele implicite (membrul, prezența) plus cele cerute la care actorul are acces. */
export async function connectionRooms(actor: GcsActor, requested: string[]): Promise<{ allowed: string[]; all: Set<string> }> {
  const hub = services().realtimeHub;
  const allowed = await hub.allowed(actor, requested);
  return { allowed, all: new Set([...hub.baseRooms(actor), ...allowed]) };
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
