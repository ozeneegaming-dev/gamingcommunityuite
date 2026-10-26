import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsAuthCard } from "../_components/GcsAuthCard";
import { RegisterForm } from "./RegisterForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register");
  return { title: t("title") };
}

export default async function RegisterPage() {
  if ((await currentActor()).userId) redirect("/");
  const t = await getTranslations("auth.register");
  const { settings, antispam } = services();
  const locale = await getLocale();
  const [siteName, turnstileSiteKey, turnstileSecret, challenge] = await Promise.all([
    settings.get<string>("site.name"),
    settings.get<string>("auth.turnstile_site_key"),
    settings.get<string>("auth.turnstile_secret"),
    antispam.registrationChallenge(locale),
  ]);
  // Turnstile apare doar în modul lui și configurat complet (cheia publică și secretul verificat pe server).
  const turnstile = challenge.captcha === "turnstile" && turnstileSiteKey && turnstileSecret ? turnstileSiteKey : null;

  return (
    <GcsAuthCard title={t("title")} subtitle={t("subtitle", { site: siteName })} icon={<GcsIcon name="fa-solid fa-user-plus" />}>
      <RegisterForm turnstileSiteKey={turnstile} pow={challenge.captcha === "pow"} question={challenge.question} locale={locale} />
    </GcsAuthCard>
  );
}
