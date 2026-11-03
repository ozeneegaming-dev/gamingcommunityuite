import { buildRobotsTxt, SEO_SETTINGS } from "@gcs/modules";
import { siteBaseUrl } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * `robots.txt` (ACP → Promovare → SEO): cel implicit (fără ACP, API, installer, autentificare, căutare și paginile
 * private) sau textul adminului; linia `Sitemap:` apare cât timp sitemap-ul e pornit.
 */
export async function GET(): Promise<Response> {
  const base = await siteBaseUrl();
  let input = { mode: "default", custom: "", sitemap: true };
  try {
    const { settings } = services();
    const [mode, custom, sitemap] = await Promise.all([
      settings.get<string>(SEO_SETTINGS.robotsMode),
      settings.get<string>(SEO_SETTINGS.robotsCustom),
      settings.get<boolean>(SEO_SETTINGS.sitemapEnabled),
    ]);
    input = { mode, custom: typeof custom === "string" ? custom : "", sitemap: sitemap !== false };
  } catch {
    // Înainte de instalare (fără bază de date): cel implicit.
  }
  return new Response(buildRobotsTxt({ ...input, base }), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
