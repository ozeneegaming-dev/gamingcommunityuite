"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRealtimeClient, type GcsRealtimeClient } from "./transports";

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

/**
 * O singură conexiune live pe tab (specul etapei 4 §5, ediția Lite): websocket (`gcs-realtime`, ediția VPS), altfel
 * SSE, altfel polling — aceeași interfață pentru toate componentele. Transportul se alege la pornire, în ordinea
 * primită de la server (`/api/realtime/token`); unul care nu se conectează în câteva secunde e sărit. După o
 * reconectare se emite `resync`. Fără niciun transport, pagina merge normal (`connected = false`).
 */
export function GcsRealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<GcsRealtimeClient | null>(null);
  const listeners = useRef(new Map<string, Set<Listener>>());
  /** Camerele cerute și câte componente le cer (două liste de servere pe aceeași pagină nu se încurcă la plecare). */
  const rooms = useRef(new Map<string, number>());

  const dispatch = useCallback((event: string, data: unknown) => {
    for (const fn of listeners.current.get(event) ?? []) fn(data);
  }, []);

  useEffect(() => {
    // „off” până la prima conectare reușită (inclusiv când serviciul nu răspunde deloc).
    document.documentElement.dataset.realtime = "off";
    const client = createRealtimeClient({
      rooms: () => [...rooms.current.keys()],
      dispatch,
      onState: (state) => {
        setConnected(state.connected);
        document.documentElement.dataset.realtime = state.connected ? "on" : "off";
        if (state.transport) document.documentElement.dataset.realtimeTransport = state.transport;
      },
    });
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [dispatch]);

  const api = useMemo<GcsRealtimeApi>(
    () => ({
      connected,
      join: (room) => {
        rooms.current.set(room, (rooms.current.get(room) ?? 0) + 1);
        return clientRef.current?.join(room) ?? Promise.resolve(false);
      },
      leave: (room) => {
        const left = (rooms.current.get(room) ?? 1) - 1;
        if (left > 0) {
          rooms.current.set(room, left);
          return;
        }
        rooms.current.delete(room);
        clientRef.current?.leave(room);
      },
      on: (event, fn) => {
        const set = listeners.current.get(event) ?? new Set<Listener>();
        set.add(fn);
        listeners.current.set(event, set);
        return () => void set.delete(fn);
      },
      emit: (event, data) => {
        clientRef.current?.emit(event, data);
      },
    }),
    [connected],
  );

  return <RealtimeContext.Provider value={api}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): GcsRealtimeApi {
  return useContext(RealtimeContext);
}
