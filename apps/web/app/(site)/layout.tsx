import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { GcsHoverCardHost } from "./_components/GcsHoverCardHost";
import { GcsSiteFooter } from "./_components/GcsSiteFooter";
import { GcsSiteHeader } from "./_components/GcsSiteHeader";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [t, locale] = await Promise.all([getTranslations("hoverCard"), getLocale()]);
  return (
    <>
      <GcsSiteHeader />
      <main style={{ maxWidth: 1320, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        {children}
      </main>
      <GcsSiteFooter />
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
    </>
  );
}
