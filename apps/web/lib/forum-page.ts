import "server-only";
import { GcsForbidden, GcsNotFound, type GcsActor } from "@gcs/core";
import { notFound } from "next/navigation";
import { services } from "./services";

/**
 * Rulează o citire a forumului pentru o pagină: „nu există” → 404, „fără acces” → `"forbidden"` (pagina afișează mesajul).
 */
export async function forumQuery<T>(fn: () => Promise<T>): Promise<T | "forbidden"> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof GcsNotFound) notFound();
    if (error instanceof GcsForbidden) return "forbidden";
    throw error;
  }
}

/** Parametrul `?page=` (număr întreg ≥ 1; altceva → 1). */
export function pageParam(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, 100_000) : 1;
}

/** Forumurile în care se pot muta topicuri (forumuri și Q&A vizibile actorului), pentru uneltele de moderare. */
export async function moveTargets(actor: GcsActor): Promise<{ id: number; name: string }[]> {
  const { db, permissions } = services();
  const forums = await db.forum.findMany({
    where: { type: { in: ["FORUM", "QA"] } },
    orderBy: [{ parentId: "asc" }, { position: "asc" }],
    select: { id: true, name: true },
  });
  const visible = await permissions.filterContainers(actor, "forums.view", forums.map((f) => ({ type: "forum", id: String(f.id) })));
  return forums.filter((f) => visible.has(String(f.id)));
}
