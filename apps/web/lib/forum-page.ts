import "server-only";
import { GcsForbidden, GcsNotFound } from "@gcs/core";
import { notFound } from "next/navigation";

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
