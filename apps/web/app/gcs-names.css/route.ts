import { pluginHost } from "@/lib/plugins";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * CSS-ul generat din ACP (spec §9): stilurile de nume ale grupurilor, stilurile alese de membri și ramele de avatar.
 * E cache-uit în Redis (tag-urile `name-styles`, `cosmetics`), deci o schimbare din ACP ajunge pe site la următoarea
 * cerere; URL-ul din `layout.tsx` are versiunea în query, iar browserul îl păstrează maximum 60 s.
 * La final, aspectul publicat de pluginuri (Studio VIP): numele și ramele per membru (`data-user-id`).
 */
export async function GET(): Promise<Response> {
  // Aspectul ține cont doar de pluginurile încărcate: gazda trebuie să fi pornit.
  await pluginHost();
  const [cosmetics, appearance] = await Promise.all([services().cosmetics.css(), services().appearance.css().catch(() => "")]);
  const css = appearance ? `${cosmetics}\n${appearance}` : cosmetics;
  return new Response(css, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}
