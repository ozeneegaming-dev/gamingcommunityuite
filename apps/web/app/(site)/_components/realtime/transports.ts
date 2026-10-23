import type { Socket } from "socket.io-client";

/**
 * Transporturile live ale tab-ului (ediția Lite): websocket (`gcs-realtime`), SSE (`/api/realtime/stream`) și polling
 * (`/api/realtime/poll`), cu aceeași interfață pentru `GcsRealtimeProvider`. Fără React, ca să se poată testa.
 */

export type GcsTransportKind = "websocket" | "sse" | "poll";
export type GcsRealtimeState = { connected: boolean; transport: GcsTransportKind | null };

export type GcsRealtimeClientOptions = {
  /** Camerele cerute acum de componente (la (re)conectare se cer din nou). */
  rooms: () => string[];
  dispatch: (event: string, data: unknown) => void;
  onState: (state: GcsRealtimeState) => void;
  /** Pentru teste: `fetch`, `EventSource`, `io` și ceasul. */
  env?: Partial<GcsRealtimeEnv>;
};

export type GcsRealtimeClient = {
  join(room: string): Promise<boolean>;
  leave(room: string): void;
  emit(event: string, data?: unknown): void;
  close(): void;
};

type TokenInfo = { token: string; url: string; transports?: GcsTransportKind[]; pollMs?: number };

export type GcsRealtimeEnv = {
  fetch: typeof fetch;
  EventSource: typeof EventSource | undefined;
  io: () => Promise<(url: string | undefined, opts: Record<string, unknown>) => Socket>;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
  forced: () => GcsTransportKind | null;
};

/** Cât așteaptă prima conectare a unui transport până trece la următorul. */
export const CONNECT_TIMEOUT_MS = 8_000;
const PING_MS = 60_000;
const DEFAULT_POLL_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
/** Cheia de depanare (și a testelor E2E) care forțează un transport: `localStorage["gcs-rt-transport"] = "poll"`. */
export const FORCE_TRANSPORT_KEY = "gcs-rt-transport";

function defaultEnv(): GcsRealtimeEnv {
  return {
    fetch: (...args) => fetch(...args),
    EventSource: typeof EventSource === "undefined" ? undefined : EventSource,
    io: async () => (await import("socket.io-client")).io as never,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    forced: () => {
      try {
        const v = localStorage.getItem(FORCE_TRANSPORT_KEY);
        return v === "websocket" || v === "sse" || v === "poll" ? v : null;
      } catch {
        return null;
      }
    },
  };
}

function randomCid(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Un transport pornit: `ready` = prima conectare reușită sau eșuată (atunci se încearcă următorul). */
type Transport = {
  ready: Promise<boolean>;
  join(room: string): Promise<boolean>;
  leave(room: string): void;
  emit(event: string, data?: unknown): void;
  close(): void;
};

type TransportCtx = GcsRealtimeClientOptions & {
  env: GcsRealtimeEnv;
  cid: string;
  token: TokenInfo;
  fetchToken: () => Promise<TokenInfo | null>;
  setConnected: (connected: boolean) => void;
};

export function createRealtimeClient(opts: GcsRealtimeClientOptions): GcsRealtimeClient {
  const env = { ...defaultEnv(), ...opts.env };
  const cid = randomCid();
  let closed = false;
  let current: Transport | null = null;

  const fetchToken = async (): Promise<TokenInfo | null> => {
    try {
      const res = await env.fetch("/api/realtime/token", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return null;
      return (await res.json()) as TokenInfo;
    } catch {
      return null;
    }
  };

  void (async () => {
    const token = await fetchToken();
    if (!token || closed) {
      opts.onState({ connected: false, transport: null });
      return;
    }
    const forced = env.forced();
    const order: GcsTransportKind[] = forced ? [forced] : (token.transports ?? ["websocket", "sse", "poll"]);
    for (const candidate of order) {
      if (closed) return;
      if (candidate === "sse" && !env.EventSource) continue;
      const ctx: TransportCtx = {
        ...opts,
        env,
        cid,
        token,
        fetchToken,
        setConnected: (connected) => {
          if (!closed && current === transport) opts.onState({ connected, transport: candidate });
        },
      };
      const transport = candidate === "websocket" ? await websocketTransport(ctx) : candidate === "sse" ? sseTransport(ctx) : pollTransport(ctx);
      current = transport;
      if (await transport.ready) return;
      transport.close();
      current = null;
    }
    opts.onState({ connected: false, transport: null });
  })();

  return {
    join: (room) => current?.join(room) ?? Promise.resolve(false),
    leave: (room) => current?.leave(room),
    emit: (event, data) => current?.emit(event, data),
    close: () => {
      closed = true;
      current?.close();
      current = null;
    },
  };
}

/** Promisiunea care se rezolvă o singură dată (prima conectare reușită sau eșecul ei). */
function once(): { promise: Promise<boolean>; settle: (ok: boolean) => void } {
  let settle!: (ok: boolean) => void;
  let done = false;
  const promise = new Promise<boolean>((resolve) => {
    settle = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
  });
  return { promise, settle };
}

async function websocketTransport(ctx: TransportCtx): Promise<Transport> {
  const { env } = ctx;
  const ready = once();
  const io = await env.io().catch(() => null);
  if (!io) {
    ready.settle(false);
    return { ready: ready.promise, join: async () => false, leave: () => {}, emit: () => {}, close: () => {} };
  }
  let everConnected = false;
  const socket = io(ctx.token.url || undefined, {
    transports: ["websocket"],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    // Tokenul expiră în 5 minute: la fiecare (re)conectare se cere unul nou.
    auth: (cb: (data: { token: string }) => void) => {
      void ctx.fetchToken().then((t) => cb({ token: t?.token ?? "" }));
    },
  });
  const timer = env.setTimeout(() => ready.settle(false), CONNECT_TIMEOUT_MS);
  socket.on("connect", () => {
    env.clearTimeout(timer);
    ready.settle(true);
    ctx.setConnected(true);
    for (const room of ctx.rooms()) socket.emit("join", room, () => {});
    if (everConnected) ctx.dispatch("resync", null);
    everConnected = true;
  });
  socket.on("disconnect", () => ctx.setConnected(false));
  socket.on("connect_error", () => {
    if (!everConnected) ctx.setConnected(false);
  });
  socket.onAny((event: string, data: unknown) => ctx.dispatch(event, data));
  const ping = setInterval(() => socket.connected && socket.emit("presence:ping"), PING_MS);
  return {
    ready: ready.promise,
    join: (room) => {
      if (!socket.connected) return Promise.resolve(false);
      return new Promise((resolve) => socket.emit("join", room, (r: { ok?: boolean } | undefined) => resolve(r?.ok === true)));
    },
    leave: (room) => void socket.emit("leave", room),
    emit: (event, data) => void socket.emit(event, data),
    close: () => {
      env.clearTimeout(timer);
      clearInterval(ping);
      socket.disconnect();
    },
  };
}

/** Mesajele clientului pe SSE / polling (`typing`, `chat:typing`, `presence:ping`, `leave`). */
function sendFn(ctx: TransportCtx) {
  return (event: string, data?: unknown) => {
    void ctx.env
      .fetch("/api/realtime/send", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cid: ctx.cid, event, data, ...(event === "presence:ping" ? { rooms: ctx.rooms().join(",") } : {}) }),
      })
      .catch(() => {});
  };
}

/** Așteptările `join` până la următoarea confirmare a serverului (lista camerelor acceptate). */
class PendingJoins {
  private readonly waiting = new Map<string, ((ok: boolean) => void)[]>();

  add(room: string): Promise<boolean> {
    return new Promise((resolve) => this.waiting.set(room, [...(this.waiting.get(room) ?? []), resolve]));
  }

  confirm(accepted: string[], requested: string[]): void {
    const ok = new Set(accepted);
    for (const room of requested) {
      for (const resolve of this.waiting.get(room) ?? []) resolve(ok.has(room));
      this.waiting.delete(room);
    }
  }

  failAll(): void {
    for (const list of this.waiting.values()) for (const resolve of list) resolve(false);
    this.waiting.clear();
  }
}

function sseTransport(ctx: TransportCtx): Transport {
  const { env } = ctx;
  const ES = env.EventSource!;
  const ready = once();
  const pending = new PendingJoins();
  const send = sendFn(ctx);
  let source: EventSource | null = null;
  let cursor: string | null = null;
  let closed = false;
  let everConnected = false;
  let backoff = 1000;
  let reopenTimer: unknown = null;
  const connectTimer = env.setTimeout(() => ready.settle(false), CONNECT_TIMEOUT_MS);

  const open = () => {
    if (closed) return;
    source?.close();
    const requested = ctx.rooms();
    const params = new URLSearchParams({ cid: ctx.cid, rooms: requested.join(",") });
    if (cursor) params.set("since", cursor);
    const es = new ES(`/api/realtime/stream?${params.toString()}`, { withCredentials: true });
    source = es;
    let helloSeen = false;
    es.addEventListener("hello", (e) => {
      const hello = JSON.parse((e as MessageEvent<string>).data) as { cursor: string; rooms: string[] };
      helloSeen = true;
      cursor ??= hello.cursor;
      backoff = 1000;
      env.clearTimeout(connectTimer);
      ready.settle(true);
      ctx.setConnected(true);
      pending.confirm(hello.rooms, requested);
      if (everConnected) ctx.dispatch("resync", null);
      everConnected = true;
    });
    es.addEventListener("cursor", (e) => {
      if ((e as MessageEvent).lastEventId) cursor = (e as MessageEvent).lastEventId;
    });
    es.addEventListener("resync", () => ctx.dispatch("resync", null));
    es.onmessage = (e: MessageEvent<string>) => {
      if (e.lastEventId) cursor = e.lastEventId;
      try {
        const m = JSON.parse(e.data) as { event: string; data: unknown };
        ctx.dispatch(m.event, m.data);
      } catch {
        // Un mesaj stricat se ignoră.
      }
    };
    es.onerror = () => {
      // Reconectarea o facem noi (cu camerele și cursorul curente), nu browserul.
      es.close();
      if (source !== es || closed) return;
      if (!helloSeen && !everConnected) {
        ready.settle(false);
        return;
      }
      ctx.setConnected(false);
      reopenTimer = env.setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
  };

  /** Camerele s-au schimbat: o singură redeschidere pentru toate schimbările din același moment. */
  let changeTimer: unknown = null;
  const reopenSoon = () => {
    if (changeTimer !== null) return;
    changeTimer = env.setTimeout(() => {
      changeTimer = null;
      open();
    }, 50);
  };

  open();
  const ping = setInterval(() => send("presence:ping"), PING_MS);
  return {
    ready: ready.promise,
    join: (room) => {
      const p = pending.add(room);
      reopenSoon();
      return p;
    },
    leave: (room) => {
      send("leave", room);
      reopenSoon();
    },
    emit: send,
    close: () => {
      closed = true;
      clearInterval(ping);
      env.clearTimeout(connectTimer);
      if (reopenTimer !== null) env.clearTimeout(reopenTimer);
      if (changeTimer !== null) env.clearTimeout(changeTimer);
      source?.close();
      pending.failAll();
    },
  };
}

function pollTransport(ctx: TransportCtx): Transport {
  const { env } = ctx;
  const ready = once();
  const pending = new PendingJoins();
  const send = sendFn(ctx);
  const interval = Math.max(2000, ctx.token.pollMs ?? DEFAULT_POLL_MS);
  let cursor: string | null = null;
  let closed = false;
  let everConnected = false;
  let failed = false;
  let timer: unknown = null;
  let lastPing = Date.now();
  let joinPending = true;
  let inFlight = false;

  const schedule = (ms: number) => {
    if (closed) return;
    if (timer !== null) env.clearTimeout(timer);
    timer = env.setTimeout(() => void poll(), ms);
  };

  const poll = async () => {
    if (closed || inFlight) return;
    inFlight = true;
    timer = null;
    const requested = ctx.rooms();
    const params = new URLSearchParams({ cid: ctx.cid, rooms: requested.join(",") });
    if (cursor) params.set("since", cursor);
    if (joinPending) params.set("join", "1");
    else if (Date.now() - lastPing >= PING_MS) {
      params.set("ping", "1");
      lastPing = Date.now();
    }
    joinPending = false;
    try {
      const res = await env.fetch(`/api/realtime/poll?${params.toString()}`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { cursor: string; rooms: string[]; events: { event: string; data: unknown }[]; reset: boolean };
      cursor = body.cursor;
      ready.settle(true);
      ctx.setConnected(true);
      pending.confirm(body.rooms, requested);
      if ((failed && everConnected) || body.reset) ctx.dispatch("resync", null);
      failed = false;
      everConnected = true;
      for (const e of body.events) ctx.dispatch(e.event, e.data);
      inFlight = false;
      schedule(interval);
    } catch {
      inFlight = false;
      if (!everConnected) {
        ready.settle(false);
        return;
      }
      failed = true;
      ctx.setConnected(false);
      schedule(Math.min(interval * 3, MAX_BACKOFF_MS));
    }
  };

  void poll();
  return {
    ready: ready.promise,
    join: (room) => {
      const p = pending.add(room);
      joinPending = true;
      schedule(0);
      return p;
    },
    leave: (room) => send("leave", room),
    emit: (event, data) => {
      if (event === "presence:ping") return;
      send(event, data);
    },
    close: () => {
      closed = true;
      if (timer !== null) env.clearTimeout(timer);
      pending.failAll();
    },
  };
}
