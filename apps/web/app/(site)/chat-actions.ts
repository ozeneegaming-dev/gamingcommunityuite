"use server";

import { GcsNotFound } from "@gcs/core";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

// Cheile camerelor create de membri au un sufix aleator (până la 27 de caractere).
const channel = z.string().min(2).max(40);

/** Aplicația Chat dezactivată din ACP: acțiunile chat-ului nu mai funcționează („nu există”). */
async function assertChatEnabled(): Promise<void> {
  if (!(await services().apps.enabled("chat"))) throw new GcsNotFound();
}

/** Trimite un mesaj în chat. Întoarce mesajul salvat (cu HTML-ul randat). */
export const sendChatMessage = gcsAction(z.object({ channel, body: z.string().min(1).max(2000) }), async ({ channel, body }, { actor }) => {
  await assertChatEnabled();
  return services().chat.send(actor, channel, body);
});

/** Ultimele mesaje ale canalului sau cele dinaintea lui `before` (derularea în sus, reîncărcarea fără live). */
export const loadChatMessages = gcsAction(z.object({ channel, before: z.number().int().positive().optional() }), async ({ channel, before }, { actor }) => {
  await assertChatEnabled();
  return services().chatQueries.history(actor, channel, before ?? null);
});

export const deleteChatMessage = gcsAction(z.object({ id: z.number().int().positive() }), async ({ id }, { actor }) => {
  await services().chat.delete(actor, id);
});

/** Mute pe canal sau pe toate (`channel: null`); `minutes: null` = permanent. */
export const muteChatUser = gcsAction(
  z.object({ userId: z.string().min(8).max(40), channel: channel.nullable(), minutes: z.number().int().positive().max(525_600).nullable(), reason: z.string().max(200) }),
  async ({ userId, channel, minutes, reason }, { actor }) => services().chat.mute(actor, userId, { channelKey: channel, minutes, reason }),
);

export const unmuteChatUser = gcsAction(z.object({ id: z.number().int().positive() }), async ({ id }, { actor }) => {
  await services().chat.unmute(actor, id);
});

export const setChatSlowMode = gcsAction(z.object({ channel, seconds: z.number().int().min(0).max(3600) }), async ({ channel, seconds }, { actor }) => {
  await services().chat.setSlowMode(actor, channel, seconds);
});

const messageId = z.number().int().positive();

/** Editarea propriului mesaj (în 5 minute). */
export const editChatMessage = gcsAction(z.object({ id: messageId, body: z.string().min(1).max(2000) }), async ({ id, body }, { actor }) =>
  services().chat.edit(actor, id, body),
);

/** Reacție la un mesaj; a doua apăsare o retrage. */
export const reactChatMessage = gcsAction(z.object({ id: messageId, reactionId: z.number().int().positive() }), async ({ id, reactionId }, { actor }) =>
  services().chat.react(actor, id, reactionId),
);

/** Fixează (sau scoate, cu `id: null`) un mesaj în cameră (`chat.announce`). */
export const pinChatMessage = gcsAction(z.object({ channel, id: messageId.nullable() }), async ({ channel, id }, { actor }) => {
  await services().chat.pin(actor, channel, id);
});

/** Anunț global în toate camerele (`chat.announce`); `minutes: null` = până la ștergere. */
export const announceChat = gcsAction(z.object({ body: z.string().min(1).max(500), minutes: z.number().int().positive().max(525_600).nullable() }), async ({ body, minutes }, { actor }) =>
  services().chat.announce(actor, body, minutes),
);

export const removeChatAnnouncement = gcsAction(z.object({ id: z.number().int().positive() }), async ({ id }, { actor }) => {
  await services().chat.removeAnnouncement(actor, id);
});

/** O cameră nouă (publică sau privată, cu invitați după nume). Întoarce cheia ei. */
export const createChatRoom = gcsAction(
  z.object({ name: z.string().min(2).max(50), type: z.enum(["PUBLIC", "PRIVATE"]), invite: z.array(z.string().min(1).max(40)).max(50) }),
  async ({ name, type, invite }, { actor }) => {
    await assertChatEnabled();
    const room = await services().chat.createRoom(actor, { name, type, invite });
    return { key: room.key };
  },
);

export const inviteToChatRoom = gcsAction(z.object({ channel, users: z.array(z.string().min(1).max(40)).min(1).max(50) }), async ({ channel, users }, { actor }) =>
  services().chat.invite(actor, channel, users),
);

export const leaveChatRoom = gcsAction(z.object({ channel }), async ({ channel }, { actor }) => {
  await services().chat.leave(actor, channel);
});

export const renameChatRoom = gcsAction(z.object({ channel, name: z.string().min(2).max(50) }), async ({ channel, name }, { actor }) => {
  await services().chat.rename(actor, channel, name);
});

export const deleteChatRoom = gcsAction(z.object({ channel }), async ({ channel }, { actor }) => {
  await services().chat.deleteRoom(actor, channel);
});
