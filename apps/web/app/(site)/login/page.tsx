import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsAuthCard } from "../_components/GcsAuthCard";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("title") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await currentActor()).userId) redirect("/");
  const t = await getTranslations("auth.login");
  const { settings } = services();
  const [siteName, discordClientId] = await Promise.all([
    settings.get<string>("site.name"),
    settings.get<string>("auth.discord_client_id"),
  ]);
  const { error } = await searchParams;
  const initialError = error === "steam" || error === "steam_linked" ? error : null;

  return (
    <GcsAuthCard title={t("title")} subtitle={t("subtitle", { site: siteName })} icon={<GcsIcon name="fa-solid fa-right-to-bracket" />}>
      <LoginForm discordEnabled={discordClientId !== ""} initialError={initialError} />
    </GcsAuthCard>
  );
}
