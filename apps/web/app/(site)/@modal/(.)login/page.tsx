import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsAuthModal } from "../../_components/GcsAuthModal";
import { LoginForm } from "../../login/LoginForm";

/** Login-ul în popup (specul etapei 5): `/login` deschis din site; deschis direct, rămâne pagina completă. */
export default async function LoginModal() {
  if ((await currentActor()).userId) return null;
  const [t, tc] = await Promise.all([getTranslations("auth.login"), getTranslations("site")]);
  const { settings } = services();
  const [siteName, discordClientId] = await Promise.all([settings.get<string>("site.name"), settings.get<string>("auth.discord_client_id")]);
  return (
    <GcsAuthModal title={t("title")} subtitle={t("subtitle", { site: siteName })} closeLabel={tc("closeMenu")} icon={<GcsIcon name="fa-solid fa-right-to-bracket" />}>
      <LoginForm discordEnabled={discordClientId !== ""} initialError={null} />
    </GcsAuthModal>
  );
}
