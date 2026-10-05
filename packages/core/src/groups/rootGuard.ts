import type { Prisma, PrismaClient } from "@gcs/db";
import { GcsConflict, GcsForbidden, GcsNotFound } from "../errors";
import type { GcsActor } from "../permissions/types";

type Db = Pick<PrismaClient, "group" | "user"> | Prisma.TransactionClient;

async function rootGroupId(db: Db): Promise<number> {
  const group = await db.group.findUniqueOrThrow({ where: { key: "root_admin" }, select: { id: true } });
  return group.id;
}

/** Userii din grupul `root_admin` (principal sau secundar). */
export function rootUsersWhere(rootId: number) {
  return { OR: [{ primaryGroupId: rootId }, { groups: { some: { groupId: rootId } } }] };
}

/**
 * Protecția Root Admin (spec §6.4, Review Focus #4):
 * - un actor care nu e Root Admin nu poate edita, retrograda, bana sau avertiza un Root Admin (`GcsForbidden`);
 * - o acțiune care i-ar lua ultimului Root Admin rolul (`removesRoot`) e refuzată pentru oricine,
 *   inclusiv pentru el însuși (`GcsConflict` cu `reason: "last_root"`).
 */
export async function assertCanManageUser(
  db: Db,
  actor: GcsActor,
  targetUserId: string,
  opts: { removesRoot?: boolean } = {},
): Promise<void> {
  const rootId = await rootGroupId(db);
  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { primaryGroupId: true, groups: { where: { groupId: rootId }, select: { groupId: true } } },
  });
  if (!target) throw new GcsNotFound({ entity: "user" });

  const targetIsRoot = target.primaryGroupId === rootId || target.groups.length > 0;
  if (!targetIsRoot) return;
  if (!actor.groupIds.includes(rootId)) throw new GcsForbidden({ reason: "root_protected" });

  if (opts.removesRoot) {
    const roots = await db.user.count({ where: rootUsersWhere(rootId) });
    if (roots <= 1) throw new GcsConflict({ reason: "last_root" });
  }
}

/** `true` dacă userul ar pierde grupul `root_admin` după schimbarea grupului principal în `newPrimaryGroupId`. */
export async function losesRootOnPrimaryChange(db: Db, userId: string, newPrimaryGroupId: number): Promise<boolean> {
  const rootId = await rootGroupId(db);
  if (newPrimaryGroupId === rootId) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { primaryGroupId: true, groups: { where: { groupId: rootId }, select: { groupId: true } } },
  });
  // `setPrimary` scoate noul grup principal din grupurile secundare, dar nu atinge `root_admin` secundar.
  return user?.primaryGroupId === rootId && user.groups.length === 0;
}

/** `true` dacă scoaterea grupului secundar `groupId` îi ia userului `root_admin`. */
export async function losesRootOnSecondaryRemoval(db: Db, userId: string, groupId: number): Promise<boolean> {
  const rootId = await rootGroupId(db);
  if (groupId !== rootId) return false;
  const user = await db.user.findUnique({ where: { id: userId }, select: { primaryGroupId: true } });
  return user !== null && user.primaryGroupId !== rootId;
}
