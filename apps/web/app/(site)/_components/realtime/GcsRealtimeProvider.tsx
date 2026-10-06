"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";

type Listener = (data: unknown) => void;

export type GcsRealtimeApi = {
  connected: boolean;
  /** Intră într-o cameră; răspunsul serverului spune dacă accesul a fost acordat. Camerele se refac la reconectare. */
  join: (room: string) => Promise<boolean>;
  leave: (room: string) => void;
  /** Ascultă un eveniment al serverului (sau `resync`, emis local după o reconectare). Întoarce dezabonarea. */
  on: (event: string, fn: Listener) => () => void;
  emit: (event: string, data?: unknown) => void;
};

const noop = () => {};
const RealtimeContext = createContext<GcsRealtimeApi>({ connected: false, join: async () => false, leave: noop, on: () => noop, emit: noop });

const PING_MS = 60_000;

async function fetchToken(): Promise<{ token: string; url: string } | null> {
  try {
    const res = await fetch("/api/realtime/token", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    return (await res.json()) as { token: string; url: string };
  } catch {
    return null;
  }
}

/**
 * O singură conexiune Socket.io pe tab (specul etapei 4 §5): token de 5 minute cerut la fiecare (re)conectare,
 * reconectare cu backoff (1 s → 30 s), `presence:ping` la 60 s și `resync` după reconectare.
 * Fără serviciul realtime, pagina merge normal (`connected = false`).
 */
export function GcsRealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const listeners = useRef(new Map<string, Set<Listener>>());
  const rooms = useRef(new Set<string>());

  const dispatch = useCallback((event: string, data: unknown) => {
    for (const fn of listeners.current.get(event) ?? []) fn(data);
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: Socket | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    let everConnected = false;
    // „off” până la prima conectare reușită (inclusiv când serviciul nu răspunde deloc).
    document.documentElement.dataset.realtime = "off";

    void (async () => {
      const first = await fetchToken();
      if (!first || disposed) {
        document.documentElement.dataset.realtime = "off";
        return;
      }
      const { io } = await import("socket.io-client");
      if (disposed) return;
      socket = io(first.url || undefined, {
        transports: ["websocket"],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30_000,
        // Tokenul expiră în 5 minute: la fiecare (re)conectare se cere unul nou.
        auth: (cb) => {
          void fetchToken().then((t) => cb({ token: t?.token ?? "" }));
        },
      });
      socketRef.current = socket;
      socket.on("connect", () => {
        setConnected(true);
        document.documentElement.dataset.realtime = "on";
        for (const room of rooms.current) socket!.emit("join", room, noop);
        if (everConnected) dispatch("resync", null);
        everConnected = true;
      });
      socket.on("disconnect", () => {
        setConnected(false);
        document.documentElement.dataset.realtime = "off";
      });
      socket.on("connect_error", () => {
        document.documentElement.dataset.realtime = "off";
      });
      socket.onAny((event: string, data: unknown) => dispatch(event, data));
      ping = setInterval(() => socket?.connected && socket.emit("presence:ping"), PING_MS);
    })();

    return () => {
      disposed = true;
      if (ping) clearInterval(ping);
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [dispatch]);

  const api = useMemo<GcsRealtimeApi>(
    () => ({
      connected,
      join: (room) => {
        rooms.current.add(room);
        const socket = socketRef.current;
        if (!socket?.connected) return Promise.resolve(false);
        return new Promise((resolve) => socket.emit("join", room, (r: { ok?: boolean } | undefined) => resolve(r?.ok === true)));
      },
      leave: (room) => {
        rooms.current.delete(room);
        socketRef.current?.emit("leave", room);
      },
      on: (event, fn) => {
        const set = listeners.current.get(event) ?? new Set<Listener>();
        set.add(fn);
        listeners.current.set(event, set);
        return () => void set.delete(fn);
      },
      emit: (event, data) => {
        socketRef.current?.emit(event, data);
      },
    }),
    [connected],
  );

  return <RealtimeContext.Provider value={api}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): GcsRealtimeApi {
  return useContext(RealtimeContext);
}
