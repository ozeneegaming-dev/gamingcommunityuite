import "server-only";
import { GCS_LOCALE_KEYS } from "@gcs/modules";
import { createTranslator } from "next-intl";
import { services } from "./services";

type GcsLocale = (typeof GCS_LOCALE_KEYS)[number];
const isLocale = (v: unknown): v is GcsLocale => GCS_LOCALE_KEYS.includes(v as GcsLocale);
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Codul 2FA pe email (recuperarea, când membrul nu mai are aplicația de autentificare și setarea o permite): emailul în
 * limba membrului (altfel a site-ului), cu codul de unică folosință (valabil 3 minute).
 */
export async function sendTwoFactorEmailCode(user: { id: string; email: string; name: string }, code: string): Promise<void> {
  const { db, settings, mailer } = services();
  const row = await db.user.findUnique({ where: { id: user.id }, select: { locale: true } });
  const [siteLocale, site] = await Promise.all([settings.get<string>("site.locale").catch(() => "ro"), settings.get<string>("site.name").catch(() => "GamingCommunitySuite")]);
  const userLocale = row?.locale;
  const locale: GcsLocale = isLocale(userLocale) ? userLocale : isLocale(siteLocale) ? siteLocale : "ro";
  const messages = (await import(`../messages/${locale}.json`)).default as Record<string, unknown>;
  const t = createTranslator({ locale, messages: messages as never, namespace: "auth.twoFactor.email" as never }) as unknown as (key: string, values?: Record<string, string>) => string;
  if (user.email.endsWith(".invalid")) return;
  await mailer({
    to: user.email,
    subject: t("subject", { site }),
    html: `<p>${escape(t("greeting", { name: user.name }))}</p><p>${escape(t("body"))}</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${escape(code)}</p><p>${escape(t("ignore"))}</p>`,
    text: `${t("body")} ${code}\n${t("ignore")}`,
  });
}
