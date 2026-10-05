import type Redis from "ioredis";

/** Canalul Redis pe care `gcs-realtime` ascultă mesajele de trimis în camere. */
export const REALTIME_CHANNEL = "gcs:rt";

export type GcsRealtimeMessage = { room: string; event: string; data: unknown };

/**
 * Publicarea live (specul etapei 4 §5): web-ul și worker-ul publică în Redis, `gcs-realtime` trimite mai departe.
 * Erorile sunt înghițite: o pagină nu cade fiindcă serviciul live nu răspunde.
 */
export class GcsRealtime {
  constructor(private readonly redis: Pick<Redis, "publish">) {}

  async publish(room: string, event: string, data: unknown): Promise<void> {
    try {
      await this.redis.publish(REALTIME_CHANNEL, JSON.stringify({ room, event, data } satisfies GcsRealtimeMessage));
    } catch (error) {
      console.error(`[gcs] publicarea live „${event}” în ${room} a eșuat`, error);
    }
  }
}

/** Parsează un mesaj de pe canal; `null` dacă nu are forma așteptată. */
export function parseRealtimeMessage(raw: string): GcsRealtimeMessage | null {
  try {
    const m = JSON.parse(raw) as Partial<GcsRealtimeMessage>;
    return typeof m.room === "string" && typeof m.event === "string" ? { room: m.room, event: m.event, data: m.data } : null;
  } catch {
    return null;
  }
}
