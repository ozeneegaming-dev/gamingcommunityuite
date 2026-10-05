import type { GcsCache } from "./cache";

/** Un eveniment de domeniu. `name` are forma `entitate.acțiune`; `tags` sunt tag-urile de cache afectate. */
export type GcsEvent = { name: string; payload: Record<string, unknown>; tags: string[] };

export type GcsEventListener = (e: GcsEvent) => Promise<void>;

/**
 * Magistrala de evenimente (spec §15). Orice scriere emite un eveniment, iar `emit`:
 * 1. invalidează tag-urile în cache-ul Redis;
 * 2. apelează `revalidate` (în Next.js: `revalidateTag`) pentru fiecare tag;
 * 3. rulează listenerii evenimentului, în ordinea înregistrării (o eroare e logată și nu-i oprește pe ceilalți);
 * 4. apelează `publish` (ex. Redis pub/sub pentru serviciul realtime).
 */
export class GcsEventBus {
  private readonly listeners = new Map<string, GcsEventListener[]>();

  constructor(
    private readonly deps: {
      cache: GcsCache;
      revalidate?: (tag: string) => void;
      publish?: (e: GcsEvent) => Promise<void>;
    },
  ) {}

  on(name: string, fn: GcsEventListener): void {
    const list = this.listeners.get(name);
    if (list) list.push(fn);
    else this.listeners.set(name, [fn]);
  }

  async emit(e: GcsEvent): Promise<void> {
    await this.deps.cache.invalidateTags(e.tags);
    if (this.deps.revalidate) {
      for (const tag of e.tags) this.deps.revalidate(tag);
    }
    for (const fn of this.listeners.get(e.name) ?? []) {
      try {
        await fn(e);
      } catch (error) {
        console.error(`[gcs] listener pentru „${e.name}” a eșuat`, error);
      }
    }
    await this.deps.publish?.(e);
  }
}
