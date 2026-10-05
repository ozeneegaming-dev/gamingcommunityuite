import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
  const { settings } = services();
  const [siteName, turnstileSiteKey, turnstileSecret] = await Promise.all([
    settings.get<string>("site.name"),
    settings.get<string>("auth.turnstile_site_key"),
    settings.get<string>("auth.turnstile_secret"),
  ]);
  // Widgetul apare doar dacă e configurat complet (cheia publică și secretul verificat pe server).
  const turnstile = turnstileSiteKey && turnstileSecret ? turnstileSiteKey : null;

  return (
    <GcsAuthCard title={t("title")} subtitle={t("subtitle", { site: siteName })}>
      <RegisterForm turnstileSiteKey={turnstile} />
    </GcsAuthCard>
  );
}
