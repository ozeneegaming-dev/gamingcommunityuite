import "server-only";
import { findActiveBan, GcsValidationError, hashPassword, isBotUser, isLegacyPasswordHash, prepareNewUser, upgradeLegacyPassword, verifyPassword } from "@gcs/core";
import { isMysql } from "@gcs/db";
import { referrerFromCookie, termsRequiredOnRegister } from "@gcs/modules";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { captcha } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins/two-factor";
import { antispamPlugin } from "./antispam-plugin";
import { clientIp } from "./client-ip";
import { installFinishPlugin } from "./install-plugin";
import { termsAcceptedIn } from "./legal-consent";
import { securityPlugin } from "./security-plugin";
import { sendTwoFactorEmailCode } from "./two-factor-email";
import { services } from "./services";
import { steamPlugin } from "./steam-plugin";

/** Setările din ACP de care depinde configurarea Better Auth. */
type GcsAuthConfig = {
  siteName: string;
  siteUrl: string;
  emailConfirm: boolean;
  discordClientId: string;
  discordClientSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  turnstileSecret: string;
  /** Captcha-ul la înregistrare (ACP › Anti-spam): Turnstile doar în modul „turnstile”, cu cheile completate. */
  captcha: string;
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
    database: prismaAdapter(db, { provider: isMysql() ? "mysql" : "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPassworgLength: 8,
      // Confirmarea emailului nu blochează login-ul: userul stă în „Membru nou” până confirmă.
      requireEmailVerification: false,
      password: {
        hash: hashPassword,
        // Parolele importate din altă platformă (hash marcat `legacy-…`) se rescriu în Argon2id la prima autentificare.
        verify: async ({ hash, password }) => {
          const ok = await verifyPassword(hash, password);
          if (ok && isLegacyPasswordHash(hash)) await upgradeLegacyPassword(db, hash, password).catch(() => 0);
          return ok;
        },
      },
    },
    // Discord și Google doar când au cheile completate în ACP (Setări → Autentificare).
    socialProviders: {
      ...(config.discordClientId ? { discord: { clientId: clientId: config.discordClientId, clientSecret: config.discordClientSecret } } : {}),
      ...(config.googleClientId ? { google: { clientId: config.googleClientId, clientSecret: config.googleClientSecret, prompt: "select_account" as const } } : {}),
    },
    user: {
      additionalFields: {
        nameNormalized: {type: "string", required: false, input: false },
        primaryGroupId: { type: "number", required: false, input: false },
        registrationIp: { type: "string", required: false, input: false, },
        termsAcceptedAt: { type: "date", required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // Anti-spam: înregistrarea ‮<k'�