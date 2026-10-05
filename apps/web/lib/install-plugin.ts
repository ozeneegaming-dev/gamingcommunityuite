import "server-only";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";
import { installState } from "./install";

/**
 * Login-ul automat de la finalul instalării (spec §17.1): runner-ul lasă un token de unică folosință, iar
 * `GET /api/auth/gcs-install/finish?token=…` creează sesiunea Root Admin-ului și trimite browserul la
 * configurarea 2FA din ACP.
 */
export function installFinishPlugin(): BetterAuthPlugin {
  return {
    id: "gcs-install",
    endpoints: {
      gcsInstallFinish: createAuthEndpoint(
        "/gcs-install/finish",
        { method: "GET", query: z.object({ token: z.string() }) },
        async (ctx) => {
          const email = await installState().consumeFinishToken(ctx.query.token);
          if (!email) throw ctx.redirect("/login");
          const found = await ctx.context.internalAdapter.findUserByEmail(email);
          if (!found) throw ctx.redirect("/login");
          const session = await ctx.context.internalAdapter.createSession(found.user.id);
          await setSessionCookie(ctx, { session, user: found.user });
          throw ctx.redirect("/admin/2fa-setup");
        },
      ),
    },
  };
}
