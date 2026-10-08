import { BRIDGE_BASE_PATH, bridgeBodyLimit } from "@gcs/modules";
import { clientIp } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Corpul cererii, citit cel mult până la limita protocolului (512 KB; bucățile demo-urilor 1 MiB) + 1 octet: un corp mai
 * mare nu se încarcă în memorie (API-ul răspunde 413 după primul octet în plus).
 */
async function readLimited(req: Request, max: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Protocolul pluginurilor de server (specul 2026-10-08-servere-bridge §6): `{site}/api/servers/bridge/v1/…`. Serverele
 * de joc se autentifică singure (cheia pe server, semnătura, nonce-ul, ceasul); ruta doar transportă cererea: calea
 * exact cum a fost trimisă (cu query-ul, parte din semnătură), corpul brut (hash-ul lui e semnat) și IP-ul clientului.
 */
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.startsWith(BRIDGE_BASE_PATH) ? url.pathname.slice(BRIDGE_BASE_PATH.length) + url.search : url.pathname + url.search;
  const declared = Number(req.headers.get("content-length") ?? "0");
  const max = bridgeBodyLimit(path);
  const body = declared > max ? new Uint8Array(max + 1) : await readLimited(req, max);
  const res = await services().bridge.api.handle({
    method: req.method,
    path,
    header: (name) => req.headers.get(name),
    body,
    ip: clientIp(req.headers),
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
}

export const GET = handle;
export const POST = handle;
