"use server";

import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

/**
 * Acțiunile paginilor publice ale punții (specul 2026-10-08-servere-pagini): conturile de joc (Setări → Cont), sancțiunile
 * date de pe site, contestațiile și reclamațiile. Drepturile le verifică serviciile aplicației Servere.
 */

const id = z.number().int().positive();
const userId = z.string().min(8).max(40).regex(/^[a-z0-9]+$/i);
const urls = z.array(z.string().max(500)).max(10);

/** „Generează un cod” (Setări → Cont → Conturi de joc): codul în clar, o singură dată. */
export const createLinkCode = gcsAction(z.object({}), async (_input, { actor }) => services().bridge.players.createLinkCode(actor));

/** „Dezleagă” o identitate de joc proprie (nu identitatea Steam legată prin contul Steam). */
export const unlinkGameIdentity = gcsAction(z.object({ playerId: id }), async ({ playerId }, { actor }) => services().bridge.players.unlinkOwn(actor, playerId));

const sanctionTarget = z.object({
  playerId: id.nullable().optional(),
  auth: z.string().max(64).nullable().optional(),
  authKind: z.enum(["steam", "nonsteam"]).optional(),
  ip: z.string().max(64).nullable().optional(),
  name: z.string().max(64).nullable().optional(),
});

/** Sancțiune nouă de pe site (staff `servers.sanction` sau adminii serverelor, după flag-uri). */
export const createSanction = gcsAction(
  z.object({
    type: z.enum(["BAN", "MUTE", "GAG"]),
    scope: z.enum(["SERVER", "GLOBAL"]),
    serverId: id.nullable(),
    target: sanctionTarget,
    reason: z.string().max(400),
    minutes: z.number().int().min(0).max(5_256_000),
    evidence: urls,
    attachmentIds: z.array(z.string().min(8).max(40).regex(/^[a-z0-9]+$/i)).max(10),
  }),
  async (input, { actor }) => services().bridge.sanctions.create(actor, input),
);

/** Modificarea unei sancțiuni: motivul, durata (de la data creării), scopul și serverul, dovezile. */
export const updateSanction = gcsAction(
  z.object({
    sanctionId: id,
    scope: z.enum(["SERVER", "GLOBAL"]),
    serverId: id.nullable(),
    reason: z.string().max(400),
    minutes: z.number().int().min(0).max(5_256_000),
    evidence: urls,
  }),
  async ({ sanctionId, ...patch }, { actor }) => services().bridge.sanctions.update(actor, sanctionId, patch),
);

/** Ridicarea (unban / unmute / ungag), cu motivul. */
export const liftSanction = gcsAction(z.object({ sanctionId: id, reason: z.string().max(400) }), async ({ sanctionId, reason }, { actor }) =>
  services().bridge.sanctions.lift(actor, sanctionId, reason),
);

/** Contestație / reclamație nouă. */
export const createTicket = gcsAction(
  z.object({
    kind: z.enum(["APPEAL", "CHEATER", "ADMIN"]),
    title: z.string().max(400),
    content: z.unknown(),
    serverId: id.nullable().optional(),
    sanctionId: id.nullable().optional(),
    targetPlayerId: id.nullable().optional(),
    targetAdminId: id.nullable().optional(),
    targetName: z.string().max(64).nullable().optional(),
    evidence: urls,
  }),
  async (input, { actor }) => services().bridge.tickets.create(actor, input),
);

/** Un răspuns în tichet (public sau notă internă). */
export const replyTicket = gcsAction(z.object({ ticketId: id, content: z.unknown(), internal: z.boolean() }), async ({ ticketId, content, internal }, { actor }) =>
  services().bridge.tickets.reply(actor, ticketId, { content, internal }),
);

/** Starea tichetului (fluxul permis); acceptarea unei contestații poate ridica sancțiunea. */
export const setTicketStatus = gcsAction(
  z.object({ ticketId: id, status: z.enum(["OPEN", "REVIEW", "ACCEPTED", "REJECTED", "CLOSED"]), lift: z.boolean(), reason: z.string().max(400) }),
  async ({ ticketId, status, lift, reason }, { actor }) => services().bridge.tickets.setStatus(actor, ticketId, status, { lift, reason }),
);

/** Responsabilul tichetului (`null` = nimeni). */
export const assignTicket = gcsAction(z.object({ ticketId: id, assigneeId: userId.nullable() }), async ({ ticketId, assigneeId }, { actor }) =>
  services().bridge.tickets.assign(actor, ticketId, assigneeId),
);
