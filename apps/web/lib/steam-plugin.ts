import "server-only";
import { buildSteamLoginUrl, fetchSteamProfile, verifySteamAssertion } from "@gcs/core";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

const PROVIDER_ID = "steam";

/** Doar căi relative din site, ca un `callbackURL` să nu poată trimite userul pe alt domeniu. */
function safeCallback(url: string | undefined, fallback: string): string {
  return url && url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") ? url : fallback;
}

/**
 * Login cu Steam (OpenID 2.0) ca plugin Better Auth.
 * - `GET /api/auth/steam/sign-in?callbackURL=/` trimite userul pe Steam;
 * - `GET /api/auth/steam/callback` verifică răspunsul, apoi leagă contul Steam de userul logat,
 *   loghează userul existent sau creează unul nou (cu numele de pe Steam, dacă există o cheie API).
 *
 * Steam nu dă adresa de email, așa că un cont nou primește adresa `<steamId>@steam.invalid`
 * (domeniul `.invalid` e rezervat și nu primește niciodată email).
 *
 * `onLinked` rulează după orice login sau legare Steam reușită (ex. identitatea de joc Steam a membrului se leagă de cont,
 * specul 2026-10-08-servere-bridge §3.3); o eroare a lui nu oprește autentificarea.
 */
export function steamPlugin(opts: { apiKey: () => Promise<string>; errorURL?: string; onLinked?: (userId: string) => Promise<unknown> }): BetterAuthPlugin {
  const errorURL = opts.errorURL ?? "/login?error=steam";

  return {
    id: PROVIDER_ID,
    endpoints: {
      steamSignIn: createAuthEndpoint(
        "/steam/sign-in",
        { method: "GET", query: z.object({ callbackURL: z.string().optional() }) },
        async (ctx) => {
          const returnTo = new URL(`${ctx.context.baseURL}/steam/callback`);
          returnTo.searchParams.set("callbackURL", safeCallback(ctx.query.callbackURL, "/"));
          throw ctx.redirect(buildSteamLoginUrl(returnTo.toString(), new URL(ctx.context.baseURL).origin));
        },
      ),

      steamCallback: createAuthEndpoint(
        "/steam/callback",
        { method: "GET", query: z.record(z.string(), z.string()) },
        async (ctx) => {
          const callbackURL = safeCallback(ctx.query.callbackURL, "/");
          const params = new URLSearchParams(ctx.query);
          const steamId = await verifySteamAssertion(params, fetch, {
            expectedReturnTo: `${ctx.context.baseURL}/steam/callback`,
          });
          if (!steamId) throw ctx.redirect(errorURL);

          const adapter = ctx.context.internalAdapter;
          const account = await adapter.findAccountByKey({ providerId: PROVIDER_ID, accountId: steamId });
          const current = await getSessionFromCtx(ctx);

          let userId: string;
          if (account) {
            // Contul Steam e deja legat; dacă e legat de alt user decât cel logat, nu-l mutăm.
            if (current && current.user.id !== account.userId) throw ctx.redirect("/settings/account?error=steam_linked");
            userId = account.userId;
          } else if (current) {
            await adapter.linkAccount({ userId: current.user.id, providerId: PROVIDER_ID, accountId: steamId });
            await opts.onLinked?.(current.user.id).catch(() => {});
            throw ctx.redirect(callbackURL);
          } else {
            const profile = await fetchSteamProfile(steamId, await opts.apiKey());
            const created = await adapter.createOAuthUser(
              {
                name: profile?.name ?? `steam_${steamId.slice(-6)}`,
                email: `${steamId}@steam.invalid`,
                emailVerified: false,
                image: profile?.avatar ?? null,
              },
              { providerId: PROVIDER_ID, accountId: steamId },
            );
            userId = created.user.id;
          }

          const user = await adapter.findUserById(userId);
          if (!user) throw ctx.redirect(errorURL);
          await opts.onLinked?.(user.id).catch(() => {});
          const session = await adapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          throw ctx.redirect(callbackURL);
        },
      ),
    },
  };
}
