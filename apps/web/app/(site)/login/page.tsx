import { loadMfaRecovery, PASSWORD_RESET_ENABLED_SETTING } from "@gcs/core";
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

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  if ((await currentActor()).userId) redirect("/");
  const t = await getTranslations("auth.login");
  const { settings } = services();
  const [siteName, discordClientId, googleClientId, recovery, forgotEnabled] = await Promise.all([
    settings.get<string>("site.name"),
    settings.get<string>("auth.discord_client_id"),
    settings.get<string>("auth.google_client_id"),
    loadMfaRecovery(settings),
    settings.get<boolean>(PASSWORD_RESET_ENABLED_SETTING).catch(() => true),
  ]);
  const { error, reset } = await searchParams;
  const initialError = loginError(error);
  // După „Am uitat parola”: parola nouă e salvată, membrul intră cu ea (2FA se cere în continuare, dacă e activ).
  const initialNotice = reset === "done" ? t("resetDone") : null;

  return (
    <GcsAuthCard title={t("title")} subtitle={t("subtitle", { site: siteName })} icon={<GcsIcon name="fa-solid fa-right-to-bracket" />}>
      <LoginForm
        discordEnabled={discordClientId !== ""}
        googleEnabled={googleClientId !== ""}
        initialError={initialError}
        emailRecovery={recovery === "email_code"}
        forgotEnabled={forgotEnabled !== false}
        initialNotice={initialNotice}
      />
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
  // Contul nou oprit la creare (Discord / Google / Steam): termenii neacceptați, înregistrările închise, un ban.
  const code = error.toUpperCase();
  if (code === "TERMS_REQUIRED") return "terms_required_social";
  if (code === "REGISTRATION_CLOSED") return "registration_closed";
  if (code === "BANNED") return "banned";
  return "social";
}
