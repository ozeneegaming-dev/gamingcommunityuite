import "server-only";
import type { PrismaClient } from "@gcs/db";

export type GcsForumGroup = { category: string | null; forums: { id: number; name: string }[] };

/**
 * Forumurile în care se poate posta (forum și Q&A), grupate pe categoria lor de sus, în ordinea din structură: pentru
 * selectoarele de forumuri din ACP (o listă lungă de bife devine grupuri cu „Toate”).
 */
export async function forumGroups(db: PrismaClient, types: ("FORUM" | "QA" | "PAGE")[] = ["FORUM", "QA"]): Promise<GcsForumGroup[]> {
  const rows = await db.forum.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, parentId: true, type: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const categoryOf = (id: number): { id: number; name: string } | null => {
    let cur = byId.get(id);
    let top: { id: number; name: string } | null = null;
    for (let guard = 0; cur && guard < 50; guard++) {
      if (cur.type === "CATEGORY") top = { id: cur.id, name: cur.name };
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
    }
    return top;
  };
  const groups = new Map<number | null, GcsForumGroup>();
  for (const r of rows) {
    if (!(types as string[]).includes(r.type)) continue;
    const cat = categoryOf(r.id);
    const key = cat?.id ?? null;
    if (!groups.has(key)) groups.set(key, { category: cat?.name ?? null, forums: [] });
    groups.get(key)!.forums.push({ id: r.id, name: r.name });
  }
  return [...groups.values()];
}
