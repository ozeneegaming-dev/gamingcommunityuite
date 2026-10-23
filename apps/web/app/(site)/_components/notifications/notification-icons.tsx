import "server-only";
import { GcsIcon } from "@gcs/ui/icons";
import type { ReactNode } from "react";
import { services } from "@/lib/services";

/**
 * Iconițele categoriilor de notificări (după nume), randate o singură dată pe server pentru componentele client
 * (clopoțelul, toast-urile), care le aleg după `item.icon`.
 */
export async function notificationIcons(): Promise<Record<string, ReactNode>> {
  const catalog = await services()
    .notifications.catalog()
    .catch(() => []);
  const names = new Set(["fa-solid fa-bell", ...catalog.map((c) => c.icon)]);
  return Object.fromEntries([...names].map((n) => [n, <GcsIcon key={n} name={n} />]));
}
