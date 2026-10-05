import type { Prisma, Tag } from "@gcs/db";
import { GcsValidationError } from "../errors";

/** „Mașină” → `masina`; „#config” → `config`. Între 2 și 30 de caractere `[a-z0-9-]`, altfel `null`. */
export function normalizeTag(raw: string): string | null {
  const slug = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length >= 2 && slug.length <= 30 ? slug : null;
}

/** Tag-urile (spec §5, `GcsTagService`): normalizate, comune tuturor modulelor. Legătura cu conținutul o face modulul. */
export class GcsTagService {
  /** Tag-urile cu numele date (create dacă lipsesc), în ordinea primită și fără dubluri. */
  async ensure(tx: Prisma.TransactionClient, names: string[], max: number): Promise<Tag[]> {
    const slugs: string[] = [];
    for (const name of names) {
      const slug = normalizeTag(name);
      if (!slug) throw new GcsValidationError({ tags: "invalid" });
      if (!slugs.includes(slug)) slugs.push(slug);
    }
    if (slugs.length > max) throw new GcsValidationError({ tags: "too_many" }, { max: String(max) });
    if (slugs.length === 0) return [];
    await tx.tag.createMany({ data: slugs.map((slug) => ({ name: slug, slug })), skipDuplicates: true });
    const rows = await tx.tag.findMany({ where: { slug: { in: slugs } } });
    return slugs.map((slug) => rows.find((r) => r.slug === slug)!);
  }
}
