import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * CSS-ul generat din ACP (spec §9): stilurile de nume ale grupurilor, stilurile alese de membri și ramele de avatar.
 * E cache-uit în Redis (tag-urile `name-styles`, `cosmetics`), deci o schimbare din ACP ajunge pe site la următoarea
 * cerere; URL-ul din `layout.tsx` are versiunea în query, iar browserul îl păstrează maximum 60 s.
 */
export async function GET(): Promise<Response> {
  const css = await services().cosmetics.css();
  return new Response(css, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}
