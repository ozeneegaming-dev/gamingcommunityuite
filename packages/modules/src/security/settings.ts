import {
  ACP_SESSION_MINUTES_DEFAULT,
  ACP_SESSION_MINUTES_SETTING,
  LOGIN_LOCK_MINUTES_SETTING,
  LOGIN_MAX_ATTEMPTS_SETTING,
  MFA_RECOVERY_MODES,
  MFA_RECOVERY_SETTING,
  MFA_REQUIRED_GROUPS_SETTING,
  NEW_DEVICE_EMAIL_SETTING,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_FLOOR,
  PASSWORD_MIN_LENGTH_SETTING,
  PASSWORD_REQUIRE_MIX_SETTING,
  mfaRequiredGroupsError,
  type GcsSettingDef,
} from "@gcs/core";
import { isCommunityRules } from "../community/rules";

/**
 * Secțiunile ACP ale setărilor de securitate și legale. Cheile secțiunilor rămân cele din meniu (`settings_2fa`,
 * `settings_terms`), ca drepturile rolurilor ACP date deja pe ele să rămână valabile; titlurile sunt „Securitate” și
 * „Termeni și confidențialitate”.
 */
export const SECURITY_SECTION = "2fa";
export const LEGAL_SECTION = "terms";
export const SECURITY_ACP_SECTION = `system.settings_${SECURITY_SECTION}`;
export const LEGAL_ACP_SECTION = `system.settings_${LEGAL_SECTION}`;

const intIn = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");
const oneOf = (values: readonly string[]) => (v: unknown) => (values.includes(v as string) ? null : "invalid_choice");
const maxLen = (max: number) => (v: unknown) => (typeof v === "string" && v.length <= max ? null : "too_long");
/** O adresă externă pentru termeni / confidențialitate: doar `https://` (sau `http://`), ori gol. */
export const isLegalUrlOrEmpty = (v: unknown): string | null => {
  if (v === "") return null;
  if (typeof v !== "string" || v.length > 500 || !/^https?:\/\//i.test(v) || !URL.canParse(v)) return "invalid_url";
  return null;
};

const def = (key: string, type: GcsSettingDef["type"], defaultValue: unknown, section: string, labelKey: string, validate?: GcsSettingDef["validate"], extra: Partial<GcsSettingDef> = {}): GcsSettingDef => ({
  key,
  type,
  default: defaultValue,
  section,
  labelKey,
  ...(validate ? { validate } : {}),
  ...extra,
});

/** ACP → Setări → Securitate: blocarea după parole greșite, parolele, 2FA, emailul la dispozitiv nou, sesiunea ACP. */
export const SECURITY_SETTING_DEFS: GcsSettingDef[] = [
  def(LOGIN_MAX_ATTEMPTS_SETTING, "number", 5, SECURITY_SECTION, "settings.siteSecurity.login_max_attempts", intIn(0, 100)),
  def(LOGIN_LOCK_MINUTES_SETTING, "number", 15, SECURITY_SECTION, "settings.siteSecurity.login_lock_minutes", intIn(1, 1440)),
  def(PASSWORD_MIN_LENGTH_SETTING, "number", PASSWORD_MIN_FLOOR, SECURITY_SECTION, "settings.siteSecurity.password_min_length", intIn(PASSWORD_MIN_FLOOR, PASSWORD_MAX_LENGTH)),
  def(PASSWORD_REQUIRE_MIX_SETTING, "boolean", true, SECURITY_SECTION, "settings.siteSecurity.password_require_mix"),
  // Grupurile cu 2FA obligatoriu: formularul paginii are căsuțe (nu câmpul JSON generic).
  def(MFA_REQUIRED_GROUPS_SETTING, "json", [], SECURITY_SECTION, "settings.siteSecurity.mfa_required_groups", mfaRequiredGroupsError),
  def(MFA_RECOVERY_SETTING, "string", "backup_codes", SECURITY_SECTION, "settings.siteSecurity.mfa_recovery", oneOf(MFA_RECOVERY_MODES), { options: [...MFA_RECOVERY_MODES] }),
  // Emailul „autentificare de pe un dispozitiv nou” exista deja (membrul îl poate opri): comutatorul site-ului îl
  // oprește pentru toți; implicit pornit, ca înainte.
  def(NEW_DEVICE_EMAIL_SETTING, "boolean", true, SECURITY_SECTION, "settings.siteSecurity.new_device_email"),
  def(ACP_SESSION_MINUTES_SETTING, "number", ACP_SESSION_MINUTES_DEFAULT, SECURITY_SECTION, "settings.siteSecurity.acp_session_minutes", intIn(5, 1440)),
];

/** Pagina unui document legal: niciuna (404), pagina de pe site (`/terms`, `/privacy`) sau o adresă externă. */
export const LEGAL_MODES = ["none", "page", "external"] as const;
export type GcsLegalMode = (typeof LEGAL_MODES)[number];
export const LEGAL_DOCS = ["terms", "privacy"] as const;
export type GcsLegalDocKind = (typeof LEGAL_DOCS)[number];

export const legalSetting = (kind: GcsLegalDocKind, part: "mode" | "content" | "url") => `legal.${kind}_${part}`;
export const REQUIRE_TERMS_SETTING = "legal.require_terms_on_register";
export const COOKIE_BANNER_SETTING = "legal.cookie_banner";
export const COOKIE_TEXT_SETTING = "legal.cookie_text";

/** Conținutul unui document legal: aceeași formă ca regulile (documentul editorului, HTML-ul sanitizat, data). */
const legalContentError = (v: unknown) => (v === null || isCommunityRules(v) ? null : "invalid");

const legalDocDefs = (kind: GcsLegalDocKind): GcsSettingDef[] => [
  def(legalSetting(kind, "mode"), "string", "none", LEGAL_SECTION, `settings.legal.${kind}_mode`, oneOf(LEGAL_MODES), { options: [...LEGAL_MODES] }),
  def(legalSetting(kind, "content"), "json", null, LEGAL_SECTION, `settings.legal.${kind}_content`, legalContentError),
  def(legalSetting(kind, "url"), "string", "", LEGAL_SECTION, `settings.legal.${kind}_url`, isLegalUrlOrEmpty),
];

/** ACP → Setări → Termeni și confidențialitate: documentele, acceptarea la înregistrare și banda de cookie-uri. */
export const LEGAL_SETTING_DEFS: GcsSettingDef[] = [
  ...legalDocDefs("terms"),
  ...legalDocDefs("privacy"),
  // Se aplică doar cât timp există o pagină de termeni (pe site sau externă).
  def(REQUIRE_TERMS_SETTING, "boolean", true, LEGAL_SECTION, "settings.legal.require_terms_on_register"),
  def(COOKIE_BANNER_SETTING, "boolean", false, LEGAL_SECTION, "settings.legal.cookie_banner"),
  // Gol = textul implicit, tradus în limba vizitatorului.
  def(COOKIE_TEXT_SETTING, "string", "", LEGAL_SECTION, "settings.legal.cookie_text", maxLen(1000), { multiline: true }),
];

/**
 * Perioadele de păstrare a datelor (zile; 0 = mereu), aplicate zilnic de jobul `system.retention`. Doar tabelele care
 * există: jurnalul ACP, autentificările (dispozitivele și intrările de login din jurnal), jurnalul anti-spam, jurnalul
 * pluginurilor (erorile lor) și sesiunile / tokenurile expirate. IP-urile (`members.ip_retention_days`) și notificările
 * citite (`notifications.prune_days`) au setările și joburile lor.
 */
export const RETENTION_KEYS = ["audit_days", "login_days", "spam_log_days", "plugin_log_days", "sessions_days"] as const;
export type GcsRetentionKey = (typeof RETENTION_KEYS)[number];
export const retentionSetting = (key: GcsRetentionKey) => `retention.${key}`;
const RETENTION_DEFAULTS: Record<GcsRetentionKey, number> = { audit_days: 0, login_days: 0, spam_log_days: 0, plugin_log_days: 0, sessions_days: 30 };

export const RETENTION_SETTING_DEFS: GcsSettingDef[] = RETENTION_KEYS.map((k) =>
  def(retentionSetting(k), "number", RETENTION_DEFAULTS[k], LEGAL_SECTION, `settings.retention.${k}`, intIn(0, 3650)),
);
