import { GcsIcon } from "@gcs/ui/icons";
import { GcsAvatar, GcsButton } from "@gcs/ui";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { themeMode } from "@/lib/appearance";
import { memberHref } from "@/lib/forum-urls";
import { localeOptions } from "@/lib/locales";
import { services } from "@/lib/services";
import { GcsGuestPrefs, GcsHeaderScroll, GcsHeaderSearch, GcsMobileNav, GcsNavLinks, GcsUserMenu, type GcsNavEntry } from "./header/GcsNavClient";
import { GcsAuthLink } from "./GcsAuthModal";
import { GcsLiveCount, GcsNotificationBell } from "./notifications/GcsNotificationBell";

/**
 * Header-ul site-ului (specul etapei 5): logo-ul temei sau numele site-ului, meniul principal configurabil (cu iconițe
 * și submeniuri), căutarea, clopoțelul, mesajele și meniul userului în dropdown; pe mobil, un sertar lateral.
 */
export async function GcsSiteHeader() {
  const [t, tn, tAll, locale] = await Promise.all([getTranslations("site"), getTranslations("notifications"), getTranslations(), getLocale()]);
  const { permissions, profileQueries, conversations, notifications, nav, settings } = services();
  const actor = await currentActor();
  const [siteName, siteLocale] = await Promise.all([settings.get<string>("site.name"), settings.get<string>("site.locale")]);
  const [tree, user, mode, locales] = await Promise.all([
    nav.tree(actor, locale, siteLocale),
    actor.userId ? profileQueries.userDisplays([actor.userId]).then((m) => m.get(actor.userId!) ?? null) : Promise.resolve(null),
    themeMode(),
    localeOptions(),
  ]);
  const [canAcp, canModerate, unread, unreadNotifications] = user
    ? await Promise.all([
        permissions.can(actor, "acp.access"),
        permissions.can(actor, "mod.access"),
        conversations.unreadCount(actor.userId),
        notifications.unreadCount(actor.userId),
      ])
    : [false, false, 0, 0];

  const label = (l: { key: string } | { text: string }) => ("key" in l ? (tAll.has(l.key) ? tAll(l.key) : l.key) : l.text);
  const entries = (items: typeof tree): GcsNavEntry[] =>
    items.map((i) => ({ id: i.id, label: label(i.label), href: i.href, newTab: i.newTab, icon: i.icon ? <GcsIcon name={i.icon} /> : null, children: entries(i.children) }));
  const menu = entries(tree);

  return (
    <header className="gcs-siteHeader">
      <GcsHeaderScroll />
      <div className="gcs-siteHeader__inner">
        <GcsMobileNav
          items={menu}
          extra={user ? [] : [{ href: "/login", label: t("login") }, { href: "/register", label: t("register") }]}
          labels={{ open: t("openMenu"), close: t("closeMenu"), menu: t("mainNav") }}
        />
        <Link href="/" aria-label={t("home")} className="gcs-brand">
          <span aria-hidden="true" className="gcs-brand__mark">
            <span>{siteName.trim().charAt(0).toUpperCase() || "G"}</span>
          </span>
          <span className="gcs-brand__name gcs-display">{siteName}</span>
        </Link>

        <GcsNavLinks items={menu} label={t("mainNav")} />

        <div className="gcs-siteHeader__tools">
          <GcsHeaderSearch label={t("searchLabel")} placeholder={t("searchPlaceholder")} />
          {user ? (
            <>
              <GcsNotificationBell
                initialUnread={unreadNotifications}
                labels={{ title: tn("title"), unread: tn.raw("unreadLabel") as string, empty: tn("empty"), markAll: tn("markAll"), seeAll: tn("seeAll") }}
              />
              <Link href="/messages" className="gcs-headerIcon" aria-label={t("messages")} data-testid="gcs-header-messages">
                <GcsIcon name="fa-solid fa-envelope" />
                <GcsLiveCount initial={unread} event="pm" testId="gcs-header-unread" />
              </Link>
              <GcsUserMenu
                trigger={
                  <>
                    <GcsAvatar name={user.name} size="s" {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
                    <span className={`gcs-userMenu__name gcs-name--${user.nameKey}`} data-testid="gcs-header-user">
                      {user.name}
                    </span>
                    <GcsIcon name="fa-solid fa-chevron-down" className="gcs-navbar__caret" />
                  </>
                }
                links={{ profile: memberHref(user), acp: canAcp, moderation: canModerate }}
                labels={{
                  menu: t("userMenu"),
                  profile: t("myProfile"),
                  messages: t("messages"),
                  notifications: tn("title"),
                  settings: t("settings"),
                  acp: t("acp"),
                  moderation: t("moderation"),
                  theme: t("theme"),
                  themes: { dark: t("themes.dark"), light: t("themes.light"), auto: t("themes.auto") },
                  language: t("language"),
                  logout: t("logout"),
                }}
                locales={locales}
                currentTheme={mode}
                currentLocale={locale}
              />
            </>
          ) : (
            <>
              <GcsGuestPrefs locales={locales} currentLocale={locale} labels={{ language: t("language") }} />
              <GcsButton variant="ghost" asChild className="gcs-siteHeader__auth">
                <GcsAuthLink href="/login" data-testid="gcs-header-login">
                  {t("login")}
                </GcsAuthLink>
              </GcsButton>
              <GcsButton variant="primary" asChild className="gcs-siteHeader__auth">
                <GcsAuthLink href="/register" data-testid="gcs-header-register">
                  {t("register")}
                </GcsAuthLink>
              </GcsButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
