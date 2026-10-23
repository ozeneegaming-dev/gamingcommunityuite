import type { GcsActor, GcsPresenceService, GcsPresenceViewer, GcsRealtime } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { normalizePrivacy } from "../profile/privacy";
import { toRef, userRefSelect } from "../forums/queries";
import type { GcsRealtimeRooms } from "./rooms";

export const TYPING_THROTTLE_MS = 3_000;
const TOPIC_ROOM = /^topic:(\d+)$/;
export const CHAT_KEY = /^[a-z0-9][a-z0-9-]{1,40}$/;
/** Camerele cu listă de prezență: topicurile („Citesc acum”) și camerele de chat (lista celor online). */
export const TRACKED_ROOM = /^(?:topic:\d+|chat:[a-z0-9][a-z0-9-]{1,40})$/;
/** Lista „Citesc acum” se trimite cel mult o dată pe secundă pe topic (în fiecare proces). */
const READERS_DEBOUNCE_MS = 1_000;
/** Câte camere poate cere o conexiune SSE / polling (plus cele implicite). */
export const MAX_ROOMS = 40;

export type GcsRealtimeHubDeps = {
  db: PrismaClient;
  presence: GcsPresenceService;
  realtimeRooms: GcsRealtimeRooms;
  realtime: GcsRealtime;
  chatPro: { active(): Promise<boolean>; displayName(userId: string): Promise<string | null> };
};

/**
 * Logica live comună transporturilor (specul etapei 4 §5, ediția Lite): websocket-ul din `gcs-realtime` și SSE /
 * polling din web. Accesul la camere, prezența în camere („Citesc acum”, cine e în chat) și „scrie…”; mesajele pleacă
 * prin `GcsRealtime`, deci ajung la toți clienții, indiferent de transport. `origin` = conexiunea care a scris
 * (ea nu-și primește înapoi „scrie…”).
 */
export class GcsRealtimeHub {
  private readonly readerTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastTyping = new Map<string, number>();

  constructor(private readonly deps: GcsRealtimeHubDeps) {}

  viewerOf(actor: GcsActor, guestId: string): GcsPresenceViewer {
    return actor.userId ? { userId: actor.userId } : { guestId };
  }

  /** Camerele în care intră orice conexiune: a membrului (notificări, mesaje) și prezența. */
  baseRooms(actor: GcsActor): string[] {
    return actor.userId ? [`user:${actor.userId}`, "presence"] : ["presence"];
  }

  /** Camerele cerute la care actorul are acces (fără cele implicite), în ordinea cererii, fără dubluri. */
  async allowed(actor: GcsActor, rooms: string[]): Promise<string[]> {
    const wanted = [...new Set(rooms)].filter((r) => typeof r === "string" && !r.startsWith("user:") && r !== "presence").slice(0, MAX_ROOMS);
    const checks = await Promise.all(wanted.map((room) => this.deps.realtimeRooms.canJoin(actor, room).catch(() => false)));
    return wanted.filter((_, i) => checks[i]);
  }

  /** O conexiune a intrat în cameră: prezența și lista celor prezenți. */
  async joined(room: string, viewer: GcsPresenceViewer): Promise<void> {
    if (!TRACKED_ROOM.test(room)) return;
    await this.deps.presence.touchRoom(room, viewer);
    this.broadcastReaders(room);
  }

  async left(room: string, viewer: GcsPresenceViewer): Promise<void> {
    if (!TRACKED_ROOM.test(room)) return;
    await this.deps.presence.leaveRoom(room, viewer);
    this.broadcastReaders(room);
  }

  /** Semnul de prezență periodic (60 s): site-ul și camerele urmărite. */
  async ping(viewer: GcsPresenceViewer, rooms: Iterable<string>): Promise<void> {
    await this.deps.presence.touch(viewer).catch(() => {});
    for (const room of rooms) {
      if (TRACKED_ROOM.test(room)) await this.deps.presence.touchRoom(room, viewer).catch(() => {});
    }
  }

  /** După intrări și ieșiri, camera primește lista celor prezenți (fără cei cu statusul ascuns). */
  broadcastReaders(room: string): void {
    if (this.readerTimers.has(room)) return;
    const timer = setTimeout(() => {
      this.readerTimers.delete(room);
      void this.sendReaders(room).catch((error: unknown) => console.error("[gcs] lista celor prezenți nu a putut fi trimisă", error));
    }, READERS_DEBOUNCE_MS);
    timer.unref?.();
    this.readerTimers.set(room, timer);
  }

  private async sendReaders(room: string): Promise<void> {
    const readers = await this.deps.presence.roomMembers(room);
    const rows = await this.deps.db.user.findMany({ where: { id: { in: readers.users } }, select: { ...userRefSelect, privacy: true } });
    const users = rows.filter((r) => normalizePrivacy(r.privacy).showOnline).map((r) => toRef(r));
    const topic = TOPIC_ROOM.exec(room);
    const payload = topic ? { topicId: Number(topic[1]), users, guests: readers.guests } : { channel: room.slice(5), users, guests: readers.guests };
    await this.deps.realtime.publish(room, "readers", payload);
  }

  private throttled(key: string, now = Date.now()): boolean {
    const last = this.lastTyping.get(key) ?? 0;
    if (now - last < TYPING_THROTTLE_MS) return true;
    if (this.lastTyping.size > 10_000) this.lastTyping.clear();
    this.lastTyping.set(key, now);
    return false;
  }

  /** „scrie…” într-un topic: doar cine poate răspunde; `name` = numele membrului. */
  async typing(actor: GcsActor, topicId: unknown, origin: string, opts: { name?: string | null; joined?: ReadonlySet<string> } = {}): Promise<void> {
    if (!actor.userId || typeof topicId !== "number" || !Number.isInteger(topicId)) return;
    const room = `topic:${topicId}`;
    if (opts.joined && !opts.joined.has(room)) return;
    if (this.throttled(`t:${origin}:${topicId}`)) return;
    if (!(await this.deps.realtimeRooms.canType(actor, topicId))) return;
    const name = opts.name !== undefined ? opts.name : ((await this.deps.db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ?? null);
    await this.deps.realtime.publish(room, "typing", { topicId, userId: actor.userId, name }, { origin });
  }

  /** „scrie…” în chat (Chat Pro): doar membrii din camera de chat, cu aplicația pornită; numele e porecla din chat. */
  async chatTyping(actor: GcsActor, key: unknown, origin: string, opts: { joined?: ReadonlySet<string> } = {}): Promise<void> {
    if (!actor.userId || typeof key !== "string" || !CHAT_KEY.test(key)) return;
    const room = `chat:${key}`;
    if (opts.joined && !opts.joined.has(room)) return;
    if (this.throttled(`c:${origin}:${key}`)) return;
    if (!(await this.deps.chatPro.active())) return;
    const name = await this.deps.chatPro.displayName(actor.userId);
    await this.deps.realtime.publish(room, "chat:typing", { channel: key, userId: actor.userId, name }, { origin });
  }

  close(): void {
    for (const t of this.readerTimers.values()) clearTimeout(t);
    this.readerTimers.clear();
  }
}
