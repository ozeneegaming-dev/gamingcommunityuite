import { STEAM_PLACEHOLDER_DOMAIN } from "@gcs/modules";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { GcsHoverCardHost } from "./_components/GcsHoverCardHost";
import { GcsSiteFooter } from "./_components/GcsSiteFooter";
import { GcsSiteHeader } from "./_components/GcsSiteHeader";
import { GcsRealtimeProvider } from "./_components/realtime/GcsRealtimeProvider";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export default async function SiteLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  const [t, locale, actor] = await Promise.all([getTranslations("hoverCard"), getLocale(), currentActor()]);
  // Conturile create prin Steam au un email placeholder: le cerem unul real (specul etapei 3, §8).
  const email = actor.userId ? (await services().db.user.findUnique({ where: { id: actor.userId }, select: { email: true } }))?.email : null;
  const tb = await getTranslations("settings.account");
  return (
    <GcsRealtimeProvider>
      <GcsSiteHeader />
      <main style={{ maxWidth: 1320, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        {email?.endsWith(STEAM_PLACEHOLDER_DOMAIN) && (
          <p role="status" className="gcs-notice gcs-notice--warn" data-testid="gcs-steam-email-banner">
            {tb("steamBanner")} <Link href="/settings/account">{tb("steamBannerLink")}</Link>
          </p>
        )}
        {children}
      </main>
      <GcsSiteFooter />
      {modal}
      <GcsHoverCardHost
        locale={locale}
        labels={{
          posts: t("posts"),
          reputation: t("reputation"),
          followers: t("followers"),
          online: t("online"),
          joined: t("joined"),
          follow: t("follow"),
          unfollow: t("unfollow"),
          message: t("message"),
        }}
      />
    </GcsRealtimeProvider>
  );
}
