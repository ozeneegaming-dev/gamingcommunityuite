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
  const [siteName, discordClientId, googleClientId] = await Promise.all([
    settings.get<string>("site.name"),
    settings.get<string>("auth.discord_client_id"),
    settings.get<string>("auth.google_client_id"),
  ]);
  const { error } = await searchParams;
  const initialError = loginError(error);

  return (
    <GcsAuthCard title={t("title")} subtitle={t("subtitle", { site: siteName })} icon={<GcsIcon name="fa-solid fa-right-to-bracket" />}>
      <LoginForm discordEnabled={discordClientId !== ""} googleEnabled={googleClientId !== ""} initialError={initialError} />
    </GcsAuthCard>
  );
}

/**
 * Eroarea din adresă, după o autentificare eșuată: Steam (pluginul nostru) sau Discord / Google (Better Auth trimite
 * codul în `?error=`). `account_not_linked`: există deja un cont cu acest email, cu emailul neconfirmat, deci nu se
 * leagă automat (altfel cine a creat contul cu emailul altcuiva ar păstra accesul); se leagă din Setări → Cont.
 */
function loginError(error: string | undefined): string | null {
  if (!error) return null;
  if (error === "steam" || error === "steam_linked") return error;
  if (error === "account_not_linked") return "account_not_linked";
  return "social";
}
