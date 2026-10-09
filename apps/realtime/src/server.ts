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
const CHAT_KEY = /^[a-z0-9][a-z0-9-]{1,40}$/;
/** Camerele cu listă de prezență: topicurile („Citesc acum”) și camerele de chat (lista celor online). */
const TRACKED_ROOM = /^(?:topic:\d+|chat:[a-z0-9][a-z0-9-]{1,40})$/;
/** Lista „Citesc acum” se trimite cel mult o dată pe secundă pe topic. */
const READERS_DEBOUNCE_MS = 1_000;

type SocketData = { actor: GcsActor; viewer: GcsPresenceViewer; name: string | null; lastTyping: number; lastChatTyping: number };
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

  // Prezența în cameră: după intrări și ieșiri, camera primește lista celor prezenți (fără cei cu statusul ascuns).
  // Topicurile o primesc ca „Citesc acum” (`topicId`), camerele de chat ca lista celor online (`channel`).
  const readerTimers = new Map<string, NodeJS.Timeout>();
  const broadcastReaders = (room: string) => {
    if (readerTimers.has(room)) return;
    const timer = setTimeout(() => {
      readerTimers.delete(room);
      void (async () => {
        const readers = await services.presence.roomMembers(room);
        const rows = await services.db.user.findMany({ where: { id: { in: readers.users } }, select: { ...userRefSelect, privacy: true } });
        const users = rows.filter((r) => normalizePrivacy(r.privacy).showOnline).map((r) => toRef(r));
        const topic = TOPIC_ROOM.exec(room);
        const payload = topic ? { topicId: Number(topic[1]), users, guests: readers.guests } : { channel: room.slice(5), users, guests: readers.guests };
        io.to(room).emit("readers", payload);
      })().catch((error: unknown) => log("Lista celor prezenți nu a putut fi trimisă", error));
    }, READERS_DEBOUNCE_MS);
    timer.unref();
    readerTimers.set(room, timer);
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
      socket.data = { actor, viewer: actor.userId ? { userId: actor.userId } : { guestId: claims.guestId }, name, lastTyping: 0, lastChatTyping: 0 };
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
            if (TRACKED_ROOM.test(room)) {
              await services.presence.touchRoom(room, viewer);
              broadcastReaders(room);
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
      if (TRACKED_ROOM.test(room)) void services.presence.leaveRoom(room, viewer).then(() => broadcastReaders(room), () => {});
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

    // „scrie…” în chat (Chat Pro): doar membrii din camera de chat, cu aplicația pornită; numele e porecla din chat.
    socket.on("chat:typing", (key: unknown) => {
      if (!actor.userId || typeof key !== "string" || !CHAT_KEY.test(key)) return;
      const room = `chat:${key}`;
      if (!socket.rooms.has(room)) return;
      const now = Date.now();
      if (now - socket.data.lastChatTyping < TYPING_THROTTLE_MS) return;
      socket.data.lastChatTyping = now;
      void (async () => {
        if (!(await services.chatPro.active())) return;
        const name = await services.chatPro.displayName(actor.userId!);
        socket.to(room).emit("chat:typing", { channel: key, userId: actor.userId, name });
      })().catch(() => {});
    });

    socket.on("presence:ping", () => {
      void services.presence.touch(viewer).catch(() => {});
      for (const room of socket.rooms) {
        if (TRACKED_ROOM.test(room)) void services.presence.touchRoom(room, viewer).catch(() => {});
      }
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (TRACKED_ROOM.test(room)) void services.presence.leaveRoom(room, viewer).then(() => broadcastReaders(room), () => {});
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
