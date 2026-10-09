import "server-only";
import type { GcsActor } from "@gcs/core";
import { CHAT_ACP_SETTINGS, type GcsChatChannelView } from "@gcs/modules";
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
  "deletedMember",
] as const satisfies readonly (keyof GcsChatRoomLabels)[];

export async function chatRoomLabels(): Promise<GcsChatRoomLabels> {
  const t = await getTranslations("chat");
  return Object.fromEntries(LABEL_KEYS.map((k) => [k, t.raw(k) as string])) as GcsChatRoomLabels;
}

/** Staff-ul cu acces la ACP → Chat → Setări primește linkul rotiței din antetul chat-ului. */
async function canOpenChatSettings(actor: GcsActor): Promise<boolean> {
  if (!actor.userId || actor.isBanned) return false;
  const { permissions, acp } = services();
  return (await permissions.can(actor, "acp.access")) && (await acp.can(actor, CHAT_ACP_SETTINGS, "view"));
}

/**
 * Tot ce primește `GcsChatRoom` pentru un canal: mesajele, drepturile, reacțiile, mesajul fixat, anunțurile, setările,
 * ignorații și linkul spre setările din ACP.
 */
export async function chatRoomProps(actor: GcsActor, channel: GcsChatChannelView): Promise<Parameters<typeof GcsChatRoom>[0]> {
  const { chatQueries, chat, reactions, permissions, social } = services();
  const config = await chat.config();
  const [initial, canModerate, canAnnounce, mute, labels, list, pinned, announcements, ignored, acpSettings] = await Promise.all([
    chatQueries.recent(actor, channel.key, config.pageSize),
    chat.canModerate(actor),
    actor.userId ? permissions.can(actor, "chat.announce") : Promise.resolve(false),
    viewerMute(actor, channel.key),
    chatRoomLabels(),
    reactions.list(),
    chatQueries.pinned(actor, channel.key),
    chatQueries.announcements(),
    social.ignoredIds(actor.userId, "posts"),
    canOpenChatSettings(actor),
  ]);
  return {
    config,
    ignored,
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
    settingsHref: acpSettings ? "/admin/community/chat/settings" : null,
  };
}
