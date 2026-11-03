import { SITEMAP_CACHE_TTL } from "@gcs/modules";
import { siteBaseUrl } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * `/sitemap.xml` (ACP → Promovare → SEO): indexul sitemap-urilor, câte un fișier pe tip de conținut și bucată
 * (`/sitemap/topics-1.xml`…). Oprit din ACP → 404. Generat cel mult o dată la 15 minute (cache-ul aplicației, invalidat
 * de setări, permisiuni și topicuri noi), iar motoarele îl pot păstra la fel de mult.
 */
export async function GET(): Promise<Response> {
  const body = await services()
    .sitemap.indexXml(await siteBaseUrl())
    .catch(() => null);
  if (body === null) return new Response(null, { status: 404 });
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": `public, max-age=${SITEMAP_CACHE_TTL}, stale-while-revalidate=${SITEMAP_CACHE_TTL}` },
  });
}
