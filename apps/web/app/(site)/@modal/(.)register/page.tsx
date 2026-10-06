import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsAuthModal } from "../../_components/GcsAuthModal";
import { RegisterForm } from "../../register/RegisterForm";

/** Înregistrarea în popup (specul etapei 5): `/register` deschis din site; deschis direct, rămâne pagina completă. */
export default async function RegisterModal() {
  if ((await currentActor()).userId) return null;
  const [t, tc] = await Promise.all([getTranslations("auth.register"), getTranslations("site")]);
  const { settings } = services();
  const [siteName, turnstileSiteKey, turnstileSecret] = await Promise.all([
    settings.get<string>("site.name"),
    settings.get<string>("auth.turnstile_site_key"),
    settings.get<string>("auth.turnstile_secret"),
  ]);
  return (
    <GcsAuthModal title={t("title")} subtitle={t("subtitle", { site: siteName })} closeLabel={tc("closeMenu")} icon={<GcsIcon name="fa-solid fa-user-plus" />}>
      <RegisterForm turnstileSiteKey={turnstileSiteKey && turnstileSecret ? turnstileSiteKey : null} />
    </GcsAuthModal>
  );
}
