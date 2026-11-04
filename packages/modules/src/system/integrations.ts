import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

/** Secțiunea ACP (ACP › Sistem › Funcții site › Integrări). */
export const INTEGRATIONS_ACP_SECTION = "system.integrations";
export const ANALYTICS_SETTING = "integrations.analytics";

export type GcsAnalyticsProvider = "none" | "ga4" | "plausible" | "umami";
export type GcsAnalyticsConfig = {
  provider: GcsAnalyticsProvider;
  /** Google Analytics 4: ID-ul fluxului (`G-XXXXXXX`). */
  ga4Id: string;
  /** Plausible: domeniul site-ului, așa cum e trecut în Plausible, și scriptul (cloud sau instalarea proprie). */
  plausibleDomain: string;
  plausibleSrc: string;
  /** Umami: ID-ul site-ului (UUID) și scriptul. */
  umamiId: string;
  umamiSrc: string;
  /** Staff-ul (cine are acces în ACP) nu e numărat. */
  skipStaff: boolean;
  /** Scriptul pornește doar după „Am înțeles” pe banda de cookie-uri (Google Analytics pune cookie-uri). */
  afterCookieNotice: boolean;
};

export const DEFAULT_ANALYTICS: GcsAnalyticsConfig = {
  provider: "none",
  ga4Id: "",
  plausibleDomain: "",
  plausibleSrc: "https://plausible.io/js/script.js",
  umamiId: "",
  umamiSrc: "https://cloud.umami.is/script.js",
  skipStaff: true,
  afterCookieNotice: true,
};

const GA4 = /^G-[A-Z0-9]{4,16}$/;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isScriptUrl = (v: unknown) => {
  if (typeof v !== "string" || v.length > 300) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
};

export function analyticsConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsAnalyticsConfig>;
  if (c.provider !== "none" && c.provider !== "ga4" && c.provider !== "plausible" && c.provider !== "umami") return "invalid_choice";
  if (typeof c.skipStaff !== "boolean" || typeof c.afterCookieNotice !== "boolean") return "invalid";
  if (typeof c.ga4Id !== "string" || (c.ga4Id !== "" && !GA4.test(c.ga4Id))) return "invalid_ga4";
  if (typeof c.plausibleDomain !== "string" || (c.plausibleDomain !== "" && !DOMAIN.test(c.plausibleDomain))) return "invalid_domain";
  if (typeof c.umamiId !== "string" || (c.umamiId !== "" && !UUID.test(c.umamiId))) return "invalid_uuid";
  if (!isScriptUrl(c.plausibleSrc) || !isScriptUrl(c.umamiSrc)) return "invalid_url";
  if (c.provider === "ga4" && !c.ga4Id) return "invalid_ga4";
  if (c.provider === "plausible" && !c.plausibleDomain) return "invalid_domain";
  if (c.provider === "umami" && !c.umamiId) return "invalid_uuid";
  return null;
}

export const analyticsSetting: GcsSettingDef = { key: ANALYTICS_SETTING, type: "json", default: DEFAULT_ANALYTICS, section: "integrations", labelKey: "settings.integrations.analytics", validate: analyticsConfigError };

export async function loadAnalyticsConfig(settings: Pick<GcsSettingsService, "get">): Promise<GcsAnalyticsConfig> {
  const v = await settings.get<GcsAnalyticsConfig | null>(ANALYTICS_SETTING).catch(() => null);
  return v && analyticsConfigError(v) === null ? v : DEFAULT_ANALYTICS;
}

/**
 * Scripturile de pus în pagină pentru furnizorul ales (`null` = niciunul). Valorile sunt deja validate (ID-ul GA4 e
 * `G-` + litere mari și cifre), deci pot intra în scriptul inline.
 */
export function analyticsTags(c: GcsAnalyticsConfig): { src: string; attrs: Record<string, string>; inline: string | null } | null {
  switch (c.provider) {
    case "ga4":
      return {
        src: `https://www.googletagmanager.com/gtag/js?id=${c.ga4Id}`,
        attrs: {},
        inline: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","${c.ga4Id}");`,
      };
    case "plausible":
      return { src: c.plausibleSrc, attrs: { "data-domain": c.plausibleDomain }, inline: null };
    case "umami":
      return { src: c.umamiSrc, attrs: { "data-website-id": c.umamiId }, inline: null };
    default:
      return null;
  }
}

export type GcsIntegrationGroup = "login" | "security" | "email" | "search" | "translate" | "developers";
export type GcsIntegrationItem = {
  key: string;
  group: GcsIntegrationGroup;
  /** `ok` = pornit și configurat; `warn` = pornit, dar lipsește ceva; `off` = neconfigurat. */
  level: "ok" | "warn" | "off";
  /** Unde se configurează. */
  href: string;
  /** Un detaliu scurt (furnizorul, numărul de chei…), netradus. */
  detail?: string;
};

const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";
const pair = (a: unknown, b: unknown): GcsIntegrationItem["level"] => (filled(a) && filled(b) ? "ok" : filled(a) || filled(b) ? "warn" : "off");

/** Starea serviciilor externe ale site-ului, cu pagina ACP a fiecăruia (hub-ul „Integrări”). */
export async function integrationsOverview(deps: { db: PrismaClient; settings: Pick<GcsSettingsService, "get"> }): Promise<GcsIntegrationItem[]> {
  const { db, settings } = deps;
  const get = (key: string) => settings.get<unknown>(key).catch(() => null);
  const keys = [
    "auth.discord_client_id",
    "auth.discord_client_secret",
    "auth.google_client_id",
    "auth.google_client_secret",
    "auth.steam_api_key",
    "auth.turnstile_site_key",
    "auth.turnstile_secret",
    "antispam.captcha",
    "antispam.sfs_enabled",
    "email.smtp_host",
    "seo.google_verification",
    "seo.bing_verification",
    "seo.yandex_verification",
    "seo.indexnow_enabled",
    "i18n.translate_provider",
    "i18n.deepl_key",
    "i18n.google_key",
    "i18n.libretranslate_url",
  ] as const;
  const values = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await get(k)] as const))) as Record<(typeof keys)[number], unknown>;
  const [hooks, apiKeys] = await Promise.all([db.webhookEndpoint.count({ where: { enabled: true } }), db.apiKey.count({ where: { revokedAt: null } })]);

  const captcha = values["antispam.captcha"];
  const turnstileKeys = pair(values["auth.turnstile_site_key"], values["auth.turnstile_secret"]);
  const provider = typeof values["i18n.translate_provider"] === "string" ? values["i18n.translate_provider"] : "off";
  const providerKey = provider === "google" ? values["i18n.google_key"] : provider === "deepl" ? values["i18n.deepl_key"] : provider === "libretranslate" ? values["i18n.libretranslate_url"] : null;
  const verified = (["google", "bing", "yandex"] as const).filter((e) => filled(values[`seo.${e}_verification`]));

  return [
    { key: "discord", group: "login", level: pair(values["auth.discord_client_id"], values["auth.discord_client_secret"]), href: "/admin/settings/auth" },
    { key: "google", group: "login", level: pair(values["auth.google_client_id"], values["auth.google_client_secret"]), href: "/admin/settings/auth" },
    { key: "steam", group: "login", level: filled(values["auth.steam_api_key"]) ? "ok" : "off", href: "/admin/settings/auth" },
    { key: "turnstile", group: "security", level: captcha === "turnstile" ? (turnstileKeys === "ok" ? "ok" : "warn") : "off", href: "/admin/members/moderation/antispam" },
    { key: "sfs", group: "security", level: values["antispam.sfs_enabled"] === true ? "ok" : "off", href: "/admin/members/moderation/antispam" },
    { key: "smtp", group: "email", level: filled(values["email.smtp_host"]) ? "ok" : "off", href: "/admin/settings/email" },
    { key: "verification", group: "search", level: verified.length > 0 ? "ok" : "off", href: "/admin/system/seo", ...(verified.length > 0 ? { detail: verified.join(", ") } : {}) },
    { key: "indexnow", group: "search", level: values["seo.indexnow_enabled"] === true ? "ok" : "off", href: "/admin/system/seo" },
    { key: "translate", group: "translate", level: provider === "off" ? "off" : filled(providerKey) ? "ok" : "warn", href: "/admin/settings/languages", detail: provider },
    { key: "webhooks", group: "developers", level: hooks > 0 ? "ok" : "off", href: "/admin/system/webhooks", detail: String(hooks) },
    { key: "api", group: "developers", level: apiKeys > 0 ? "ok" : "off", href: "/admin/system/api", detail: String(apiKeys) },
  ];
}
