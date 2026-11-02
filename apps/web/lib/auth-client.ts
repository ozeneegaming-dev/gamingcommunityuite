"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Clientul Better Auth din browser (același domeniu, `/api/auth`). */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});

/**
 * Cheia de traducere (`auth.errors.*`) pentru o eroare Better Auth.
 * Codurile noastre (ex. `USERNAME_TAKEN`) vin din hook-ul de creare a userului.
 */
export function authErrorKey(error: { status?: number; code?: string } | null | undefined): string {
  if (!error) return "generic";
  if (error.status === 429) return "rate_limited";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "USER_NOT_FOUND":
      return "invalid_credentials";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
    case "EMAIL_TAKEN":
      return "email_taken";
    case "PASSWORD_TOO_SHORT":
      return "password_too_short";
    case "PASSWORD_TOO_LONG":
      return "password_too_long";
    case "PASSWORD_NEEDS_MIX":
      return "password_needs_mix";
    case "ACCOUNT_LOCKED":
      return "account_locked";
    case "TERMS_REQUIRED":
      return "terms_required";
    case "OTP_DISABLED":
      return "otp_disabled";
    case "INVALID_EMAIL":
    case "EMAIL_INVALID":
      return "email_invalid";
    case "INVALID_CODE":
    case "INVALID_TWO_FACTOR_CODE":
    case "INVALID_BACKUP_CODE":
    case "OTP_HAS_EXPIRED":
      return "invalid_code";
    case "USERNAME_TAKEN":
    case "USERNAME_TOO_SHORT":
    case "USERNAME_TOO_LONG":
    case "USERNAME_INVALID_CHARS":
      return error.code.toLowerCase();
    case "BANNED":
      return "banned";
    case "REGISTRATION_CLOSED":
      return "registration_closed";
    case "QA_FAILED":
      return "qa_failed";
    case "SPAM_SOURCE":
      return "spam_source";
    case "CAPTCHA_FAILED":
    case "MISSING_RESPONSE":
    case "VERIFICATION_FAILED":
    case "UNKNOWN_ERROR":
      return "captcha";
    default:
      return "generic";
  }
}

/** Câmpul formularului de înregistrare de care ține o eroare (pentru afișarea pe câmp). */
export function registerErrorField(key: string): "name" | "email" | "password" | "terms" | null {
  if (key.startsWith("username_")) return "name";
  if (key.startsWith("email_")) return "email";
  if (key.startsWith("password_")) return "password";
  if (key === "terms_required") return "terms";
  return null;
}

/** Minutele rămase până la deblocarea contului (mesajul erorii `ACCOUNT_LOCKED`). */
export function lockMinutes(error: { message?: string } | null | undefined): number {
  const n = Number(error?.message);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
