import { pluginRegistryKey, type GcsThemeView } from "@gcs/core";
import { communityRules, RULES_HREF } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import { getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { viewerEditing, viewerTheme } from "@/lib/appearance";
import { FORUM_INDEX_ALT_HREF, FORUM_NAV_LABEL } from "@/lib/landing";
import { withoutHrefs } from "@/lib/nav-match";
import { pluginHost, safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";
import { GcsHeaderBuilder, type GcsHeaderNavItem } from "./header/GcsHeaderBuilder";

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
 * Header-ul site-ului (specul etapei 5; din 2026-10-16 constructorul de antet, același în orice temă): logo-ul temei sau
 * numele site-ului, meniul principal configurabil (iconițe, submeniuri, mega meniuri), căutarea, notificările, mesajele,
 * meniul contului (cu intrările pluginurilor) și, pe mobil, sertarul și bara de jos.
 */
export async function GcsSiteHeader() {
  const [tAll, locale] = await Promise.all([getTranslations(), getLocale()]);
  const { profileQueries, conversations, notifications, nav, settings, apps } = services();
  const actor = await currentActor();
  // Aplicația de pornire (specul 2026-10-09-acp-navigatie-aplicatii §2.3): pe `/` itemul ei e activ, iar Forumul are
  // adresa lui alternativă, `/forum`.
  const landing = await apps.landingFor(actor);
  const [siteName, siteLocale] = await Promise.all([settings.get<string>("site.name"), settings.get<string>("site.locale")]);
  const [tree, user, { shown: theme }, editing] = await Promise.all([
    nav.tree(actor, locale, siteLocale),
    actor.userId ? profileQueries.userDisplays([actor.userId]).then((m) => m.get(actor.userId!) ?? null) : Promise.resolve(null),
    viewerTheme(),
    viewerEditing(),
  ]);
  const [unread, unreadNotifications] = user ? await Promise.all([conversations.unreadCount(actor.userId), notifications.unreadCount(actor.userId)]) : [0, 0];

  const label = (l: { key: string } | { text: string }) => ("key" in l ? (tAll.has(l.key) ? tAll(l.key) : l.key) : l.text);
  const href = (i: (typeof tree)[number]) => (landing && i.href === "/" && "key" in i.label && i.label.key === FORUM_NAV_LABEL ? FORUM_INDEX_ALT_HREF : i.href);
  // Descrierea (mega meniurile): textul adminului sau cheia implicită, doar dacă are traducere.
  const description = (d: (typeof tree)[number]["description"]) => (!d ? null : "text" in d ? d.text : tAll.has(d.key) ? tAll(d.key) : null);
  const entries = (items: typeof tree): GcsHeaderNavItem[] =>
    items.map((i) => ({
      id: i.id,
      label: label(i.label),
      href: href(i),
      newTab: i.newTab,
      icon: i.icon ? <GcsIcon name={i.icon} /> : null,
      iconName: i.icon,
      description: description(i.description),
      badge: i.badge,
      children: entries(i.children),
    }));
  // Intrările pluginurilor (etapa 6): în meniul principal și în meniul userului; nu în modul sigur.
// Doar ale pluginurilor accesibile viewer-ului (accesul pe grup din ACP → Aplicații; cheia intrării: `<plugin>.<intrare>`).
  const usable = await apps.accessFilter(actor);
  const ownPlugin = (m: { key: string }) => usable(pluginRegistryKey(m.key.split(".").slice(0, 2).join(".")));
  const pluginMenus = (await safeModeActive())
    ? { site: [], user: [] }
    : await pluginHost().then(async (host) => ({
        site: (await host.menus("site", actor, locale)).filter(ownPlugin),
        user: user ? (await host.menus("user", actor, locale)).filter(ownPlugin) : [],
      }));
  // Ascunse automat: Reguli, cât timp regulile comunității sunt goale (pagina rămâne, cu o stare goală).
  const hidden = new Set((await communityRules(settings)) ? [] : [RULES_HREF]);
  const menu: GcsHeaderNavItem[] = [
    ...withoutHrefs(entries(tree), hidden),
    ...pluginMenus.site.map((m, i): GcsHeaderNavItem => ({ id: -1000 - i, label: m.label, href: m.href, newTab: false, icon: <GcsIcon name={m.icon} />, iconName: m.icon, description: null, badge: null, children: [] })),
  ];

  // Antetul SISTEMULUI, în orice temă (Clasic, GCS Dark / White, pachetele importate): constructorul de antet, în
  // aspectul ales în temă (implicit „Clasic” pe designul clasic). Tema schimbă doar aspectul, nu și funcțiile.
  return (
    <GcsHeaderBuilder
      actor={actor}
      theme={theme}
      siteName={siteName}
      brand={<GcsBrand theme={theme} siteName={siteName} />}
      menu={menu}
      landing={landing?.href}
      user={user}
      counts={{ messages: unread, notifications: unreadNotifications }}
      staff={{ themeEditor: editing.canTheme ? `/admin/theme-editor/${theme.key}` : null, pageEditor: editing.canWidgets }}
      userExtra={pluginMenus.user.map((m) => ({ key: m.key, label: m.label, href: m.href, icon: <GcsIcon name={m.icon} /> }))}
    />
  );
}
