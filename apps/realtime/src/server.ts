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
import { normalizePrivacy, toRef, userRefSelect } from "@gcs/modules";
import type { GcsServices } from "@gcs/modules/services";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Socket } from "socket.io";

const HEARTBEAT_MS = 30_000;
const TYPING_THROTTLE_MS = 3_000;
const TOPIC_ROOM = /^topic:(\d+)$/;
/** Lista „Citesc acum” se trimite cel mult o dată pe secundă pe topic. */
const READERS_DEBOUNCE_MS = 1_000;

type SocketData = { actor: GcsActor; viewer: GcsPresenceViewer; name: string | null; lastTyping: number };
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

/** IP-ul clientului: primul din `X-Forwarded-For` (în spatele Caddy), altfel adresa socket-ului. */
function clientIp(socket: Socket): string {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || socket.handshake.address;
}

/**
 * `gcs-realtime` (specul etapei 4 §5): Socket.io cu adaptorul Redis. Nu are logică de domeniu: autentifică socket-ul
 * cu tokenul de 5 minute, verifică accesul la camere (`GcsRealtimeRooms`) și trimite în camere mesajele publicate
 * de web/worker pe `gcs:rt`.
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
  const pub = services.redis.duplicate();
  const sub = services.redis.duplicate();
  io.adapter(createAdapter(pub, sub));

  // Mesajele publicate de web/worker: fiecare instanță le trimite doar socket-urilor proprii (toate sunt abonate).
  const rt = services.redis.duplicate();
  void rt.subscribe(REALTIME_CHANNEL).catch((error: unknown) => log("Abonarea la gcs:rt a eșuat", error));
  rt.on("message", (_channel, raw: string) => {
    const msg = parseRealtimeMessage(raw);
    if (msg) io.local.to(msg.room).emit(msg.event, msg.data);
  });

  // „Citesc acum”: după intrări și ieșiri, camera topicului primește lista cititorilor (fără cei cu statusul ascuns).
  const readerTimers = new Map<number, NodeJS.Timeout>();
  const broadcastReaders = (topicId: number) => {
    if (readerTimers.has(topicId)) return;
    const timer = setTimeout(() => {
      readerTimers.delete(topicId);
      void (async () => {
        const readers = await services.presence.topicReaders(topicId);
        const rows = await services.db.user.findMany({ where: { id: { in: readers.users } }, select: { ...userRefSelect, privacy: true } });
        const users = rows.filter((r) => normalizePrivacy(r.privacy).showOnline).map((r) => toRef(r));
        io.to(`topic:${topicId}`).emit("readers", { topicId, users, guests: readers.guests });
      })().catch((error: unknown) => log("Lista cititorilor nu a putut fi trimisă", error));
    }, READERS_DEBOUNCE_MS);
    timer.unref();
    readerTimers.set(topicId, timer);
  };

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
      socket.data = { actor, viewer: actor.userId ? { userId: actor.userId } : { guestId: claims.guestId }, name, lastTyping: 0 };
      next();
    })().catch((error: unknown) => {
      log("Autentificarea socket-ului a eșuat", error);
      next(new Error("unavailable"));
    });
  });

  io.on("connection", (socket: GcsSocket) => {
    const { actor, viewer } = socket.data;
    void socket.join(actor.userId ? [`user:${actor.userId}`, "presence"] : ["presence"]);
    void services.presence.touch(viewer).catch(() => {});

    socket.on("join", (room: unknown, ack?: unknown) => {
      const reply = typeof ack === "function" ? (ack as (r: { ok: boolean }) => void) : () => {};
      if (typeof room !== "string") return reply({ ok: false });
      services.realtimeRooms
        .canJoin(actor, room)
        .then(async (ok) => {
          if (ok) {
            await socket.join(room);
            const topic = TOPIC_ROOM.exec(room);
            if (topic) {
              await services.presence.touchTopic(Number(topic[1]), viewer);
              broadcastReaders(Number(topic[1]));
            }
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
      const topic = TOPIC_ROOM.exec(room);
      if (topic) void services.presence.leaveTopic(Number(topic[1]), viewer).then(() => broadcastReaders(Number(topic[1])), () => {});
    });

    socket.on("typing", (topicId: unknown) => {
      if (!actor.userId || typeof topicId !== "number" || !Number.isInteger(topicId)) return;
      const room = `topic:${topicId}`;
      if (!socket.rooms.has(room)) return;
      const now = Date.now();
      if (now - socket.data.lastTyping < TYPING_THROTTLE_MS) return;
      socket.data.lastTyping = now;
      void services.realtimeRooms
        .canType(actor, topicId)
        .then((ok) => {
          if (ok) socket.to(room).emit("typing", { topicId, userId: actor.userId, name: socket.data.name });
        })
        .catch(() => {});
    });

    socket.on("presence:ping", () => {
      void services.presence.touch(viewer).catch(() => {});
      for (const room of socket.rooms) {
        const topic = TOPIC_ROOM.exec(room);
        if (topic) void services.presence.touchTopic(Number(topic[1]), viewer).catch(() => {});
      }
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        const topic = TOPIC_ROOM.exec(room);
        if (topic) void services.presence.leaveTopic(Number(topic[1]), viewer).then(() => broadcastReaders(Number(topic[1])), () => {});
      }
    });
  });

  const beat = () => void writeServiceHeartbeat(services.redis, "realtime").catch((error: unknown) => log("Heartbeat-ul a eșuat", error));
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
      for (const t of readerTimers.values()) clearTimeout(t);
      await io.close();
      rt.disconnect();
      pub.disconnect();
      sub.disconnect();
    },
  };
}
