import { compileNameStylesCss, type GcsNameStyle } from "@gcs/core";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const CACHE_KEY = "name-styles:css";

/**
 * CSS-ul cu stilurile de nume ale grupurilor (spec §9), inclus în `layout.tsx`.
 * E cache-uit în Redis cu tag-ul `name-styles`, invalidat de `group.updated`, deci o schimbare din ACP
 * ajunge pe site la următoarea cerere (browserul îl păstrează maximum 60 s).
 */
export async function GET(): Promise<Response> {
  const { db, cache } = services();
  let css = await cache.get<string>(CACHE_KEY);
  if (css === null) {
    const groups = await db.group.findMany({ select: { key: true, color: true, nameStyle: true }, orderBy: { position: "asc" } });
    css = compileNameStylesCss(
      groups.map((g) => ({ key: g.key, color: g.color, nameStyle: (g.nameStyle as GcsNameStyle | null) ?? null })),
    );
    await cache.set(CACHE_KEY, css, { ttlSec: 3600, tags: ["name-styles"] });
  }
  return new Response(css, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}
