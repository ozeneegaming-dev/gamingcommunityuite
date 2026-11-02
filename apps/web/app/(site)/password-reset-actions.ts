"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { getAuth } from "@/lib/auth";
import { completePasswordReset, requestPasswordReset, type GcsDefer } from "@/lib/password-reset";

/**
 * Răspunsul cererii durează cel puțin atât, cu sau fără cont: timpul nu spune dacă emailul sau numele există (emailul
 * pleacă oricum după răspuns, cu `after`).
 */
const REQUEST_MIN_MS = 600;
const later: GcsDefer = (task) => after(task);

/** „Am uitat parola”: emailul sau numele de utilizator. Același răspuns pentru orice date. */
export const requestPasswordResetAction = gcsAction(
  z.object({ identifier: z.string().trim().min(1, "required").max(200, "required") }),
  async ({ identifier }, { ip }) => {
    const started = Date.now();
    try {
      return await requestPasswordReset(identifier, ip, { defer: later });
    } finally {
      const wait = REQUEST_MIN_MS - (Date.now() - started);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  },
);

/** Parola nouă din linkul primit pe email; sesiunea din acest browser rămâne doar dacă e chiar a membrului. */
export const resetPasswordAction = gcsAction(
  z.object({
    token: z.string().max(200, "invalid_token"),
    password: z.string().max(200, "password_too_long"),
    confirm: z.string().max(200, "password_mismatch"),
  }),
  async (input, { ip }) => {
    const session = await (await getAuth()).api.getSession({ headers: await headers() }).catch(() => null);
    await completePasswordReset({ ...input, ip, session: session ? { id: session.session.id, userId: session.user.id } : null }, { defer: later });
  },
);
