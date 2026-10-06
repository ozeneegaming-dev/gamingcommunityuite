import "server-only";
import type { GcsActor } from "@gcs/core";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";
import type { GcsChatRoomLabels } from "./GcsChatRoom";

/** Mute-ul activ al viewer-ului pe canal (pentru câmpul dezactivat, cu motiv și durată). */
export async function viewerMute(actor: GcsActor, key: string): Promise<{ reason: string; until: string | null } | null> {
  if (!actor.userId) return null;
  const { db, chat } = services();
  const channel = await db.chatChannel.findUnique({ where: { key }, select: { id: true } });
  const mute = channel ? await chat.activeMute(actor.userId, channel.id) : null;
  return mute ? { reason: mute.reason, until: mute.until?.toISOString() ?? null } : null;
}

export async function chatRoomLabels(): Promise<GcsChatRoomLabels> {
  const t = await getTranslations("chat");
  const keys = ["placeholder", "send", "empty", "older", "delete", "mute", "muted", "slowMode", "readOnly", "input"] as const;
  return Object.fromEntries(keys.map((k) => [k, t.raw(k) as string])) as GcsChatRoomLabels;
}
