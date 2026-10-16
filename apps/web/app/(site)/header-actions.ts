"use server";

import { GcsForbidden } from "@gcs/core";
import { normalizePrivacy } from "@gcs/modules";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

/**
 * Selectorul de status din meniul contului (specul 2026-10-10-hero-cockpit §3): „Online” sau „Invizibil”, legat de
 * prezență prin setarea de confidențialitate „Arată când sunt online” (restul setărilor rămân neschimbate).
 */
export const setPresenceStatus = gcsAction(z.object({ status: z.enum(["online", "invisible"]) }), async ({ status }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  const { db, profiles } = services();
  const row = await db.user.findUnique({ where: { id: actor.userId }, select: { privacy: true } });
  const privacy = normalizePrivacy(row?.privacy);
  await profiles.updatePrivacy(actor, { ...privacy, showOnline: status === "online" });
  return { status };
});
