import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** `robots.txt`: fără ACP, API, installer și căutare; cu linkul spre sitemap. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await siteBaseUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/install", "/search", "/files/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
