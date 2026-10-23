import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { GcsActor } from "@gcs/core";
import { cookies } from "next/headers";
import { services } from "./services";

/**
 * Forumurile cu parolă (Forum v2): după parola corectă, vizitatorul primește un cookie semnat per forum (30 de zile).
 * Semnătura include hash-ul parolei, deci o parolă schimbată închide din nou forumul pentru toți. Moderatorii forumului
 * intră fără parolă.
 */
const COOKIE = (forumId: number) => `gcs-forum-${forumId}`;
const MAX_AGE = 30 * 86_400;

function token(forumId: number, passwordHash: string): string {
  const secret = process.env.GCS_SECRET ?? "gcs-dev-secret";
  return createHmac("sha256", secret).update(`forum:${forumId}:${passwordHash}`).digest("base64url").slice(0, 32);
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Moderator pe forum (puteri pe el sau `forums.moderate_all`). */
async function isForumModerator(actor: GcsActor, forumId: number): Promise<boolean> {
  if (!actor.userId) return false;
  const { permissions } = services();
  return (await permissions.can(actor, "forums.moderate_all")) || (await permissions.moderatorPowers(actor, { type: "forum", id: String(forumId) })).length > 0;
}

/** Forumul are parolă și vizitatorul nu a deblocat-o (și nu e moderator). */
export async function forumLocked(actor: GcsActor, forumId: number): Promise<boolean> {
  const forum = await services().db.forum.findUnique({ where: { id: forumId }, select: { passwordHash: true } });
  if (!forum?.passwordHash) return false;
  if (await isForumModerator(actor, forumId)) return false;
  const value = (await cookies()).get(COOKIE(forumId))?.value ?? "";
  return !same(value, token(forumId, forum.passwordHash));
}

/** Pune cookie-ul de deblocare (după ce parola a fost verificată). */
export async function rememberForumUnlock(forumId: number, passwordHash: string): Promise<void> {
  (await cookies()).set(COOKIE(forumId), token(forumId, passwordHash), { httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE, secure: process.env.NODE_ENV === "production" && (process.env.GCS_BASE_URL ?? "").startsWith("https:") });
}
