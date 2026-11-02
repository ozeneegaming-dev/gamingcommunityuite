import "server-only";
import { loadPasswordPolicy, type GcsPasswordPolicy } from "@gcs/core";
import { cookieBanner, legalLinks, termsRequiredOnRegister } from "@gcs/modules";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { COOKIE_NOTICE_COOKIE } from "./legal-consent";
import { services } from "./services";

/** Ce îi trebuie formularului de înregistrare din setările legale și de securitate. */
export type GcsRegistrationLegal = {
  requireTerms: boolean;
  terms: string | null;
  privacy: string | null;
  policy: GcsPasswordPolicy;
  /** Regula parolei, tradusă (ajutorul de sub câmp). */
  passwordHint: string;
};

/** Regula parolei pentru ajutorul de sub câmp (înregistrare, schimbarea parolei). */
export async function passwordRuleHint(policy: GcsPasswordPolicy): Promise<string> {
  const t = await getTranslations("auth.passwordRule");
  return t(policy.requireMix ? "mix" : "length", { min: policy.minLength });
}

export async function registrationLegal(): Promise<GcsRegistrationLegal> {
  const { settings } = services();
  const [links, requireTerms, policy] = await Promise.all([
    legalLinks(settings).catch(() => ({ terms: null, privacy: null })),
    termsRequiredOnRegister(settings).catch(() => false),
    loadPasswordPolicy(settings),
  ]);
  return { requireTerms, terms: links.terms, privacy: links.privacy, policy, passwordHint: await passwordRuleHint(policy) };
}

/** Banda de cookie-uri pentru cererea curentă: `null` dacă e oprită sau vizitatorul a închis-o deja. */
export async function cookieNoticeView(): Promise<{ text: string; privacyHref: string | null; labels: { region: string; accept: string; privacy: string } } | null> {
  if ((await cookies()).get(COOKIE_NOTICE_COOKIE)?.value === "1") return null;
  const { settings } = services();
  const banner = await cookieBanner(settings).catch(() => ({ enabled: false, text: null }));
  if (!banner.enabled) return null;
  const [t, links] = await Promise.all([getTranslations("cookieBanner"), legalLinks(settings).catch(() => ({ terms: null, privacy: null }))]);
  return { text: banner.text ?? t("text"), privacyHref: links.privacy, labels: { region: t("region"), accept: t("accept"), privacy: t("privacy") } };
}
