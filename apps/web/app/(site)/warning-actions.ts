"use server";

import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

/** Membrul confirmă un avertisment primit (deblochează postarea, dacă site-ul cere confirmarea). */
export const acknowledgeWarningAction = gcsAction(z.object({ warningId: z.string().min(1).max(64) }), async ({ warningId }, { actor }) => {
  await services().warnings.acknowledge(actor, warningId);
});

/** Contestația unui avertisment activ (o singură dată). */
export const appealWarningAction = gcsAction(z.object({ warningId: z.string().min(1).max(64), text: z.string().trim().min(10).max(2000) }), async ({ warningId, text }, { actor }) => {
  await services().warnings.appeal(actor, warningId, text);
});
