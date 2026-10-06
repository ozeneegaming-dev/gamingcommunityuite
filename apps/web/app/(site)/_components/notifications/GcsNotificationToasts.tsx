"use client";

import { gcsToast, GcsToastHost, playNotificationSound } from "@gcs/ui";
import { useEffect } from "react";
import type { GcsNotificationItem } from "@/lib/notifications";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

/**
 * Toast-urile notificărilor (specul etapei 5): la o notificare nouă (evenimentul live `notification` cu `created`),
 * textul tradus vine din `/api/notifications` și apare în colțul din dreapta jos, cu un sunet scurt generat în browser.
 * Ambele se pot opri din Setări → Notificări.
 */
export function GcsNotificationToasts({ toasts, sound, closeLabel }: { toasts: boolean; sound: boolean; closeLabel: string }) {
  const realtime = useRealtime();
  useEffect(() => {
    if (!toasts && !sound) return;
    return realtime.on("notification", (data) => {
      const created = (data as { created?: unknown } | null)?.created;
      if (typeof created !== "number") return;
      if (sound) playNotificationSound();
      if (!toasts) return;
      void fetch("/api/notifications", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ items: GcsNotificationItem[] }>) : null))
        .then((res) => {
          const item = res?.items.find((i) => i.id === created);
          if (item) gcsToast({ title: item.text, ...(item.snippet ? { body: item.snippet } : {}), href: item.href });
        })
        .catch(() => {});
    });
  }, [realtime, toasts, sound]);
  return toasts ? <GcsToastHost closeLabel={closeLabel} /> : null;
}
