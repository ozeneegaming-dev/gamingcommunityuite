import { STEAM_PLACEHOLDER_DOMAIN } from "@gcs/modules";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { GcsDesignSync } from "./_components/GcsDesignSync";
import { GcsCockpitSlot } from "./_components/cockpit/GcsCockpitSlot";
import { GcsNavProgress } from "./_components/GcsNavProgress";
import { GcsHoverCardHost } from "./_components/GcsHoverCardHost";
import { GcsImageViewerHost } from "./_components/GcsImageViewerHost";
import { GcsSiteFooter } from "./_components/GcsSiteFooter";
import { GcsSiteHeader } from "./_components/GcsSiteHeader";
import { GcsAnnouncementBar } from "./_components/GcsAnnouncementBar";
import { GcsScrollRail } from "./_components/GcsScrollRail";
import { GcsWhereBeacon } from "./_components/GcsWhereBeacon";
import { passwordResetGate } from "@/lib/password-reset-gate";
import { registerNavHooks } from "@/lib/nav-preview.server";
import { GcsNavHighlights } from "./_components/GcsNavHighlights";
import { GcsNotificationToasts } from "./_components/notifications/GcsNotificationToasts";
import { GcsRealtimeProvider } from "./_components/realtime/GcsRealtimeProvider";
import { currentActor } from "@/lib/actor";
import { alertPrefs, viewerTheme } from "@/lib/appearance";
import { announcementView } from "@/lib/announcement";
import { safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";
import { designClass } from "@/lib/theme-preview";
import { themeHtmlAttrs } from "@gcs/core/themes";

export default async function SiteLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  const [t, locale, actor] = await Promise.all([getTranslations("hoverCard"), getLocale(), currentActor()]);
  // Membri v2: resetarea parolei cerută de staff trimite membrul la Setări → Cont până o schimbă.
  await passwordResetGate(actor.userId);
  // Manager meniu v2: previzualizarea ciornei și contoarele insignelor, legate de serviciul meniului înaintea antetului.
  registerNavHooks();
  // Conturile create prin Steam au un email placeholder: le cerem unul real (specul etapei 3, §8).
  const email = actor.userId ? (await services().db.user.findUnique({ where: { id: actor.userId }, select: { email: true } }))?.email : null;
  const [tb, alerts, tc, tp, safeMode, { preview, shown }, deletion, format, tv, announcements] = await Promise.all([
    getTranslations("settings.account"),
    alertPrefs(actor.userId),
    getTranslations("site"),
    getTranslations("plugins.safeMode"),
    safeModeActive(),
    viewerTheme(),
    // Cererea „Șterge contul meu” în perioada de răzgândire: banda de pe tot site-ul, cu link spre anulare.
    actor.userId ? services().memberRemoval.pendingFor(actor.userId) : null,
    getFormatter(),
    getTranslations("imageViewer"),
    // Bara de anunț (ACP → Aspect → Conținut): barele acestui membru / vizitator, fără cele închise.
    announcementView(actor),
  ]);
  const viewerLabels = Object.fromEntries(
    (["dialog", "close", "prev", "next", "zoomIn", "zoomOut", "original", "download", "thumbnails", "counter", "by", "source", "enlarge"] as const).map((k) => [k, tv.raw(k) as string]),
  ) as Parameters<typeof GcsImageViewerHost>[0]["labels"];
  return (
    <GcsRealtimeProvider>
      {/* Clasa designului temei pe `<html>` (pusă și de layout-ul rădăcină; aici, după navigarea din ACP). */}
      <GcsDesignSync design={designClass(shown.settings.preset)} attrs={themeHtmlAttrs(shown.settings)} />
      {/* `useSearchParams` cere un Suspense: bara nu blochează randarea paginii. */}
      <Suspense fallback={null}>
        <GcsNavProgress />
      </Suspense>
      <GcsSiteHeader />
      <GcsNavHighlights actor={actor} locale={locale} />
      {/* Consola Hero Cockpit (designul Nova, pornită din temă): sub antet, pe pagina principală sau pe toate. */}
      <Suspense fallback={null}>
        <GcsCockpitSlot />
      </Suspense>
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
        {announcements.bars.length > 0 && (
          <GcsAnnouncementBar
            bars={announcements.bars}
            rotateSeconds={announcements.rotateSeconds}
            viewerKey={announcements.viewerKey}
            labels={{ region: tc("announcementBar.region"), dismiss: tc("announcementBar.dismiss"), show: tc.raw("announcementBar.show") as string }}
          />
        )}
        {children}
      </main>
      {/* Banda „Sus / Jos” din stânga (setarea temei o poate ascunde). */}
      <GcsScrollRail
        labels={{ group: tc("scrollRail.group"), up: tc("scrollRail.up"), upHint: tc("scrollRail.upHint"), down: tc("scrollRail.down"), downHint: tc("scrollRail.downHint") }}
      />
      <GcsSiteFooter />
      {/* Membri v2: pagina curentă pentru /online (cine e unde). */}
      {!preview && <GcsWhereBeacon />}
      {modal}
      {/* În previzualizarea editoarelor (iframe) nu apar notificările adminului. */}
      {actor.userId && !preview && <GcsNotificationToasts toasts={alerts.toasts} sound={alerts.sound} closeLabel={tc("closeToast")} />}
      {/* Vizualizatorul de imagini (postări, chat, profil, clanuri, dovezi): o singură instanță pe site. */}
      <GcsImageViewerHost labels={viewerLabels} locale={locale} />
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
          group: { members: t("group.members"), online: t("group.online"), seeAll: t("group.seeAll"), empty: t("group.empty") },
        }}
      />
    </GcsRealtimeProvider>
  );
}
