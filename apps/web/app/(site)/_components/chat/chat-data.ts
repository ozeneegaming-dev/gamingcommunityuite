import "server-only";
import type { GcsActor } from "@gcs/core";
import type { GcsChatChannelView } from "@gcs/modules";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";
import type { GcsChatRoom, GcsChatRoomLabels } from "./GcsChatRoom";

/** Mute-ul activ al viewer-ului pe canal (pentru câmpul dezactivat, cu motiv și durată). */
export async function viewerMute(actor: GcsActor, key: string): Promise<{ reason: string; until: string | null } | null> {
  if (!actor.userId) return null;
  const { db, chat } = services();
  const channel = await db.chatChannel.findUnique({ where: { key }, select: { id: true } });
  const mute = channel ? await chat.activeMute(actor.userId, channel.id) : null;
  return mute ? { reason: mute.reason, until: mute.until?.toISOString() ?? null } : null;
}

const LABEL_KEYS = [
  "placeholder",
  "send",
  "empty",
  "older",
  "delete",
  "mute",
  "muted",
  "slowMode",
  "readOnly",
  "input",
  "edit",
  "editInput",
  "save",
  "cancel",
  "edited",
  "react",
  "pin",
  "unpin",
  "pinned",
  "announcement",
] as const satisfies readonly (keyof GcsChatRoomLabels)[];

export async function chatRoomLabels(): Promise<GcsChatRoomLabels> {
  const t = await getTranslations("chat");
  return Object.fromEntries(LABEL_KEYS.map((k) => [k, t.raw(k) as string])) as GcsChatRoomLabels;
}

/** Tot ce primește `GcsChatRoom` pentru un canal: mesajele, drepturile, reacțiile, mesajul fixat și anunțurile. */
export async function chatRoomProps(actor: GcsActor, channel: GcsChatChannelView): Promise<Parameters<typeof GcsChatRoom>[0]> {
  const { chatQueries, chat, reactions, permissions } = services();
  const [initial, canModerate, canAnnounce, mute, labels, list, pinned, announcements] = await Promise.all([
    chatQueries.recent(actor, channel.key),
    chat.canModerate(actor),
    actor.userId ? permissions.can(actor, "chat.announce") : Promise.resolve(false),
    viewerMute(actor, channel.key),
    chatRoomLabels(),
    reactions.list(),
    chatQueries.pinned(actor, channel.key),
    chatQueries.announcements(),
  ]);
  return {
    channel,
    initial,
    canModerate,
    canAnnounce,
    viewerId: actor.userId,
    reactions: list.map((r) => ({ id: r.id, symbol: r.symbol, label: r.label })),
    pinned,
    announcements,
    mute,
    labels,
  };
}
