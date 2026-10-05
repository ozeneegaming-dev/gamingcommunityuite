"use server";

import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

const userId = z.string().min(8).max(40).regex(/^[a-z0-9]+$/i);
const conversationId = z.number().int().positive();

/** Conversație nouă: destinatarii (id-uri), titlul și primul mesaj (JSON Tiptap). */
export const startConversation = gcsAction(
  z.object({ to: z.array(userId).min(1).max(50), title: z.string().max(200), content: z.unknown() }),
  async (input, { actor }) => {
    const res = await services().conversations.start(actor, input);
    return { conversationId: res.conversationId };
  },
);

export const replyToConversation = gcsAction(z.object({ conversationId, content: z.unknown() }), async ({ conversationId, content }, { actor }) => {
  return services().conversations.reply(actor, conversationId, content);
});

export const inviteToConversation = gcsAction(z.object({ conversationId, userIds: z.array(userId).min(1).max(25) }), async (input, { actor }) => {
  await services().conversations.invite(actor, input.conversationId, input.userIds);
});

export const leaveConversation = gcsAction(z.object({ conversationId }), async ({ conversationId }, { actor }) => {
  await services().conversations.leave(actor, conversationId);
});

export const reportMessage = gcsAction(
  z.object({ messageId: z.number().int().positive(), reason: z.string().min(3).max(500) }),
  async ({ messageId, reason }, { actor }) => {
    await services().reports.report(actor, { contentType: "pm.message", contentId: String(messageId), reason });
  },
);
