import type { GcsThemeView } from "@gcs/core";
import { communityRules, RULES_HREF } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import { GcsAvatar, GcsButton } from "@gcs/ui";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { viewerEditing, viewerTheme } from "@/lib/appearance";
import { memberHref } from "@/lib/forum-urls";
import { withoutHrefs } from "@/lib/nav-match";
import { localeOptions } from "@/lib/locales";
import { pluginHost, safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";
import { GcsGuestPrefs, GcsHeaderScroll, GcsHeaderSearch, GcsMobileNav, GcsNavLinks, GcsUserMenu, type GcsNavEntry } from "./header/GcsNavClient";
import { GcsAuthLink } from "./GcsAuthModal";
import { GcsLiveCount, GcsNotificationBell } from "./notifications/GcsNotificationBell";

/**
 * Logo-ul temei: imaginile (varianta de bază + cele pentru modul luminos și ecranele mici, alese din CSS), altfel
 * marcajul cu inițiala, textul logo-ului (implicit numele site-ului) și sloganul. `data-gcs-logo-*` le folosește
 * previzualizarea editorului vizual, ca textul să se schimbe live.
 */
function GcsBrand({ theme, siteName }: { theme: GcsThemeView; siteName: string }) {
  const logo = theme.settings.logo;
  const base = theme.logoUrl ?? logo.imageLight ?? logo.imageMobile ?? logo.imageMobileLight;
  if (base) {
    const variants = [
      { url: logo.imageLight, cls: "gcs-brand__logo--light" },
      { url: logo.imageMobile, cls: "gcs-brand__logo--mobile" },
      { url: logo.imageMobileLight, cls: "gcs-brand__logo--mobileLight" },
    ].filter((v): v is { url: string; cls: string } => !!v.url && v.url !== base);
    return (
      <span
        className="gcs-brand__logos"
        data-testid="gcs-brand-logo"
        {...(logo.imageLight && logo.imageLight !== base ? { "data-light": "" } : {})}
        {...(logo.imageMobile && logo.imageMobile !== base ? { "data-mobile": "" } : {})}
        {...(logo.imageMobileLight && logo.imageMobileLight !== base ? { "data-mobile-light": "" } : {})}
      >
        {/* Logo-ul temei (încărcat din editor), în locul inițialei și al numelui. */}
        <img src={base} alt={logo.text || siteName} className="gcs-brand__logo gcs-brand__logo--base" />
        {variants.map((v) => (
          <img key={v.cls} src={v.url} alt="" aria-hidden="true" className={`gcs-brand__logo ${v.cls}`} />
        ))}
      </span>
    );
  }
  const text = logo.text || siteName;
  return (
    <>
      <span aria-hidden="true" className="gcs-brand__mark">
        <span>{text.trim().charAt(0).toUpperCase() || "G"}</span>
      </span>
      <span className="gcs-brand__text">
        <span className="gcs-brand__name gcs-display" data-gcs-logo-text="" data-site-name={siteName}>
          {text}
        </span>
        <span className="gcs-brand__slogan" data-gcs-logo-slogan="">
          {logo.slogan}
        </span>
      </span>
    </>
  );
}

/**
 * Header-ul site-ului (specul etapei 5): logo-ul temei sau numele site-ului, meniul principal configurabil (cu iconițe
 * și submeniuri), căutarea, clopoțelul, mesajele și meniul userului în dropdown; pe mobil, un sertar lateral.
 */
export async function GcsSiteHeader() {
  const [t, tn, tAll, locale] = await Promise.all([getTranslations("site"), getTranslations("notifications"), getTranslations(), getLocale()]);
  const { permissions, profileQueries, conversations, notifications, nav, settings } = services();
  const actor = await currentActor();
  const [siteName, siteLocale] = await Promise.all([settings.get<string>("site.name"), settings.get<string>("site.locale")]);
  const [tree, user, locales, { shown: theme }, editing] = await Promise.all([
    nav.tree(actor, locale, siteLocale),
    actor.userId ? profileQueries.userDisplays([actor.userId]).then((m) => m.get(actor.userId!) ?? null) : Promise.resolve(null),
    localeOptions(),
    viewerTheme(),
    viewerEditing(),
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
  // Intrările pluginurilor (etapa 6): în meniul principal și în meniul userului; nu în modul sigur.
  const pluginMenus = (await safeModeActive())
    ? { site: [], user: [] }
    : await pluginHost().then(async (host) => ({ site: await host.menus("site", actor, locale), user: user ? await host.menus("user", actor, locale) : [] }));
  // Ascunse automat: Reguli, cât timp regulile comunității sunt goale (pagina rămâne, cu o stare goală).
  const hidden = new Set((await communityRules(settings)) ? [] : [RULES_HREF]);
  const menu = [
    ...withoutHrefs(entries(tree), hidden),
    ...pluginMenus.site.map((m, i): GcsNavEntry => ({ id: -1000 - i, label: m.label, href: m.href, newTab: false, icon: <GcsIcon name={m.icon} />, children: [] })),
  ];

  return (
    <header className="gcs-siteHeader">
      <GcsHeaderScroll />
      <div className="gcs-siteHeader__inner">
        <GcsMobileNav
          items={menu}
          extra={
            user
              ? []
              : [
                  { href: "/login", label: t("login"), icon: <GcsIcon name="fa-solid fa-right-to-bracket" /> },
                  { href: "/register", label: t("register"), icon: <GcsIcon name="fa-solid fa-user-plus" /> },
                ]
          }
          labels={{ open: t("openMenu"), close: t("closeMenu"), menu: t("mainNav") }}
        />
        <Link href="/" aria-label={t("home")} className="gcs-brand" data-testid="gcs-brand">
          <GcsBrand theme={theme} siteName={siteName} />
        </Link>

        <GcsNavLinks items={menu} label={t("mainNav")} moreLabel={t("nav.more")} />

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
                    <GcsAvatar name={user.name} size="s" userId={user.id} {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
                    <span className={`gcs-userMenu__name gcs-name--${user.nameKey}`} data-testid="gcs-header-user" data-name-user={user.id}>
                      {user.name}
                    </span>
                    <GcsIcon name="fa-solid fa-chevron-down" className="gcs-navbar__caret" />
                  </>
                }
                links={{
                  profile: memberHref(user),
                  acp: canAcp,
                  moderation: canModerate,
                  themeEditor: editing.canTheme ? `/admin/theme-editor/${theme.key}` : null,
                  pageEditor: editing.canWidgets,
                }}
                extra={pluginMenus.user.map((m) => ({ key: m.key, label: m.label, href: m.href, icon: <GcsIcon name={m.icon} /> }))}
                labels={{
                  menu: t("userMenu"),
                  profile: t("myProfile"),
                  messages: t("messages"),
                  notifications: tn("title"),
                  settings: t("settings"),
                  acp: t("acp"),
                  themeEditor: t("themeEditor"),
                  pageEditor: t("pageEditor"),
                  moderation: t("moderation"),
                  logout: t("logout"),
                }}
              />
            </>
          ) : (
            <>
              <GcsGuestPrefs locales={locales} currentLocale={locale} labels={{ language: t("language") }} />
              <GcsButton variant="ghost" asChild className="gcs-siteHeader__auth" icon={<GcsIcon name="fa-solid fa-right-to-bracket" />}>
                <GcsAuthLink href="/login" data-testid="gcs-header-login">
                  {t("login")}
                </GcsAuthLink>
              </GcsButton>
              <GcsButton variant="primary" asChild className="gcs-siteHeader__auth" icon={<GcsIcon name="fa-solid fa-user-plus" />}>
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
