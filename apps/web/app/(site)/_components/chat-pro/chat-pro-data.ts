import "server-only";
import type { GcsActor } from "@gcs/core";
import {
  type GcsChatChannelView,
  type GcsChatEmotePackView,
  type GcsChatProBarItemView,
  type GcsChatProConfig,
  type GcsChatProEarnedBadge,
  type GcsChatProMe,
  type GcsChatProRanking,
} from "@gcs/modules";
import { services } from "@/lib/services";
import { chatRoomProps } from "../chat/chat-data";

/** Ce primește camera Chat Pro în plus față de camera standard. */
export type GcsChatProData = {
  config: GcsChatProConfig;
  me: GcsChatProMe | null;
  emotes: GcsChatEmotePackView[];
  bar: GcsChatProBarItemView[];
  ranking: GcsChatProRanking;
  badges: GcsChatProEarnedBadge[];
  /** Linkul spre `/chat/history` (cu permisiunea `chat_pro.history`), altfel `null`. */
  historyHref: string | null;
  /** Numele viewer-ului (mențiunile lui se evidențiază). */
  viewerName: string | null;
  /** Grupurile viewer-ului: un mesaj care menționează unul dintre ele se evidențiază ca o mențiune. */
  viewerGroupIds: number[];
};

/** Viewer-ul folosește Chat Pro (aplicația pornită și accesibilă grupurilor lui). */
export async function usesChatPro(actor: GcsActor): Promise<boolean> {
  return services().chatPro.canUse(actor);
}

/** Tot ce primește `GcsChatProRoom`: proprietățile camerei standard și datele Chat Pro. */
export async function chatProRoomProps(actor: GcsActor, channel: GcsChatChannelView) {
  const { chatPro, db } = services();
  const [base, config, me, emotes, bar, ranking, badges, canHistory, viewer] = await Promise.all([
    chatRoomProps(actor, channel),
    chatPro.config(),
    actor.userId ? chatPro.me(actor.userId) : Promise.resolve(null),
    chatPro.emotes.packs(),
    chatPro.bar.visible(actor.groupIds),
    chatPro.ranking.view(actor.userId),
    actor.userId ? chatPro.earnedBadges(actor.userId) : Promise.resolve([]),
    chatPro.history.canView(actor),
    actor.userId ? db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const pro: GcsChatProData = { config, me, emotes, bar, ranking, badges, historyHref: canHistory ? "/chat/history" : null, viewerName: viewer?.name ?? null, viewerGroupIds: actor.userId ? actor.groupIds : [] };
  return { ...base, pro };
}
