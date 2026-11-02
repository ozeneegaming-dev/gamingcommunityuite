import "server-only";
import { loadMfaRecovery, loadPasswordPolicy, passwordPolicyError } from "@gcs/core";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { clientIp } from "./client-ip";
import { services } from "./services";

/** Codurile erorilor (Better Auth le trimite clientului ca `code`; `authErrorKey` le traduce). */
const POLICY_CODES = { password_too_short: "PASSWORD_TOO_SHORT", password_too_long: "PASSWORD_TOO_LONG", password_needs_mix: "PASSWORD_NEEDS_MIX" } as const;
/** Căile cu o parolă nouă și câmpul ei. */
const NEW_PASSWORD_FIELD: Record<string, "password" | "newPassword"> = { "/sign-up/email": "password", "/change-password": "newPassword", "/reset-password": "newPassword" };
const OTP_PATHS = new Set(["/two-factor/send-otp", "/two-factor/verify-otp"]);

type Ctx = { headers?: Headers; request?: Request; body?: unknown; context: { returned?: unknown } };

function requestIp(ctx: Ctx): string | null {
  const headers = ctx.headers ?? ctx.request?.headers ?? null;
  const ip = headers ? clientIp(headers) : null;
  return ip && ip !== "0.0.0.0" ? ip : null;
}

async function userIdByEmail(body: unknown): Promise<string | null> {
  const email = typeof (body as { email?: unknown } | null)?.email === "string" ? (body as { email: string }).email.trim().toLowerCase() : "";
  if (!email) return null;
  const user = await services().db.user.findUnique({ where: { email }, select: { id: true } });
  return user?.id ?? null;
}

/** Eroarea „cont blocat”: mesajul poartă minutele rămase (formularul de login le afișează). */
function lockedError(until: Date, now = Date.now()): APIError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now) / 60_000));
  return new APIError("FORBIDDEN", { code: "ACCOUNT_LOCKED", message: String(minutes) });
}

/**
 * Securitatea autentificării (ACP → Setări → Securitate), aplicată pe server pe orice cale:
 * - blocarea după parole greșite: un cont (sau IP) blocat nu mai poate încerca parola până expiră blocarea; fiecare
 *   parolă greșită se numără, iar una corectă uită încercările contului;
 * - politica parolelor la înregistrare, la schimbarea și la resetarea parolei;
 * - codul 2FA pe email (recuperarea când membrul nu mai are aplicația) doar dacă setarea îl permite; 2FA se activează
 *   doar cu aplicația de autentificare (TOTP), niciodată doar cu emailul.
 */
export function securityPlugin(): BetterAuthPlugin {
  return {
    id: "gcs-security",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const userId = await userIdByEmail(ctx.body);
            const lock = await services().loginLockout.status({ userId, ip: requestIp(ctx) });
            if (lock) throw lockedError(lock.until);
          }),
        },
        {
          matcher: (ctx) => !!ctx.path && ctx.path in NEW_PASSWORD_FIELD,
          handler: createAuthMiddleware(async (ctx) => {
            const field = NEW_PASSWORD_FIELD[ctx.path]!;
            const password = (ctx.body as Record<string, unknown> | undefined)?.[field];
            if (typeof password !== "string") return;
            const error = passwordPolicyError(password, await loadPasswordPolicy(services().settings));
            if (error) throw new APIError("BAD_REQUEST", { code: POLICY_CODES[error], message: error });
          }),
        },
        {
          matcher: (ctx) => !!ctx.path && OTP_PATHS.has(ctx.path),
          handler: createAuthMiddleware(async () => {
            if ((await loadMfaRecovery(services().settings)) !== "email_code") throw new APIError("FORBIDDEN", { code: "OTP_DISABLED", message: "otp_disabled" });
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/two-factor/enable",
          handler: createAuthMiddleware(async (ctx) => {
            if ((ctx.body as { method?: unknown } | undefined)?.method === "otp") throw new APIError("FORBIDDEN", { code: "OTP_DISABLED", message: "otp_disabled" });
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = (ctx as unknown as Ctx).context.returned;
            const error = isAPIError(returned) ? ((returned as { body?: { code?: string } }).body?.code ?? "error") : null;
            if (error !== null && error !== "INVALID_EMAIL_OR_PASSWORD") return;
            const userId = await userIdByEmail(ctx.body);
            const { loginLockout } = services();
            if (error) {
              await loginLockout.recordFailure({ userId, ip: requestIp(ctx) }).catch(() => null);
              return;
            }
            if (userId) await loginLockout.recordSuccess(userId).catch(() => {});
          }),
        },
      ],
    },
  };
}
