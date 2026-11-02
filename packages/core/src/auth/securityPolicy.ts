import type { GcsSettingsService } from "../settings/service";

/**
 * Politica de securitate a conturilor (ACP → Setări → Securitate): parolele, 2FA obligatoriu pe grupuri și recuperarea
 * 2FA. Cheile setărilor stau aici (le citesc nucleul și aplicația web); definițiile lor sunt în modulul `core`.
 */
export const PASSWORD_MIN_LENGTH_SETTING = "security.password_min_length";
export const PASSWORD_REQUIRE_MIX_SETTING = "security.password_require_mix";
export const MFA_REQUIRED_GROUPS_SETTING = "security.mfa_required_groups";
export const MFA_RECOVERY_SETTING = "security.mfa_recovery";
export const NEW_DEVICE_EMAIL_SETTING = "security.new_device_email";

/** Better Auth refuză oricum parolele sub 8 caractere și peste 128: setarea rămâne între aceste limite. */
export const PASSWORD_MIN_FLOOR = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type GcsPasswordPolicy = { minLength: number; requireMix: boolean };
export const DEFAULT_PASSWORD_POLICY: GcsPasswordPolicy = { minLength: PASSWORD_MIN_FLOOR, requireMix: true };

export type GcsPasswordPolicyError = "password_too_short" | "password_too_long" | "password_needs_mix";

/** Codul încălcării politicii (cheie de traducere `auth.errors.*`) sau `null` pentru o parolă acceptată. */
export function passwordPolicyError(password: string, policy: GcsPasswordPolicy): GcsPasswordPolicyError | null {
  const length = [...password].length;
  if (length < Math.max(policy.minLength, PASSWORD_MIN_FLOOR)) return "password_too_short";
  if (password.length > PASSWORD_MAX_LENGTH) return "password_too_long";
  if (policy.requireMix && !(/\p{L}/u.test(password) && /\p{Nd}/u.test(password))) return "password_needs_mix";
  return null;
}

/** Politica din setări; o setare care lipsește sau o bază indisponibilă dau valorile implicite. */
export async function loadPasswordPolicy(settings: Pick<GcsSettingsService, "get">): Promise<GcsPasswordPolicy> {
  const [min, mix] = await Promise.all([
    settings.get<number>(PASSWORD_MIN_LENGTH_SETTING).catch(() => DEFAULT_PASSWORD_POLICY.minLength),
    settings.get<boolean>(PASSWORD_REQUIRE_MIX_SETTING).catch(() => DEFAULT_PASSWORD_POLICY.requireMix),
  ]);
  const minLength = Number.isInteger(min) ? Math.min(Math.max(min, PASSWORD_MIN_FLOOR), PASSWORD_MAX_LENGTH) : DEFAULT_PASSWORD_POLICY.minLength;
  return { minLength, requireMix: mix !== false };
}

/** Recuperarea 2FA când membrul nu mai are aplicația: doar codurile de rezervă, sau și un cod trimis pe email. */
export const MFA_RECOVERY_MODES = ["backup_codes", "email_code"] as const;
export type GcsMfaRecovery = (typeof MFA_RECOVERY_MODES)[number];

export async function loadMfaRecovery(settings: Pick<GcsSettingsService, "get">): Promise<GcsMfaRecovery> {
  const value = await settings.get<string>(MFA_RECOVERY_SETTING).catch(() => "backup_codes");
  return value === "email_code" ? "email_code" : "backup_codes";
}

/** Grupurile (id-uri) ai căror membri trebuie să-și activeze 2FA înainte să folosească site-ul. */
export async function loadMfaRequiredGroups(settings: Pick<GcsSettingsService, "get">): Promise<number[]> {
  const value = await settings.get<unknown>(MFA_REQUIRED_GROUPS_SETTING).catch(() => []);
  return Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v) && v > 0) : [];
}

/** Membrul e într-un grup cu 2FA obligatoriu (principal sau secundar) și nu și-a activat încă 2FA. */
export function mfaSetupRequired(member: { groupIds: number[]; twoFactorEnabled: boolean }, requiredGroups: number[]): boolean {
  if (member.twoFactorEnabled || requiredGroups.length === 0) return false;
  return member.groupIds.some((g) => requiredGroups.includes(g));
}

/** Validarea listei de grupuri cu 2FA obligatoriu: id-uri întregi pozitive, fără dubluri, cel mult 100. */
export function mfaRequiredGroupsError(value: unknown): string | null {
  if (!Array.isArray(value) || value.length > 100) return "invalid";
  if (!value.every((v) => Number.isInteger(v) && (v as number) > 0)) return "invalid";
  return new Set(value).size === value.length ? null : "invalid";
}
