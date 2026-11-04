import "server-only";
import { POLL_INTERVAL_SETTING, type GcsServerFieldsShown, type GcsServerListStyle } from "@gcs/modules";
import type { GcsSlotJson } from "@gcs/core";
import { cache } from "react";
import { currentActor } from "@/lib/actor";
import { cardsData } from "@/lib/servers";
import { services } from "@/lib/services";
import type { GcsServerCardData } from "../types";

/**
 * Serverele vizibile vizitatorului, ca date de card (statusul din poller, imaginea hărții, adminii online), o singură
 * dată pe cerere oricâte componente de forum le folosesc (rândurile, cipurile, banda categoriei, cardul mare).
 */
export const forumServerData = cache(async (): Promise<{ byId: Map<number, GcsServerCardData>; pollSeconds: number }> => {
  const actor = await currentActor();
  const { serverQueries, settings } = services();
  const [views, pollSeconds] = await Promise.all([serverQueries.list(actor), settings.get<number>(POLL_INTERVAL_SETTING)]);
  const cards = await cardsData(actor, views);
  return { byId: new Map(cards.map((c) => [c.id, c])), pollSeconds };
});

/** Props-urile JSON ale extensiei, verificate (o componentă nu are încredere în ce primește). */
export const propId = (v: GcsSlotJson | undefined): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);
export const propIds = (v: GcsSlotJson | undefined): number[] => (Array.isArray(v) ? v.map(propId).filter((x): x is number => x !== null).slice(0, 100) : []);
export const propStyle = (v: GcsSlotJson | undefined): GcsServerListStyle => (v === "compact" || v === "status" ? v : "full");
export function propFields(v: GcsSlotJson | undefined): GcsServerFieldsShown {
  const o = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const b = (k: string) => (typeof o[k] === "boolean" ? (o[k] as boolean) : true);
  return { status: b("status"), players: b("players"), map: b("map"), address: b("address"), connect: b("connect"), top: b("top") };
}
