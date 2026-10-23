import "server-only";
import type { GcsActor } from "@gcs/core";
import { services } from "./services";

const VIEW_WINDOW_SEC = 3600;

/**
 * O vizualizare per user (sau IP, pentru vizitatori) per topic pe oră; contorul se incrementează direct în bază
 * (nu invalidează niciun cache: numărul apare la următoarea citire).
 */
export async function registerTopicView(actor: GcsActor, topicId: number): Promise<void> {
  const { kv, db } = services();
  try {
    const fresh = await kv.set(`gcs:view:${topicId}:${actor.userId ?? actor.ip}`, "1", { ttlMs: VIEW_WINDOW_SEC * 1000, nx: true });
    if (fresh) await db.topic.update({ where: { id: topicId }, data: { viewsCount: { increment: 1 } } });
  } catch {
    // Contorul de vizualizări nu trebuie să strice pagina (ex. stocarea cheilor indisponibilă).
  }
}
