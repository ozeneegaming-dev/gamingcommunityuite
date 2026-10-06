"use server";

import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

const channel = z.string().min(2).max(32);

/** Trimite un mesaj în chat. Întoarce mesajul salvat (cu HTML-ul randat). */
export const sendChatMessage = gcsAction(z.object({ channel, body: z.string().min(1).max(2000) }), async ({ channel, body }, { actor }) =>
  services().chat.send(actor, channel, body),
);

/** Ultimele mesaje ale canalului sau cele dinaintea lui `before` (derularea în sus, reîncărcarea fără live). */
export const loadChatMessages = gcsAction(z.object({ channel, before: z.number().int().positive().optional() }), async ({ channel, before }, { actor }) =>
  services().chatQueries.history(actor, channel, before ?? null),
);

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
