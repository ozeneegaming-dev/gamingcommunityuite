import "server-only";
import { GcsForbidden, GcsValidationError, toResult, type GcsActor, type GcsResult } from "@gcs/core";
import { headers } from "next/headers";
import type * as z from "zod";
import { clientIp, currentActor } from "./actor";

/**
 * Verificare CSRF prin `Origin` (spec §15): o mutație e acceptată doar dacă vine de pe același host.
 * Browserele trimit `Origin` la orice POST, deci lipsa lui înseamnă o cerere care nu vine din site.
 */
export function isSameOrigin(h: Headers): boolean {
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!origin || !host || !URL.canParse(origin)) return false;
  return new URL(origin).host === host;
}

/** Transformă erorile Zod în erori pe câmpuri: `{ "email": "invalid_email" }` (mesajul e cheia de traducere). */
function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

/**
 * Învelișul tuturor Server Actions (Global Constraints): CSRF, validare Zod, actorul curent și
 * `GcsResult` (erorile `GcsError` devin `{ ok: false }`, celelalte sunt aruncate mai departe).
 * Verificarea permisiunilor o face `fn`, prin serviciile din `core`.
 */
export function gcsAction<I, O>(
  schema: z.ZodType<I>,
  fn: (input: I, ctx: { actor: GcsActor; ip: string }) => Promise<O>,
): (input: I) => Promise<GcsResult<O>> {
  return async (input: I) =>
    toResult(async () => {
      const h = await headers();
      if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
      const parsed = schema.safeParse(input);
      if (!parsed.success) throw new GcsValidationError(zodFields(parsed.error));
      const actor = await currentActor();
      return fn(parsed.data, { actor, ip: clientIp(h) });
    });
}
