import { pluginHost, pluginKeyParam } from "@/lib/plugins";

export const dynamic = "force-dynamic";

/**
 * `/plugins/<cheie>/assets/…` (etapa 6): fișierele client ale unui plugin încărcat. CSS-ul e cel închis în containerul
 * pluginului (nu fișierul brut), JS-ul doar pentru pluginurile semnate; HTML și SVG nu se servesc deloc.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ plugin: string; path: string[] }> }): Promise<Response> {
  const { plugin, path } = await ctx.params;
  const key = pluginKeyParam(plugin);
  if (!key) return new Response("Not found", { status: 404 });
  const asset = await (await pluginHost()).asset(key, path.map(decodeURIComponent).join("/"));
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(typeof asset.body === "string" ? asset.body : new Uint8Array(asset.body), {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
