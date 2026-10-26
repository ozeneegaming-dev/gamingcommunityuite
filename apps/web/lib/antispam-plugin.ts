import "server-only";
import { GcsForbidden, POW_HEADER } from "@gcs/core";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { clientIp } from "./client-ip";
import { services } from "./services";

/** Întrebarea de la înregistrare: id-ul și răspunsul (codificat URI, ca diacriticele să treacă prin antet). */
export const QA_ID_HEADER = "x-gcs-qa-id";
export const QA_ANSWER_HEADER = "x-gcs-qa-answer";
export const QA_LOCALE_HEADER = "x-gcs-locale";

const CODES: Record<string, string> = { captcha_failed: "CAPTCHA_FAILED", qa_failed: "QA_FAILED", spam_source: "SPAM_SOURCE" };

function decode(value: string | null): string | null {
  if (value === null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Anti-spam la înregistrarea cu email: captcha-ul proof-of-work, întrebarea și lista publică de spammeri, verificate
 * înaintea oricărei alte lucrări (inclusiv căutarea emailului). Înregistrările prin Discord / Google / Steam trec de
 * verificarea furnizorului; apelurile interne fără antete (serverul) nu sunt oprite.
 */
export function antispamPlugin(): BetterAuthPlugin {
  return {
    id: "gcs-antispam",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-up/email",
          handler: createAuthMiddleware(async (ctx) => {
            const headers = ctx.headers ?? ctx.request?.headers ?? null;
            if (!headers) return;
            const body = (ctx.body ?? {}) as { email?: unknown; name?: unknown };
            const ip = clientIp(headers);
            const id = Number(headers.get(QA_ID_HEADER));
            try {
              await services().antispam.verifyRegistration({
                ip: ip && ip !== "0.0.0.0" ? ip : null,
                email: typeof body.email === "string" ? body.email.trim().toLowerCase() : "",
                pow: headers.get(POW_HEADER),
                questionId: Number.isInteger(id) && id > 0 ? id : null,
                answer: decode(headers.get(QA_ANSWER_HEADER)),
                locale: headers.get(QA_LOCALE_HEADER) ?? (await services().settings.get<string>("site.locale").catch(() => "ro")),
              });
            } catch (error) {
              const reason = error instanceof GcsForbidden ? error.params?.reason : undefined;
              if (reason && CODES[reason]) throw new APIError("FORBIDDEN", { code: CODES[reason], message: reason });
              throw error;
            }
          }),
        },
      ],
    },
  };
}
