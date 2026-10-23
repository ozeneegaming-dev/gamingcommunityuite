import { randomUUID } from "node:crypto";
import { connectionRooms, parseCid, parseRooms, realtimeCaller } from "@/lib/realtime-fallback";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const RULE = { window: 60, max: 60 };
/** O conexiune durează cel mult 5 minute; clientul se reconectează cu ultimul cursor (fără mesaje pierdute). */
const MAX_STREAM_MS = 5 * 60_000;
/** Cât așteaptă bucla între citiri dacă nimic nu o trezește (alt proces, cron-ul, worker-ul scriu în jurnal). */
const WAIT_MS = 1_000;
const KEEPALIVE_MS = 15_000;
/** Unele proxy-uri (LiteSpeed, mod_deflate) țin primii ~2 KB: un comentariu de umplutură îi împinge imediat. */
const PADDING = `:${" ".repeat(2048)}\n\n`;

/**
 * Timpul real prin Server-Sent Events (ediția Lite, sau rezerva când websocket-ul nu merge): `GET
 * /api/realtime/stream?rooms=a,b&cid=…&since=…`. Primul mesaj e `hello` (cursorul și camerele acceptate), apoi
 * mesajele camerelor, fiecare cu `id` = cursorul (reconectarea automată a browserului reia de acolo).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { actor, viewer, ip } = await realtimeCaller();
  if (actor.isBanned) return Response.json({ error: "forbidden" }, { status: 403 });
  const s = services();
  const limit = await s.rateLimiter.consume(`rt-stream:${ip}`, RULE);
  if (!limit.allowed) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const { allowed, all } = await connectionRooms(actor, parseRooms(url.searchParams.get("rooms")));
  const cid = parseCid(url.searchParams.get("cid")) ?? randomUUID();
  const log = s.realtime.log;
  const hub = s.realtimeHub;
  // `Last-Event-ID` (reconectarea automată a browserului) e mai nou decât `since` din adresa inițială.
  let cursor = request.headers.get("last-event-id") || url.searchParams.get("since") || (await log.head());

  await s.presence.touch(viewer).catch(() => {});
  for (const room of allowed) await hub.joined(room, viewer).catch(() => {});

  const encoder = new TextEncoder();
  let closed = false;
  let wake: (() => void) | null = null;
  const offAppend = log.onAppend(() => wake?.());
  const finish = () => {
    if (closed) return;
    closed = true;
    offAppend();
    wake?.();
    for (const room of allowed) void hub.left(room, viewer).catch(() => {});
  };
  request.signal.addEventListener("abort", finish);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      send(PADDING);
      send(`event: hello\ndata: ${JSON.stringify({ cursor, rooms: allowed, cid })}\n\n`);
      const started = Date.now();
      let lastWrite = Date.now();
      try {
        while (!closed && Date.now() - started < MAX_STREAM_MS) {
          const read = await log.read(cursor, all);
          if (read.reset) send("event: resync\ndata: {}\n\n");
          for (const e of read.events) {
            if (e.origin === cid) continue;
            send(`id: ${e.id}\ndata: ${JSON.stringify({ event: e.event, data: e.data })}\n\n`);
            lastWrite = Date.now();
          }
          // Cursorul avansează și fără mesaje (alte camere): reconectarea nu reia de la zero.
          if (read.cursor !== cursor && read.events.length === 0) send(`id: ${read.cursor}\nevent: cursor\ndata: {}\n\n`);
          cursor = read.cursor;
          if (Date.now() - lastWrite > KEEPALIVE_MS) {
            send(": ping\n\n");
            lastWrite = Date.now();
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, WAIT_MS);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake = null;
        }
      } catch (error) {
        console.error("[gcs] fluxul SSE s-a oprit", error);
      } finally {
        finish();
        try {
          controller.close();
        } catch {
          // Deja închis de client.
        }
      }
    },
    cancel() {
      finish();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // `no-transform`: compresia (Next.js, proxy-ul gazdei) nu are voie să țină mesajele în buffer.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
