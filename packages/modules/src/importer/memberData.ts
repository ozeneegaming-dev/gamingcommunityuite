import type { GcsMemberDataHandler } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { IMPORT_DELETED_MEMBER } from "./engine/map";

/**
 * Harta importului (`import_map`, tipul `member`) la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri):
 * o ștergere marchează legătura (`deleted:<id>`), ca o rulare nouă a importului să nu recreeze membrul și să-i importe
 * conținutul fără autor; o unire mută legătura pe țintă, ca rulările noi să atribuie conținutul contului rămas.
 */
export function importerMemberData(deps: { db: PrismaClient }): GcsMemberDataHandler {
  const { db } = deps;
  return {
    key: "importer",
    summary: async () => [],
    erase: async ({ userId }) => (await db.importMap.updateMany({ where: { type: "member", targetId: userId }, data: { targetId: `${IMPORT_DELETED_MEMBER}${userId}` } })).count,
    merge: async ({ sourceId, targetId }) => (await db.importMap.updateMany({ where: { type: "member", targetId: sourceId }, data: { targetId } })).count,
  };
}
