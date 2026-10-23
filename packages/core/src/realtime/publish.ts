import type { GcsRealtimeLog } from "./log";

/** Canalul Redis pe care `gcs-realtime` ascultă mesajele de trimis în camere. */
export const REALTIME_CHANNEL = "gcs:rt";

/** `origin` = conexiunea care a produs mesajul (ex. „scrie…”): ea nu-l primește înapoi. */
export type GcsRealtimeMessage = { room: string; event: string; data: unknown; origin?: string };

/**
 * Publicarea live (specul etapei 4 §5): web-ul și worker-ul publică prin jurnalul live (`GcsRealtimeLog`): în VPS,
 * Redis pub/sub pentru `gcs-realtime` (websocket) plus un Redis Stream pentru transporturile de rezervă (SSE, polling);
 * în Lite, tabelul `gcs_realtime_events`. Erorile sunt înghițite: o pagină nu cade fiindcă serviciul live nu răspunde.
 */
export class GcsRealtime {
  constructor(readonly log: GcsRealtimeLog) {}

  async publish(room: string, event: string, data: unknown, opts: { origin?: string } = {}): Promise<void> {
    try {
      await this.log.append({ room, event, data, ...(opts.origin ? { origin: opts.origin } : {}) });
    } catch (error) {
      console.error(`[gcs] publicarea live „${event}” în ${room} a eșuat`, error);
    }
  }
}

/** Parsează un mesaj de pe canal; `null` dacă nu are forma așteptată. */
export function parseRealtimeMessage(raw: string): GcsRealtimeMessage | null {
  try {
    const m = JSON.parse(raw) as Partial<GcsRealtimeMessage>;
    if (typeof m.room !== "string" || typeof m.event !== "string") return null;
    return { room: m.room, event: m.event, data: m.data, ...(typeof m.origin === "string" ? { origin: m.origin } : {}) };
  } catch {
    return null;
  }
}
