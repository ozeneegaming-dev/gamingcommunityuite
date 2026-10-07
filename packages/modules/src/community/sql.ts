import type { GcsActor, GcsPermissionService } from "@gcs/core";
import { Prisma } from "@gcs/db";

/** `timestamp` fără fus orar pentru SQL brut (coloanele sunt în UTC, scrise de Prisma). */
export const pgTimestamp = (d: Date) => d.toISOString().slice(0, -1);

/**
 * Cine vede ce profiluri în listele publice (Activitate, Clasament), după regula `GcsProfileService.canView`:
 * vizitatorii doar profilurile publice, membrii și pe cele „doar membri” (plus „doar urmăriți” dacă proprietarul îi
 * urmărește), staff-ul cu `profile.moderate` pe toate.
 */
export type GcsProfileAudience = "guest" | "member" | "staff";

export async function profileAudience(permissions: GcsPermissionService, viewer: GcsActor): Promise<GcsProfileAudience> {
  if (!viewer.userId) return "guest";
  return (await permissions.can(viewer, "profile.moderate")) ? "staff" : "member";
}

/**
 * Condiția SQL (cu `AND` în față) „profilul userului `u` e vizibil pentru viewer”. Fără `viewerId`, membrii nu văd
 * profilurile „doar urmăriți” (listele cache-uite pe public, ex. clasamentul).
 */
export function profileVisibleSql(u: Prisma.Sql, audience: GcsProfileAudience, viewerId: string | null = null): Prisma.Sql {
  if (audience === "staff") return Prisma.empty;
  // O valoare lipsă sau necunoscută înseamnă implicit „public” (`normalizePrivacy`).
  const level = Prisma.sql`COALESCE(${u}.privacy->>'profile', 'PUBLIC')`;
  if (audience === "guest") return Prisma.sql`AND ${level} NOT IN ('MEMBERS', 'FOLLOWED')`;
  if (!viewerId) return Prisma.sql`AND ${level} <> 'FOLLOWED'`;
  return Prisma.sql`AND (${u}.id = ${viewerId} OR ${level} <> 'FOLLOWED'
    OR EXISTS (SELECT 1 FROM follows fo WHERE fo."userId" = ${u}.id AND fo."contentType" = 'user' AND fo."contentId" = ${viewerId}))`;
}

/**
 * Condiția SQL „userul `u` nu e banat”: nici grupul „Banat” (principal sau secundar), nici un ban de cont activ
 * (de cont sau de email legat de cont, neridicat și neexpirat).
 */
export function notBannedSql(u: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM groups bg WHERE bg.id = ${u}."primaryGroupId" AND bg.key = 'banned')
    AND NOT EXISTS (SELECT 1 FROM user_groups bug JOIN groups bg2 ON bg2.id = bug."groupId" WHERE bug."userId" = ${u}.id AND bg2.key = 'banned')
    AND NOT EXISTS (SELECT 1 FROM bans bb WHERE bb."userId" = ${u}.id AND bb."liftedAt" IS NULL AND bb.type IN ('ACCOUNT', 'EMAIL')
      AND (bb."expiresAt" IS NULL OR bb."expiresAt" > (now() AT TIME ZONE 'UTC')))`;
}
