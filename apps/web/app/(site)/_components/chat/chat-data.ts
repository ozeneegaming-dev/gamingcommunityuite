import "server-only";
import type { GcsActor } from "@gcs/core";
import { CHAT_ACP_SETTINGS, type GcsChatChannelView } from "@gcs/modules";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";
import type { GcsChatRoom, GcsChatRoomLabels } from "./GcsChatRoom";

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
 * ignorații, linkul spre setările din ACP, meniul de moderare și starea viewer-ului (mute, kick / ban, slow mode).
 * Un membru scos sau banat din chat nu primește mesajele (camera îi arată motivul și cât mai durează). `opts.around`:
 * mesajele din jurul unui mesaj (linkul „Vezi în chat”).
 */
export async function chatRoomProps(actor: GcsActor, channel: GcsChatChannelView, opts: { around?: number | null } = {}): Promise<Parameters<typeof GcsChatRoom>[0]> {
  const { chatQueries, chat, chatModeration, reactions, permissions, social, apps } = services();
  const config = await chat.config();
  const [menu, state] = await Promise.all([chatModeration.menu(actor, channel.key), chatModeration.viewerState(actor, channel.key)]);
  const blocked = state.block !== null;
  const [initial, canModerate, canAnnounce, labels, list, pinned, announcements, ignored, acpSettings, history] = await Promise.all([
    blocked ? Promise.resolve([]) : opts.around ? chatQueries.around(actor, channel.key, opts.around, config.pageSize) : chatQueries.recent(actor, channel.key, config.pageSize),
    chat.canModerate(actor),
    actor.userId ? permissions.can(actor, "chat.announce") : Promise.resolve(false),
    chatRoomLabels(),
    reactions.list(),
    blocked ? Promise.resolve(null) : chatQueries.pinned(actor, channel.key),
    chatQueries.announcements(),
    social.ignoredIds(actor.userId, "posts"),
    canOpenChatSettings(actor),
    // „Istoricul lui în chat” din meniu: doar cu Chat Pro și dreptul de istoric.
    apps.canAccess(actor, "chat_pro").then((on) => (on ? services().chatPro.history.canView(actor) : false)),
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
    mute: state.mute,
    labels,
    settingsHref: acpSettings ? "/admin/community/chat/settings" : null,
    mod: { ...menu, history, ...(menu.canGrant ? { rooms: (await chatQueries.channels(actor)).filter((c) => c.type === "PUBLIC").map((c) => c.key) } : {}) },
    state,
    focusId: opts.around ?? null,
  };
}
