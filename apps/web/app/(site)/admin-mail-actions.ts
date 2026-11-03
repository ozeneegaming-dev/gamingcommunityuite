"use server";

import { GcsForbidden } from "@gcs/core";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

/** Setări → Email: membrul primește sau nu emailurile trimise de administratori (Email în masă). */
export const setAdminMailAction = gcsAction(z.object({ receive: z.boolean() }), async ({ receive }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "login_required" });
  await services().bulkMail.setOptOut(actor.userId, !receive);
});
