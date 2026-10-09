"use server";

import { GcsNotFound, type GcsActor } from "@gcs/core";
import { toRef, userRefSelect, type GcsChatProBarItemView, type GcsChatProRanking, type GcsUserRef } from "@gcs/modules";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

/** Chat Pro pornit și accesibil grupurilor actorului; altfel acțiunile „nu există”. */
async function assertChatPro(actor: GcsActor): Promise<void> {
  if (!(await services().chatPro.canUse(actor))) throw new GcsNotFound();
}

/** Salvează o parte din preferințele de chat (doar cheile trimise; validarea e în serviciu). */
export const saveChatProPrefs = gcsAction(z.record(z.string(), z.unknown()), async (patch, { actor }) => services().chatPro.updatePrefs(actor, patch));

/** Porecla din chat (gol = numele de pe forum). */
export const saveChatProNickname = gcsAction(z.object({ nickname: z.string().max(60) }), async ({ nickname }, { actor }) => services().chatPro.setNickname(actor, nickname));

/** Cel mult 2 badge-uri obținute, lângă nume. */
export const saveChatProBadges = gcsAction(z.object({ ids: z.array(z.number().int().positive()).max(5) }), async ({ ids }, { actor }) => services().chatPro.setBadges(actor, ids));

export const toggleChatEmoteFavorite = gcsAction(z.object({ code: z.string().min(2).max(32) }), async ({ code }, { actor }) => services().chatPro.toggleEmoteFavorite(actor, code));

export const toggleChatGifFavorite = gcsAction(
  z.object({ id: z.string().max(40), title: z.string().max(200), url: z.string().max(300), preview: z.string().max(300), width: z.number().int(), height: z.number().int() }),
  async (gif, { actor }) => services().chatPro.toggleGifFavorite(actor, gif),
);

/** Panoul de clasament (podium, spammer-ul zilei, ultimul câștigător, statisticile mele). */
export const loadChatProRanking = gcsAction(z.object({}), async (_input, { actor }): Promise<GcsChatProRanking> => {
  await assertChatPro(actor);
  return services().chatPro.ranking.view(actor.userId);
});

/** Elementele barei de anunțuri pe care le vede actorul acum. */
export const loadChatProBar = gcsAction(z.object({}), async (_input, { actor }): Promise<GcsChatProBarItemView[]> => {
  await assertChatPro(actor);
  return services().chatPro.bar.visible(actor.groupIds);
});

export type GcsChatNotificationItem = { id: number; type: string; title: string; href: string; snippet: string; actor: GcsUserRef | null; count: number; read: boolean; at: string };

/** Notificările chat-ului (panoul din antet): „Toate” sau „Mențiuni”, cu autorul fiecăreia. */
export const loadChatNotifications = gcsAction(z.object({ tab: z.enum(["all", "mentions"]) }), async ({ tab }, { actor }): Promise<GcsChatNotificationItem[]> => {
  const list = await services().chatPro.notifications(actor, tab);
  const ids = [...new Set(list.map((n) => n.actorIds[0]).filter((x): x is string => typeof x === "string"))];
  const users = new Map((await services().db.user.findMany({ where: { id: { in: ids } }, select: userRefSelect })).map((u) => [u.id, toRef(u)]));
  return list.map((n) => ({
    id: n.id,
    type: n.type,
    title: String(n.data.title ?? ""),
    href: String(n.data.href ?? "/chat"),
    snippet: String(n.data.snippet ?? ""),
    actor: n.actorIds[0] ? (users.get(n.actorIds[0]) ?? null) : null,
    count: n.count,
    read: n.read,
    at: n.updatedAt,
  }));
});

/** Marchează citite notificările chat-ului afișate în panou. */
export const markChatNotificationsRead = gcsAction(z.object({ ids: z.array(z.number().int().positive()).max(100) }), async ({ ids }, { actor }) => {
  await assertChatPro(actor);
  if (!actor.userId || ids.length === 0) return 0;
  return services().notifications.markRead(actor.userId, ids);
});

/** Răspunsul adversarului la o provocare piatră-hârtie-foarfecă. */
export const answerChatRps = gcsAction(z.object({ id: z.number().int().positive(), choice: z.enum(["rock", "paper", "scissors"]) }), async ({ id, choice }, { actor }) =>
  services().chatPro.answerRps(actor, id, choice),
);

/** Raportează un mesaj de chat moderatorilor. */
export const reportChatMessage = gcsAction(z.object({ id: z.number().int().positive(), reason: z.string().min(3).max(500) }), async ({ id, reason }, { actor }) => {
  await services().chatPro.report(actor, id, reason);
});

/** Membrii ignorați (lista din Setări → Cont a chat-ului). */
export const loadChatIgnored = gcsAction(z.object({}), async (_input, { actor }): Promise<GcsUserRef[]> => {
  await assertChatPro(actor);
  if (!actor.userId) return [];
  const rows = await services().db.userIgnore.findMany({ where: { userId: actor.userId, posts: true }, include: { ignored: { select: userRefSelect } }, take: 200 });
  return rows.map((r) => toRef(r.ignored));
});
