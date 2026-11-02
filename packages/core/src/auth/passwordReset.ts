import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import { emailConfigured } from "../email/send";
import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError } from "../errors";
import type { GcsSettingsService } from "../settings/service";
import type { GcsLoginLockout } from "./lockout";
import { hashPassword } from "./passwords";
import type { GcsRateLimitRule, GcsRateLimiter } from "./rateLimit";
import { loadPasswordPolicy, passwordPolicyError } from "./securityPolicy";
import { normalizeEmail, normalizeUsername } from "./usernames";

/**
 * „Am uitat parola” (ACP → Setări → Securitate): funcția poate fi oprită, linkul e valabil N minute, iar la resetare
 * celelalte sesiuni ale membrului se pot închide.
 */
export const PASSWORD_RESET_ENABLED_SETTING = "auth.password_reset_enabled";
export const PASSWORD_RESET_MINUTES_SETTING = "auth.password_reset_minutes";
export const PASSWORD_RESET_REVOKE_SESSIONS_SETTING = "auth.password_reset_revoke_sessions";
export const PASSWORD_RESET_MINUTES_DEFAULT = 30;
export const PASSWORD_RESET_MINUTES_MIN = 5;
export const PASSWORD_RESET_MINUTES_MAX = 1440;

/** Cererile de resetare: cel mult 3 emailuri pe cont și 10 cereri pe IP la 15 minute. */
export const PASSWORD_RESET_ACCOUNT_LIMIT: GcsRateLimitRule = { window: 15 * 60, max: 3 };
export const PASSWORD_RESET_IP_LIMIT: GcsRateLimitRule = { window: 15 * 60, max: 10 };

/** Rândurile din `verifications`: `password-reset:<sha256 al tokenului>` → id-ul membrului. Tokenul nu se păstrează. */
const IDENTIFIER_PREFIX = "password-reset:";
/** Dispozitivele de încredere ale 2FA (Better Auth): `trust-device-…` → id-ul membrului. */
const TRUST_DEVICE_PREFIX = "trust-device-";
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
/** Conturile Steam fără email și contul-bot au adrese `.invalid`: nu primesc nimic. */
const UNDELIVERABLE = /\.invalid$/i;
/** Furnizorii de autentificare externi pe care îi poate avea un cont fără parolă. */
const SOCIAL_PROVIDERS = ["discord", "google", "steam"] as const;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const identifierOf = (token: string) => `${IDENTIFIER_PREFIX}${tokenHash(token)}`;

/** De ce nu se poate cere o resetare pe acest site (nimic legat de un cont anume, deci fără enumerare). */
export type GcsPasswordResetAvailability = "available" | "disabled" | "no_email";

/** Destinatarul emailurilor resetării: limba și fusul orar ale membrului. */
export type GcsPasswordResetRecipient = { id: string; name: string; email: string; locale: string; timezone: string };

/**
 * Emailul care pleacă după o cerere sau după resetare. Serviciul nu trimite nimic: aplicația îl scrie în limba
 * membrului și îl trimite după răspuns (ca timpul răspunsului să nu spună dacă există contul).
 * - `link`: contul are parolă → linkul de unică folosință;
 * - `social`: contul se autentifică doar cu Discord / Google / Steam → emailul explică asta (fără link);
 * - `changed`: parola a fost schimbată → anunțul, cu linkul spre o resetare nouă.
 */
export type GcsPasswordResetMail =
  | { kind: "link"; to: GcsPasswordResetRecipient; link: string; minutes: number }
  | { kind: "social"; to: GcsPasswordResetRecipient; providers: string[]; loginLink: string }
  | { kind: "changed"; to: GcsPasswordResetRecipient; at: Date; ip: string | null; sessionsRevoked: boolean; forgotLink: string };

/** Sesiunea browserului care face resetarea: rămâne deschisă doar dacă e chiar a membrului. */
export type GcsPasswordResetSession = { id: string; userId: string } | null;

export type GcsPasswordResetResult = { userId: string; revokedSessions: number; mail: GcsPasswordResetMail | null };

export type GcsPasswordResetDeps = {
  db: PrismaClient;
  settings: Pick<GcsSettingsService, "get">;
  rateLimiter: Pick<GcsRateLimiter, "consume">;
  lockout: Pick<GcsLoginLockout, "clear">;
  /** Adresa publică a site-ului (linkurile din emailuri). */
  baseUrl: () => Promise<string>;
  /** Limita pe IP (oprită odată cu rate limit-ul, `GCS_DISABLE_RATE_LIMIT=1`). */
  ipLimit?: () => boolean;
};

const RECIPIENT_SELECT = { id: true, name: true, email: true, locale: true, timezone: true, isBot: true } as const;

/**
 * Resetarea parolei prin email (fără sesiune): cererea cu emailul sau numele de utilizator, tokenul de unică folosință
 * (doar hash-ul lui în baza de date, valabil `auth.password_reset_minutes`, înlocuit de o cerere nouă) și resetarea, care
 * aplică politica parolelor, consumă tokenul, uită blocarea contului, închide sesiunile și scrie în jurnalul ACP.
 * Cererea nu spune niciodată dacă există contul: același rezultat pentru orice date, iar limita pe cont nu se vede.
 */
export class GcsPasswordResetService {
  constructor(private readonly deps: GcsPasswordResetDeps) {}

  /** Funcția e pornită din ACP și site-ul poate trimite emailuri. */
  async availability(): Promise<GcsPasswordResetAvailability> {
    const enabled = await this.deps.settings.get<boolean>(PASSWORD_RESET_ENABLED_SETTING).catch(() => true);
    if (enabled === false) return "disabled";
    return (await emailConfigured(this.deps.settings)) ? "available" : "no_email";
  }

  /** Câte minute e valabil linkul (setarea, între limite). */
  async minutes(): Promise<number> {
    const value = await this.deps.settings.get<number>(PASSWORD_RESET_MINUTES_SETTING).catch(() => PASSWORD_RESET_MINUTES_DEFAULT);
    return Number.isInteger(value) ? Math.min(Math.max(value, PASSWORD_RESET_MINUTES_MIN), PASSWORD_RESET_MINUTES_MAX) : PASSWORD_RESET_MINUTES_DEFAULT;
  }

  private async assertAvailable(): Promise<void> {
    const availability = await this.availability();
    if (availability !== "available") throw new GcsForbidden({ reason: availability });
  }

  private async base(): Promise<string> {
    return (await this.deps.baseUrl()).replace(/\/+$/, "");
  }

  /**
   * O cerere de resetare (emailul sau numele de utilizator). Întoarce emailul de trimis sau `null` (cont inexistent, fără
   * adresă reală, peste limita contului); apelantul răspunde la fel în toate cazurile. Peste limita IP-ului (care numără
   * orice cerere, cu sau fără cont) → `GcsRateLimited`.
   */
  async request(input: { identifier: string; ip: string | null }, now = new Date()): Promise<GcsPasswordResetMail | null> {
    await this.assertAvailable();
    const { db, rateLimiter } = this.deps;
    const ip = input.ip && input.ip !== "0.0.0.0" ? input.ip : null;
    if (ip && (this.deps.ipLimit?.() ?? true)) {
      const limit = await rateLimiter.consume(`password-reset:ip:${ip}`, PASSWORD_RESET_IP_LIMIT);
      if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    }
    const identifier = input.identifier.trim();
    if (!identifier || identifier.length > 200) return null;
    // Numele de utilizator nu pot conține „@”: cu „@” e un email.
    const user = identifier.includes("@")
      ? await db.user.findUnique({ where: { email: normalizeEmail(identifier) }, select: RECIPIENT_SELECT })
      : await db.user.findUnique({ where: { nameNormalized: normalizeUsername(identifier) }, select: RECIPIENT_SELECT });
    if (!user || user.isBot || UNDELIVERABLE.test(user.email)) return null;
    const limit = await rateLimiter.consume(`password-reset:u:${user.id}`, PASSWORD_RESET_ACCOUNT_LIMIT);
    if (!limit.allowed) return null;

    const to: GcsPasswordResetRecipient = { id: user.id, name: user.name, email: user.email, locale: user.locale, timezone: user.timezone };
    const accounts = await db.account.findMany({ where: { userId: user.id }, select: { providerId: true, password: true } });
    const base = await this.base();
    if (!accounts.some((a) => a.providerId === "credential" && a.password)) {
      const providers = SOCIAL_PROVIDERS.filter((p) => accounts.some((a) => a.providerId === p));
      return { kind: "social", to, providers, loginLink: `${base}/login` };
    }

    const minutes = await this.minutes();
    const token = randomBytes(32).toString("base64url");
    // O cerere nouă anulează linkurile trimise înainte.
    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.verification.deleteMany({ where: { identifier: { startsWith: IDENTIFIER_PREFIX }, value: user.id } });
      await tx.verification.create({ data: { identifier: identifierOf(token), value: user.id, expiresAt: new Date(now.getTime() + minutes * 60_000) } });
    });
    return { kind: "link", to, link: `${base}/reset-password?token=${token}`, minutes };
  }

  /** Rândul tokenului, dacă e încă valabil (fără să-l consume). */
  private async findToken(token: string, now: Date): Promise<{ id: string; userId: string } | null> {
    if (!TOKEN.test(token)) return null;
    const row = await this.deps.db.verification.findFirst({ where: { identifier: identifierOf(token) }, select: { id: true, value: true, expiresAt: true } });
    if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
    return { id: row.id, userId: row.value };
  }

  /** Linkul din email mai e valabil (pagina îl verifică înainte să arate formularul; nu îl consumă). */
  async check(token: string, now = new Date()): Promise<boolean> {
    if ((await this.availability()) !== "available") return false;
    return (await this.findToken(token, now)) !== null;
  }

  /**
   * Parola nouă din linkul primit pe email. Tokenul invalid, expirat, folosit sau înlocuit → `GcsNotFound`; o parolă care
   * nu respectă politica → `GcsValidationError` (tokenul rămâne valabil, membrul poate încerca din nou). 2FA rămâne activ.
   */
  async reset(input: { token: string; password: string; ip: string | null; session?: GcsPasswordResetSession }, now = new Date()): Promise<GcsPasswordResetResult> {
    await this.assertAvailable();
    const { db, settings } = this.deps;
    const found = await this.findToken(input.token, now);
    if (!found) throw new GcsNotFound({ reason: "invalid_token" });
    const policyError = passwordPolicyError(input.password, await loadPasswordPolicy(settings));
    if (policyError) throw new GcsValidationError({ password: policyError });

    const user = await db.user.findUnique({ where: { id: found.userId }, select: RECIPIENT_SELECT });
    if (!user || user.isBot) throw new GcsNotFound({ reason: "invalid_token" });
    const revoke = (await settings.get<boolean>(PASSWORD_RESET_REVOKE_SESSIONS_SETTING).catch(() => true)) !== false;
    const keep = input.session && input.session.userId === user.id ? input.session.id : null;
    const ip = input.ip && input.ip !== "0.0.0.0" ? input.ip : null;
    const hash = await hashPassword(input.password);

    const revokedSessions = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // Consumarea: doar o cerere poate șterge rândul (două trimiteri simultane ale aceluiași link → una singură reușește).
      const { count } = await tx.verification.deleteMany({ where: { id: found.id } });
      if (count !== 1) throw new GcsNotFound({ reason: "invalid_token" });
      await tx.verification.deleteMany({ where: { identifier: { startsWith: IDENTIFIER_PREFIX }, value: user.id } });
      const credential = await tx.account.findFirst({ where: { userId: user.id, providerId: "credential" }, select: { id: true } });
      if (credential) await tx.account.update({ where: { id: credential.id }, data: { password: hash } });
      else await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
      // Resetarea cerută de staff (Membri v2) e îndeplinită: parola s-a schimbat.
      await tx.user.update({ where: { id: user.id }, data: { passwordResetRequestedAt: null } });
      let revoked = 0;
      if (revoke) {
        revoked = (await tx.session.deleteMany({ where: { userId: user.id, ...(keep ? { NOT: { id: keep } } : {}) } })).count;
        // Și dispozitivele de încredere ale 2FA: la următoarea autentificare, codul 2FA se cere pe orice dispozitiv.
        await tx.verification.deleteMany({ where: { identifier: { startsWith: TRUST_DEVICE_PREFIX }, value: user.id } });
      }
      await writeAudit(tx, { actorId: user.id, action: "auth.password_reset", targetType: "user", targetId: user.id, after: { via: "email", sessionsRevoked: revoked }, ip });
      return revoked;
    });
    // Blocarea după parole greșite nu mai are sens cu parola nouă.
    await this.deps.lockout.clear(user.id).catch(() => {});

    const to: GcsPasswordResetRecipient = { id: user.id, name: user.name, email: user.email, locale: user.locale, timezone: user.timezone };
    const mail: GcsPasswordResetMail | null = UNDELIVERABLE.test(user.email)
      ? null
      : { kind: "changed", to, at: now, ip, sessionsRevoked: revoke, forgotLink: `${await this.base()}/forgot-password` };
    return { userId: user.id, revokedSessions, mail };
  }
}
