"use server";

import { CLAN_LINK_KINDS, CLAN_OFFICER_RIGHTS, type GcsClanInput } from "@gcs/modules";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

const id = z.number().int().positive();
const userId = z.string().min(8).max(40).regex(/^[a-z0-9]+$/i);
const attachmentId = z.string().min(8).max(40).regex(/^[a-z0-9]+$/i);

/** Formularul clanului (creare și setări); validarea de fond o face serviciul (tag, linkuri, descriere, imagini). */
const clanInput = z.object({
  tag: z.string().max(64),
  name: z.string().max(200),
  description: z.unknown(),
  color: z.string().max(16),
  color2: z.string().max(16),
  links: z.object(Object.fromEntries(CLAN_LINK_KINDS.map((k) => [k, z.string().max(400).optional()]))),
  joinMode: z.enum(["OPEN", "REQUEST", "INVITE"]),
  logoId: attachmentId.nullable().optional(),
  bannerId: attachmentId.nullable().optional(),
  officerRights: z.array(z.string().max(20)).max(CLAN_OFFICER_RIGHTS.length).optional(),
  wantForum: z.boolean().optional(),
});

const toInput = (v: z.infer<typeof clanInput>): GcsClanInput => ({
  tag: v.tag,
  name: v.name,
  description: v.description,
  color: v.color,
  color2: v.color2,
  links: v.links,
  joinMode: v.joinMode,
  ...(v.logoId !== undefined ? { logoId: v.logoId } : {}),
  ...(v.bannerId !== undefined ? { bannerId: v.bannerId } : {}),
  ...(v.officerRights !== undefined ? { officerRights: v.officerRights } : {}),
  ...(v.wantForum !== undefined ? { wantForum: v.wantForum } : {}),
});

/** „Creează clanul” (`/clans/new`). */
export const createClan = gcsAction(clanInput, async (input, { actor }) => services().clans.create(actor, toInput(input)));

/** Setările clanului (administrare → Setări). */
export const updateClan = gcsAction(z.object({ clanId: id, input: clanInput }), async ({ clanId, input }, { actor }) => services().clans.update(actor, clanId, toInput(input)));

/** „Intră în clan” (intrare liberă sau cu invitație). */
export const joinClan = gcsAction(z.object({ clanId: id }), async ({ clanId }, { actor }) => services().clans.join(actor, clanId));

/** „Cere intrarea”, cu un mesaj opțional. */
export const requestClan = gcsAction(z.object({ clanId: id, message: z.string().max(2000) }), async ({ clanId, message }, { actor }) =>
  services().clans.request(actor, clanId, message),
);

export const cancelClanRequest = gcsAction(z.object({ clanId: id }), async ({ clanId }, { actor }) => services().clans.cancelRequest(actor, clanId));

export const answerClanInvite = gcsAction(z.object({ clanId: id, accept: z.boolean() }), async ({ clanId, accept }, { actor }) => services().clans.answerInvite(actor, clanId, accept));

export const leaveClan = gcsAction(z.object({ clanId: id }), async ({ clanId }, { actor }) => services().clans.leave(actor, clanId));

export const decideClanRequest = gcsAction(z.object({ requestId: id, accept: z.boolean() }), async ({ requestId, accept }, { actor }) =>
  services().clans.decideRequest(actor, requestId, accept),
);

export const inviteToClan = gcsAction(z.object({ clanId: id, name: z.string().min(1).max(40) }), async ({ clanId, name }, { actor }) => services().clans.invite(actor, clanId, name));

export const cancelClanInvite = gcsAction(z.object({ inviteId: id }), async ({ inviteId }, { actor }) => services().clans.cancelInvite(actor, inviteId));

export const setClanRole = gcsAction(z.object({ clanId: id, userId, role: z.enum(["OFFICER", "MEMBER"]) }), async ({ clanId, userId: target, role }, { actor }) =>
  services().clans.setRole(actor, clanId, target, role),
);

export const kickFromClan = gcsAction(z.object({ clanId: id, userId }), async ({ clanId, userId: target }, { actor }) => services().clans.kick(actor, clanId, target));

export const transferClan = gcsAction(z.object({ clanId: id, userId }), async ({ clanId, userId: target }, { actor }) => services().clans.transfer(actor, clanId, target));

export const disbandClan = gcsAction(z.object({ clanId: id, confirm: z.string().max(64) }), async ({ clanId, confirm }, { actor }) => services().clans.disband(actor, clanId, confirm));

export const reactivateClan = gcsAction(z.object({ clanId: id }), async ({ clanId }, { actor }) => services().clans.reactivate(actor, clanId));

export const createClanForum = gcsAction(z.object({ clanId: id }), async ({ clanId }, { actor }) => {
  await services().clans.createForum(actor, clanId);
});
