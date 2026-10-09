import { STEAM_PLACEHOLDER_DOMAIN } from "@gcs/modules";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { GcsNavProgress } from "./_components/GcsNavProgress";
import { GcsHoverCardHost } from "./_components/GcsHoverCardHost";
import { GcsSiteFooter } from "./_components/GcsSiteFooter";
import { GcsSiteHeader } from "./_components/GcsSiteHeader";
import { GcsNotificationToasts } from "./_components/notifications/GcsNotificationToasts";
import { GcsRealtimeProvider } from "./_components/realtime/GcsRealtimeProvider";
import { currentActor } from "@/lib/actor";
import { alertPrefs, viewerTheme } from "@/lib/appearance";
import { safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";

export default async function SiteLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  const [t, locale, actor] = await Promise.all([getTranslations("hoverCard"), getLocale(), currentActor()]);
  // Conturile create prin Steam au un email placeholder: le cerem unul real (specul etapei 3, §8).
  const email = actor.userId ? (await services().db.user.findUnique({ where: { id: actor.userId }, select: { email: true } }))?.email : null;
  const [tb, alerts, tc, tp, safeMode, { preview }, deletion, format] = await Promise.all([
    getTranslations("settings.account"),
    alertPrefs(actor.userId),
    getTranslations("site"),
    getTranslations("plugins.safeMode"),
    safeModeActive(),
    viewerTheme(),
    // Cererea „Șterge contul meu” în perioada de răzgândire: banda de pe tot site-ul, cu link spre anulare.
    actor.userId ? services().memberRemoval.pendingFor(actor.userId) : null,
    getFormatter(),
  ]);
  return (
    <GcsRealtimeProvider>
      {/* `useSearchParams` cere un Suspense: bara nu blochează randarea paginii. */}
      <Suspense fallback={null}>
        <GcsNavProgress />
      </Suspense>
      <GcsSiteHeader />
      <main className="gcs-siteMain" style={{ maxWidth: "var(--gcs-page-width, 1320px)", margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        {email?.endsWith(STEAM_PLACEHOLDER_DOMAIN) && (
          <p role="status" className="gcs-notice gcs-notice--warn" data-testid="gcs-steam-email-banner">
            {tb("steamBanner")} <Link href="/settings/account">{tb("steamBannerLink")}</Link>
          </p>
        )}
        {deletion?.runAfter && (
          <p role="status" className="gcs-notice gcs-notice--error" data-testid="gcs-deletion-banner">
            {tb("delete.banner", { date: format.dateTime(deletion.runAfter, { dateStyle: "long", timeStyle: "short" }) })}{" "}
            <Link href="/settings/account#gcs-delete-account">{tb("delete.bannerLink")}</Link>
          </p>
        )}
        {safeMode && (
          // Modul sigur (etapa 6): doar Root Admin, site-ul fără pluginuri pentru el.
          <p role="status" className="gcs-notice gcs-notice--warn" data-testid="gcs-safe-mode-banner">
            {tp("banner")} <a href="?safe=0">{tp("exit")}</a>
          </p>
        )}
        {children}
      </main>
      <GcsSiteFooter />
      {modal}
      {/* În previzualizarea editoarelor (iframe) nu apar notificările adminului. */}
      {actor.userId && !preview && <GcsNotificationToasts toasts={alerts.toasts} sound={alerts.sound} closeLabel={tc("closeToast")} />}
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
          weapon: t("weapon"),
        }}
      />
    </GcsRealtimeProvider>
  );
}
