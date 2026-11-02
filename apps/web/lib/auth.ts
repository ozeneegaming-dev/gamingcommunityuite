import "server-only";
import { findActiveBan, GcsValidationError, hashPassword, isBotUser, isLegacyPasswordHash, prepareNewUser, upgradeLegacyPassword, verifyPassword } from "@gcs/core";
import { termsRequiredOnRegister } from "@gcs/modules";
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
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
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
      ...(config.discordClientId ? { discord: { clientId: config.discordClientId, clientSecret: config.discordClientSecret } } : {}),
      ...(config.googleClientId ? { google: { clientId: config.googleClientId, clientSecret: config.googleClientSecret, prompt: "select_account" as const } } : {}),
    },
    user: {
      additionalFields: {
        nameNormalized: { type: "string", required: false, input: false },
        primaryGroupId: { type: "number", required: false, input: false },
        registrationIp: { type: "string", required: false, input: false },
        termsAcceptedAt: { type: "date", required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // Anti-spam: înregistrarea închisă din ACP și banurile (IP sau interval, email sau domeniu) opresc contul nou
            // pe orice cale (email, Discord, Google, Steam), nu doar butonul din pagină.
            const headers = ctx?.headers ?? ctx?.request?.headers ?? null;
            const ip = headers ? clientIp(headers) : null;
            if ((await settings.get<boolean>("auth.registration_open").catch(() => true)) === false) {
              throw new APIError("FORBIDDEN", { code: "REGISTRATION_CLOSED", message: "registration_closed" });
            }
            if (await findActiveBan(db, { email: user.email, ...(ip && ip !== "0.0.0.0" ? { ip } : {}) })) {
              throw new APIError("FORBIDDEN", { code: "BANNED", message: "banned" });
            }
            // Termenii (ACP → Setări → Termeni și confidențialitate): cât timp acceptarea e cerută, contul nou are nevoie de
            // căsuța bifată, pe orice cale (antetul formularului cu email sau cookie-ul lăsat înainte de Discord/Google/Steam).
            // Apelurile interne fără antete (serverul) nu sunt oprite.
            const termsAccepted = termsAcceptedIn(headers, ctx?.path);
            if (headers && !termsAccepted && (await termsRequiredOnRegister(settings).catch(() => false))) {
              throw new APIError("FORBIDDEN", { code: "TERMS_REQUIRED", message: "terms_required" });
            }
            // La înregistrarea cu email, userul își poate corecta numele; la Discord/Google/Steam alegem automat unul liber.
            const strict = ctx?.path === "/sign-up/email";
            try {
              const data = await prepareNewUser(
                db,
                { name: user.name, email: user.email },
                { emailConfirm: config.emailConfirm, autoRename: !strict },
              );
              return { data: { ...user, ...data, registrationIp: ip && ip !== "0.0.0.0" ? ip : null, termsAcceptedAt: termsAccepted ? new Date() : null } };
            } catch (error) {
              if (error instanceof GcsValidationError) {
                const [field, code] = Object.entries(error.fields)[0] ?? ["name", "validation"];
                throw new APIError("BAD_REQUEST", { code: code.toUpperCase(), message: code, field });
              }
              throw error;
            }
          },
          // Evenimentul public al înregistrării (etapa 6: listenerii pluginurilor). O eroare nu oprește înregistrarea.
          after: async (user) => {
            await services()
              .bus.emit({ name: "user.registered", payload: { userId: user.id }, tags: [] })
              .catch(() => {});
          },
        },
      },
      // Setări → Dispozitive (setările contului v2): fiecare autentificare notează dispozitivul (browser, sistem, metoda,
      // țara dată de proxy), trimite emailul „dispozitiv nou” și scurtează sesiunea pe un dispozitiv fără autentificare
      // automată. O eroare nu oprește autentificarea.
      session: {
        create: {
          // Contul-bot nu se autentifică pe nicio cale (parolă, Discord, Steam): fără sesiune.
          before: async (session, ctx) => {
            if (await isBotUser(services().db, session.userId)) throw new APIError("FORBIDDEN", { code: "BOT_ACCOUNT", message: "bot_account" });
            // Un cont, un email (sau domeniu) ori un IP banat nu primește sesiune (nu doar vizitator la cererea următoare).
            // IP-ul după aceeași regulă ca la înregistrare (`clientIp`: X-Real-IP sau ultima adresă din X-Forwarded-For).
            const user = await services().db.user.findUnique({ where: { id: session.userId }, select: { email: true } });
            const headers = ctx?.headers ?? ctx?.request?.headers ?? null;
            const fromHeaders = headers ? clientIp(headers) : null;
            const ip = fromHeaders && fromHeaders !== "0.0.0.0" ? fromHeaders : (session.ipAddress ?? null);
            if (await findActiveBan(services().db, { userId: session.userId, ...(user ? { email: user.email } : {}), ...(ip ? { ip } : {}) })) {
              throw new APIError("FORBIDDEN", { code: "BANNED", message: "banned" });
            }
          },
          after: async (session, ctx) => {
            const headers = ctx?.headers ?? ctx?.request?.headers ?? null;
            await services()
              .devices.recordLogin({
                userId: session.userId,
                sessionId: session.id,
                userAgent: session.userAgent ?? null,
                ip: session.ipAddress ?? null,
                country: headers?.get("cf-ipcountry") ?? null,
                path: ctx?.path ?? null,
              })
              .catch(() => {});
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
      // `X-Real-IP` e suprascris de proxy (vezi `client-ip.ts`); `X-Forwarded-For` rămâne doar fără proxy (dezvoltare, E2E).
      ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
    },
    plugins: [
      // allowPasswordless: și conturile fără parolă (doar Discord/Google/Steam) pot activa 2FA, cerut pentru ACP.
      // Codul pe email e doar recuperarea (ACP → Setări → Securitate), oprită implicit: `securityPlugin` îl refuză atunci.
      twoFactor({ issuer: config.siteName, allowPasswordless: true, otpOptions: { sendOTP: ({ user, otp }) => sendTwoFactorEmailCode(user, otp), storeOTP: "hashed" } }),
      // Anti-spam la înregistrare: captcha-ul proof-of-work propriu, întrebarea și lista publică de spammeri.
      antispamPlugin(),
      // Securitatea autentificării: blocarea după parole greșite, politica parolelor, codul 2FA pe email.
      securityPlugin(),
      // Cloudflare Turnstile la înregistrare, doar în modul „turnstile” și cu cheile din ACP (spec §15).
      ...(config.captcha === "turnstile" && config.turnstileSecret
        ? [captcha({ provider: "cloudflare-turnstile", secretKey: config.turnstileSecret, endpoints: ["/sign-up/email"] })]
        : []),
      // La login / legarea Steam, identitatea de joc Steam a membrului se leagă de cont (puntea serverelor de joc).
      steamPlugin({ apiKey: () => settings.get<string>("auth.steam_api_key"), onLinked: (userId) => services().bridge.players.syncSteam(userId) }),
      installFinishPlugin(),
      // Trebuie să fie ultimul: setează cookie-urile din Server Actions.
      nextCookies(),
    ],
  });
}

export type GcsAuth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { gcsAuth?: { key: string; auth: GcsAuth } };

/**
 * Instanța Better Auth pentru setările curente. Setările vin din ACP (cache Redis), deci o schimbare
 * a cheilor Discord / Google sau a numelui site-ului se aplică la următorul request, fără restart.
 */
export async function getAuth(): Promise<GcsAuth> {
  const { settings } = services();
  // Înainte de instalare (sau dacă baza nu răspunde) folosim valorile implicite ale setărilor.
  const get = <T,>(key: string, fallback: T) => settings.get<T>(key).catch(() => fallback);
  const [siteName, siteUrl, emailConfirm, discordClientId, discordClientSecret, googleClientId, googleClientSecret, turnstileSecret, captcha] = await Promise.all([
    get("site.name", "GamingCommunitySuite"),
    get("site.url", ""),
    get("auth.email_confirm", true),
    get("auth.discord_client_id", ""),
    get("auth.discord_client_secret", ""),
    get("auth.google_client_id", ""),
    get("auth.google_client_secret", ""),
    get("auth.turnstile_secret", ""),
    get("antispam.captcha", "pow"),
  ]);
  const config: GcsAuthConfig = { siteName, siteUrl, emailConfirm, discordClientId, discordClientSecret, googleClientId, googleClientSecret, turnstileSecret, captcha };
  const key = JSON.stringify(config);
  if (globalForAuth.gcsAuth?.key !== key) globalForAuth.gcsAuth = { key, auth: createAuth(config) };
  return globalForAuth.gcsAuth.auth;
}
