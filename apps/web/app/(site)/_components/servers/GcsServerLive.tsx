"use client";

import type { GcsServerLive, GcsServerPlayer } from "@gcs/modules";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

type LiveState = {
  statuses: Record<number, GcsServerLive | null>;
  /** Lista jucătorilor serverului urmărit (pagina serverului); `undefined` = nu se urmărește. */
  players: GcsServerPlayer[] | null | undefined;
};

const LiveContext = createContext<LiveState>({ statuses: {}, players: undefined });

type Props = {
  initial: Record<number, GcsServerLive | null>;
  /** Intervalul de interogare din ACP: rezerva fără realtime cere statusurile la fel de des. */
  pollSeconds: number;
  /** Pagina unui server: și lista jucătorilor (cerută periodic, cu dreptul verificat de rută). */
  players?: { initial: GcsServerPlayer[] | null };
  children: ReactNode;
};

/**
 * Statusul live al serverelor de pe pagină (specul 2026-10-07-servere §5.3): camerele `servers:{id}` ale serviciului
 * realtime (evenimentul `servers:status`), iar fără realtime, `GET /api/servers/status` la intervalul de interogare.
 * Pagina unui server își cere și lista jucătorilor la același interval.
 */
export function GcsServerLiveProvider({ initial, pollSeconds, players, children }: Props) {
  const realtime = useRealtime();
  const [statuses, setStatuses] = useState(initial);
  const [list, setList] = useState<GcsServerPlayer[] | null | undefined>(players ? players.initial : undefined);
  const ids = useMemo(() => Object.keys(initial).map(Number), [initial]);
  const key = ids.join(",");
  const watchPlayers = players !== undefined && ids.length === 1;
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current || ids.length === 0) return;
    busy.current = true;
    try {
      const res = await fetch(`/api/servers/status?ids=${key}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { servers: GcsServerLive[]; players: GcsServerPlayer[] | null };
      setStatuses((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = data.servers.find((s) => s.id === id) ?? null;
        return next;
      });
      if (watchPlayers) setList(data.players);
    } catch {
      // Rețeaua a căzut: rămân valorile de acum.
    } finally {
      busy.current = false;
    }
    // `ids` derivă din `key`.
  }, [key, watchPlayers]);

  // Realtime: camerele serverelor; un status nou se aplică pe loc.
  useEffect(() => {
    if (!realtime.connected || ids.length === 0) return;
    for (const id of ids) void realtime.join(`servers:${id}`);
    const offStatus = realtime.on("servers:status", (data) => {
      const s = data as GcsServerLive;
      if (!s || typeof s.id !== "number" || !ids.includes(s.id)) return;
      setStatuses((prev) => ({ ...prev, [s.id]: s }));
    });
    const offResync = realtime.on("resync", () => void refresh());
    return () => {
      offStatus();
      offResync();
      for (const id of ids) realtime.leave(`servers:${id}`);
    };
    // `ids` derivă din `key`; `realtime` se schimbă doar odată cu `connected`.
  }, [realtime.connected, key, refresh]);

  // Rezerva fără realtime (și lista jucătorilor, care nu vine live): cererea periodică.
  useEffect(() => {
    if (realtime.connected && !watchPlayers) return;
    const timer = setInterval(() => void refresh(), Math.max(10, pollSeconds) * 1000);
    return () => clearInterval(timer);
  }, [realtime.connected, watchPlayers, pollSeconds, refresh]);

  const value = useMemo(() => ({ statuses, players: list }), [statuses, list]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useServerStatuses(): Record<number, GcsServerLive | null> {
  return useContext(LiveContext).statuses;
}

export function useServerStatus(id: number, fallback: GcsServerLive | null = null): GcsServerLive | null {
  const statuses = useContext(LiveContext).statuses;
  return id in statuses ? (statuses[id] ?? null) : fallback;
}

export function useServerPlayers(): GcsServerPlayer[] | null | undefined {
  return useContext(LiveContext).players;
}

/** Starea afișată: online, offline sau necunoscută (încă neinterogat / worker oprit). */
export function serverState(status: GcsServerLive | null): "online" | "offline" | "unknown" {
  if (!status) return "unknown";
  return status.online ? "online" : "offline";
}
