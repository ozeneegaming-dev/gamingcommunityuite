import type { PrismaClient } from "@gcs/db";

/**
 * Cheia stilului numelui unui membru (`gcs-name--<cheie>`), la fel peste tot: stilul ales de membru (`ns_*`), altfel
 * grupul afișat (cel cu prioritatea cea mai mare dintre grupurile lui care au un stil, sau cel ales de membru), altfel
 * grupul principal. Efectul personal din Studio VIP vine peste ea, din CSS-ul generat (`data-user-id`).
 */
export const nameKeySelect = {
  primaryGroup: { select: { key: true } },
  nameStyle: { select: { key: true } },
  nameGroup: { select: { key: true } },
} as const;

export type GcsNameKeyRow = { primaryGroup: { key: string }; nameStyle: { key: string } | null; nameGroup?: { key: string } | null };

export function nameKeyOf(u: GcsNameKeyRow): string {
  return u.nameStyle?.key ?? u.nameGroup?.key ?? u.primaryGroup.key;
}

/**
 * Cheile stilurilor pentru niște membri (ex. mențiunile din conținutul salvat, numele din date care au doar id și
 * nume), într-o singură interogare. Id-urile necunoscute lipsesc din rezultat.
 */
export async function memberNameKeys(db: PrismaClient, ids: readonly string[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id)))].slice(0, 500);
  if (list.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: list } }, select: { id: true, ...nameKeySelect } });
  return new Map(rows.map((r) => [r.id, nameKeyOf(r)]));
}
