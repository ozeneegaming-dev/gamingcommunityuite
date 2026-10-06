"use server";

import { GcsForbidden } from "@gcs/core";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

/** Marchează citite notificările date sau pe toate. Întoarce numărul nou de necitite. */
export const markNotificationsRead = gcsAction(
  z.object({ ids: z.union([z.literal("all"), z.array(z.number().int().positive()).max(100)]) }),
  async ({ ids }, { actor }) => {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    return { unread: await services().notifications.markRead(actor.userId, ids) };
  },
);

/** Preferințele de notificare ale membrului (Setări → Notificări). */
export const saveNotificationPreferences = gcsAction(
  z.object({
    prefs: z.record(z.string().max(64), z.object({ site: z.boolean(), email: z.enum(["OFF", "INSTANT", "DIGEST"]) })),
  }),
  async ({ prefs }, { actor }) => {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    await services().notifications.setPreferences(actor.userId, prefs);
  },
);
