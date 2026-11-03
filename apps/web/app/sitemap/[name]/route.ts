import { SITEMAP_CACHE_TTL } from "@gcs/modules";
import { siteBaseUrl } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ name: string }> };

/** Un fișier al sitemap-ului (`/sitemap/topics-2.xml`): cel mult 10 000 de adrese, doar ce vede un vizitator. */
export async function GET(_req: Request, { params }: Props): Promise<Response> {
  const { name } = await params;
  const body = await services()
    .sitemap.chunkXml(await siteBaseUrl(), name)
    .catch(() => null);
  if (body === null) return new Response(null, { status: 404 });
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": `public, max-age=${SITEMAP_CACHE_TTL}, stale-while-revalidate=${SITEMAP_CACHE_TTL}` },
  });
}
