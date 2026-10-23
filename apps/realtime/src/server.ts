import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  parseRealtimeMessage,
  REALTIME_CHANNEL,
  verifyRealtimeToken,
  writeServiceHeartbeat,
  type GcsActor,
  type GcsPresenceViewer,
} from "@gcs/core";
import { TRACKED_ROOM } from "@gcs/modules";
import type { GcsServices } from "@gcs/modules/services";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Socket } from "socket.io";

const HEARTBEAT_MS = 30_000;

type SocketData = { actor: GcsActor; viewer: GcsPresenceViewer; name: string | null };
type GcsSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

export type GcsRealtimeServer = {
  http: HttpServer;
  io: Server;
  listen: (port: number) => Promise<number>;
  close: () => Promise<void>;
};

function log(message: string, error?: unknown): void {
  const line = { time: new Date().toISOString(), service: "gcs-realtime", message, ...(error ? { error: String(error) } : {}) };
  (error ? console.error : console.log)(JSON.stringify(line));
}

/**
 * IP-ul clientului: `X-Real-IP` (suprascris de proxy), altfel ultima adresă din `X-Forwarded-For` (cea adăugată de
 * proxy; primele pot veni chiar de la client), altfel adresa socket-ului. La fel ca `clientIp` din web.
 */
function clientIp(socket: Socket): string {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(",") : v);
  const real = one(socket.handshake.headers["x-real-ip"])?.trim();
  if (real) return real;
  const last = one(socket.handshake.headers["x-forwarded-for"])
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);
  return last || socket.handshake.address;
}

/**
 * `gcs-realtime` (specul etapei 4 §5): Socket.io cu adaptorul Redis. Nu are logică de domeniu: autentifică socket-ul
 * cu tokenul de 5 minute, lasă accesul la camere, prezența și „scrie…” hub-ului comun (`GcsRealtimeHub`, același
 * pentru SSE și polling) și trimite în camere mesajele publicate de web/worker pe `gcs:rt`.
 */
export function createRealtimeServer(opts: { services: GcsServices; secret: string; corsOrigin: string | string[] | boolean }): GcsRealtimeServer {
  const { services, secret } = opts;
  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      return;
    }
    res.writeHead(404).end();
  });
  const io = new Server(http, { cors: { origin: opts.corsOrigin, credentials: true }, serveClient: false });

  // Adaptorul Redis: `socket.to(room)` (ex. „scrie…”) ajunge și la socket-urile altor instanțe.
  const redis = services.infra.redis;
  if (!redis) throw new Error("gcs-realtime are nevoie de Redis (ediția VPS)");
  const hub = services.realtimeHub;
  const pub = redis.duplicate();
  const sub = redis.duplicate();
  io.adapter(createAdapter(pub, sub));

  // Mesajele publicate de web/worker: fiecare instanță le trimite doar socket-urilor proprii (toate sunt abonate).
  const rt = redis.duplicate();
  void rt.subscribe(REALTIME_CHANNEL).catch((error: unknown) => log("Abonarea la gcs:rt a eșuat", error));
  rt.on("message", (_channel, raw: string) => {
    const msg = parseRealtimeMessage(raw);
    // `origin` = socket-ul care a produs mesajul (ex. „scrie…”): nu-l primește înapoi.
    if (msg) (msg.origin ? io.local.to(msg.room).except(msg.origin) : io.local.to(msg.room)).emit(msg.event, msg.data);
  });

  io.use((socket: GcsSocket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    void (async () => {
      const claims = typeof token === "string" ? await verifyRealtimeToken(token, secret) : null;
      if (!claims) return next(new Error("unauthorized"));
      const ip = clientIp(socket);
      const actor = claims.userId ? await services.actors.forUser(claims.userId, ip) : await services.actors.forGuest(ip);
      if (actor.isBanned) return next(new Error("forbidden"));
      const name = actor.userId
        ? ((await services.db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ?? null)
        : null;
      socket.data = { actor, viewer: hub.viewerOf(actor, claims.guestId), name };
      next();
    })().catch((error: unknown) => {
      log("Autentificarea socket-ului a eșuat", error);
      next(new Error("unavailable"));
    });
  });

  io.on("connection", (socket: GcsSocket) => {
    const { actor, viewer } = socket.data;
    void socket.join(hub.baseRooms(actor));
    void services.presence.touch(viewer).catch(() => {});

    socket.on("join", (room: unknown, ack?: unknown) => {
      const reply = typeof ack === "function" ? (ack as (r: { ok: boolean }) => void) : () => {};
      if (typeof room !== "string") return reply({ ok: false });
      services.realtimeRooms
        .canJoin(actor, room)
        .then(async (ok) => {
          if (ok) {
            await socket.join(room);
            await hub.joined(room, viewer);
          }
          reply({ ok });
        })
        .catch((error: unknown) => {
          log(`Intrarea în ${room} a eșuat`, error);
          reply({ ok: false });
        });
    });

    socket.on("leave", (room: unknown) => {
      if (typeof room !== "string" || room.startsWith("user:") || room === "presence") return;
      void socket.leave(room);
      void hub.left(room, viewer).catch(() => {});
    });

    socket.on("typing", (topicId: unknown) => {
      void hub.typing(actor, topicId, socket.id, { name: socket.data.name, joined: socket.rooms }).catch(() => {});
    });

    // „scrie…” în chat (Chat Pro): doar membrii din camera de chat, cu aplicația pornită; numele e porecla din chat.
    socket.on("chat:typing", (key: unknown) => {
      void hub.chatTyping(actor, key, socket.id, { joined: socket.rooms }).catch(() => {});
    });

    socket.on("presence:ping", () => {
      void hub.ping(viewer, socket.rooms).catch(() => {});
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (TRACKED_ROOM.test(room)) void hub.left(room, viewer).catch(() => {});
      }
    });
  });

  const beat = () => void writeServiceHeartbeat(services.kv, "realtime").catch((error: unknown) => log("Heartbeat-ul a eșuat", error));
  let timer: NodeJS.Timeout | undefined;

  return {
    http,
    io,
    listen: (port) =>
      new Promise((resolve) => {
        http.listen(port, () => {
          beat();
          timer = setInterval(beat, HEARTBEAT_MS);
          timer.unref();
          resolve((http.address() as AddressInfo).port);
        });
      }),
    close: async () => {
      if (timer) clearInterval(timer);
      hub.close();
      await io.close();
      rt.disconnect();
      pub.disconnect();
      sub.disconnect();
    },
  };
}
