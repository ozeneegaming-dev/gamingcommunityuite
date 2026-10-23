"use client";

import { gcsToast, GcsToastHost, playNotificationSound } from "@gcs/ui";
import { useEffect } from "react";
import type { GcsNotificationItem } from "@/lib/notifications";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { GcsRankUpToast } from "./GcsRankUpToast";

/**
 * Toast-urile notificărilor (specul etapei 5, Notificări v2): la o notificare nouă cu canalul „toast” pornit (evenimentul
 * live `notification` cu `created` și `toast`), textul tradus vine din `/api/notifications?id=…` și apare în colțul din
 * dreapta jos, cu un sunet scurt generat în browser. Comutatoarele generale (toast-uri, sunet) sunt în Setări → Notificări;
 * canalul pe tip îl alege membrul în tabelul de acolo. Click pe toast → notificarea, numărată pe canalul „toast”.
 */
export function GcsNotificationToasts({ toasts, sound, closeLabel }: { toasts: boolean; sound: boolean; closeLabel: string }) {
  const realtime = useRealtime();
  useEffect(() => {
    if (!toasts && !sound) return;
    return realtime.on("notification", (data) => {
      const payload = (data as { created?: unknown; toast?: unknown } | null) ?? {};
      const created = payload.created;
      if (typeof created !== "number" || payload.toast === false) return;
      if (sound) playNotificationSound();
      if (!toasts) return;
      void fetch(`/api/notifications?id=${created}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ items: GcsNotificationItem[] }>) : null))
        .then((res) => {
          const item = res?.items.find((i) => i.id === created);
          if (item) gcsToast({ title: item.text, ...(item.snippet ? { body: item.snippet } : {}), href: `/notifications/${item.id}?via=toast` });
        })
        .catch(() => {});
    });
  }, [realtime, toasts, sound]);
  // Realizări v2: urcarea în rang are propriul toast de sărbătorire (tot cu toast-urile pornite).
  return toasts ? (
    <>
      <GcsToastHost closeLabel={closeLabel} />
      <GcsRankUpToast />
    </>
  ) : null;
}
