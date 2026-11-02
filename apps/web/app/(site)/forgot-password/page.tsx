import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsAuthCard } from "../_components/GcsAuthCard";
import { GcsPasswordResetUnavailable } from "../_components/GcsPasswordResetUnavailable";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgot");
  return { title: t("title") };
}

/**
 * „Ai uitat parola?” (linkul din formularul de autentificare): emailul sau numele de utilizator, apoi același mesaj
 * neutru pentru orice date. Cu funcția oprită din ACP sau fără emailul configurat, pagina spune să contacteze echipa.
 * Un membru autentificat își schimbă parola din Setări → Cont.
 */
export default async function ForgotPasswordPage() {
  if ((await currentActor()).userId) redirect("/settings/account");
  const t = await getTranslations("auth.forgot");
  const { passwordReset } = services();
  const [availability, minutes] = await Promise.all([passwordReset.availability(), passwordReset.minutes()]);
  return (
    <GcsAuthCard title={t("title")} subtitle={t("subtitle")} icon={<GcsIcon name="fa-solid fa-key" />}>
      {availability === "available" ? <ForgotPasswordForm minutes={minutes} /> : <GcsPasswordResetUnavailable reason={availability} />}
    </GcsAuthCard>
  );
}
