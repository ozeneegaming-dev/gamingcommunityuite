import { parseByteRange } from "@gcs/core";
import { pluginHost, pluginKeyParam } from "@/lib/plugins";

export const dynamic = "force-dynamic";

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * Un fișier media al pluginului (`/plugins/<cheie>/media/<id>.<ext>`, capabilitatea `media`): public, tipul verificat la
 * încărcare, cache lung (sub un id fișierul nu se schimbă), cereri `Range` pentru derularea audio/video.
 */
async function media(request: Request, key: string, file: string): Promise<Response> {
  let unsatisfiable = false;
  const opened = await (
    await pluginHost()
  ).mediaFile(key, file, (size) => {
    const range = parseByteRange(request.headers.get("range"), size);
    if (range === "unsatisfiable") {
      unsatisfiable = true;
      return null;
    }
    return range;
  });
  if (!opened) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = {
    ...SECURITY,
    "Content-Type": opened.mime,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    // Fișierul nu e o pagină: browserul nu rulează nimic din el, chiar deschis direct.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  };
  if (unsatisfiable) {
    await opened.body.cancel().catch(() => {});
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${opened.size}` } });
  }
  if (opened.range) {
    return new Response(opened.body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${opened.range.start}-${opened.range.end}/${opened.size}`, "Content-Length": String(opened.range.end - opened.range.start + 1) },
    });
  }
  return new Response(opened.body, { headers: { ...headers, "Content-Length": String(opened.size) } });
}

/**
 * `/plugins/<cheie>/assets/…` (etapa 6): fișierele client ale unui plugin încărcat. CSS-ul e cel închis în containerul
 * pluginului (nu fișierul brut), JS-ul doar pentru pluginurile semnate; HTML și SVG nu se servesc deloc.
 * `/plugins/<cheie>/media/…`: fișierele media încărcate (Studio VIP).
 */
export async function GET(request: Request, ctx: { params: Promise<{ plugin: string; path: string[] }> }): Promise<Response> {
  const { plugin, path } = await ctx.params;
  const key = pluginKeyParam(plugin);
  if (!key) return new Response("Not found", { status: 404 });
  const parts = path.map(decodeURIComponent);
  if (parts[0] === "media" && parts.length === 2) return media(request, key, parts[1]!);
  const asset = await (await pluginHost()).asset(key, parts.join("/"));
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(typeof asset.body === "string" ? asset.body : new Uint8Array(asset.body), {
    headers: { ...SECURITY, "Content-Type": asset.contentType, "Cache-Control": "public, max-age=3600" },
  });
}
