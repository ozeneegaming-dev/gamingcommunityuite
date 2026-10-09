import { groupMentionsCss } from "@/lib/group-mentions";
import { pluginHost } from "@/lib/plugins";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * CSS-ul generat din ACP (spec §9): stilurile de nume ale grupurilor, stilurile alese de membri și ramele de avatar.
 * E cache-uit în Redis (tag-urile `name-styles`, `cosmetics`), deci o schimbare din ACP ajunge pe site la următoarea
 * cerere; URL-ul din `layout.tsx` are versiunea în query, iar browserul îl păstrează maximum 60 s.
 * Apoi pastilele mențiunilor de grup (culoarea și iconița fiecărui grup, Mențiuni v2) și, la final, aspectul publicat
 * de pluginuri (Studio VIP): numele și ramele per membru (`data-user-id`).
 */
export async function GET(): Promise<Response> {
  // Aspectul ține cont doar de pluginurile încărcate: gazda trebuie să fi pornit.
  await pluginHost();
  const [cosmetics, groupMentions, appearance] = await Promise.all([
    services().cosmetics.css(),
    groupMentionsCss().catch(() => ""),
    services().appearance.css().catch(() => ""),
  ]);
  const css = [cosmetics, groupMentions, appearance].filter(Boolean).join("\n");
  return new Response(css, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}
