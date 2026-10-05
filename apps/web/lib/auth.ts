import "server-only";
import { GcsValidationError, hashPassword, prepareNewUser, verifyPassword } from "@gcs/core";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { captcha } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins/two-factor";
import { services } from "./services";
import { steamPlugin } from "./steam-plugin";

/** Setările din ACP de care depinde configurarea Better Auth. */
type GcsAuthConfig = {
  siteName: string;
  siteUrl: string;
  emailConfirm: boolean;
  discordClientId: string;
  discordClientSecret: string;
  turnstileSecret: string;
};

const SIGN_IN_RULE = { window: 15 * 60, max: 5 };

function createAuth(config: GcsAuthConfig) {
  const { db, settings, rateLimiter } = services();
  const production = process.env.NODE_ENV === "production";
  const secret = process.env.GCS_SECRET ?? (production ? undefined : "gcs-dev-secret-not-for-production-use");
  const baseURL = process.env.GCS_BASE_URL ?? (config.siteUrl || undefined);

  return betterAuth({
    appName: config.siteName,
    ...(baseURL ? { baseURL } : {}),
    ...(secret ? { secret } : {}),
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // Confirmarea emailului nu blochează login-ul: userul stă în „Membru nou” până confirmă.
      requireEmailVerification: false,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    socialProviders: config.discordClientId
      ? { discord: { clientId: config.discordClientId, clientSecret: config.discordClientSecret } }
      : {},
    user: {
      additionalFields: {
        nameNormalized: { type: "string", required: false, input: false },
        primaryGroupId: { type: "number", required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // La înregistrarea cu email, userul își poate corecta numele; la Discord/Steam alegem automat unul liber.
            const strict = ctx?.path === "/sign-up/email";
            try {
              const data = await prepareNewUser(
                db,
                { name: user.name, email: user.email },
                { emailConfirm: config.emailConfirm, autoRename: !strict },
              );
              return { data: { ...user, ...data } };
            } catch (error) {
              if (error instanceof GcsValidationError) {
                const [field, code] = Object.entries(error.fields)[0] ?? ["name", "validation"];
                throw new APIError("BAD_REQUEST", { code: code.toUpperCase(), message: code, field });
              }
              throw error;
            }
          },
        },
      },
    },
    rateLimit: {
      enabled: process.env.GCS_DISABLE_RATE_LIMIT !== "1",
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": SIGN_IN_RULE, "/two-factor/*": SIGN_IN_RULE },
      customStorage: rateLimiter,
    },
    advanced: {
      cookiePrefix: "gcs",
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: production },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    plugins: [
      // allowPasswordless: și conturile fără parolă (doar Discord/Steam) pot activa 2FA, cerut pentru ACP.
      twoFactor({ issuer: config.siteName, allowPasswordless: true }),
      // Cloudflare Turnstile la înregistrare, doar când e configurat în ACP (spec §15).
      ...(config.turnstileSecret
        ? [captcha({ provider: "cloudflare-turnstile", secretKey: config.turnstileSecret, endpoints: ["/sign-up/email"] })]
        : []),
      steamPlugin({ apiKey: () => settings.get<string>("auth.steam_api_key") }),
      // Trebuie să fie ultimul: setează cookie-urile din Server Actions.
      nextCookies(),
    ],
  });
}

export type GcsAuth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { gcsAuth?: { key: string; auth: GcsAuth } };

/**
 * Instanța Better Auth pentru setările curente. Setările vin din ACP (cache Redis), deci o schimbare
 * a cheilor Discord sau a numelui site-ului se aplică la următorul request, fără restart.
 */
export async function getAuth(): Promise<GcsAuth> {
  const { settings } = services();
  const [siteName, siteUrl, emailConfirm, discordClientId, discordClientSecret, turnstileSecret] = await Promise.all([
    settings.get<string>("site.name"),
    settings.get<string>("site.url"),
    settings.get<boolean>("auth.email_confirm"),
    settings.get<string>("auth.discord_client_id"),
    settings.get<string>("auth.discord_client_secret"),
    settings.get<string>("auth.turnstile_secret"),
  ]);
  const config: GcsAuthConfig = { siteName, siteUrl, emailConfirm, discordClientId, discordClientSecret, turnstileSecret };
  const key = JSON.stringify(config);
  if (globalForAuth.gcsAuth?.key !== key) globalForAuth.gcsAuth = { key, auth: createAuth(config) };
  return globalForAuth.gcsAuth.auth;
}
