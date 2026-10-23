import { sanitizeContentHtml, splitNavItems, type GcsActor, type GcsThemeView } from "@gcs/core";
import { POLL_INTERVAL_SETTING, type GcsUserDisplay } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import { headers } from "next/headers";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { accountMenuData } from "@/lib/account-menu.server";
import { themeMode, viewerThemeToggle } from "@/lib/appearance";
import { footerSocials } from "@/lib/footer";
import { guessDevice } from "@/lib/header-device";
import { liveBadge, megaFooter, pickPlayNow, type GcsLiveSummary } from "@/lib/live-summary";
import { liveSummary, visibleServers } from "@/lib/live-summary.server";
import { localeOptions } from "@/lib/locales";
import { services } from "@/lib/services";
import { GcsAuthLink } from "../GcsAuthModal";
import { GcsNotificationBell } from "../notifications/GcsNotificationBell";
import { notificationIcons } from "../notifications/notification-icons";
import { GcsAccountMenu } from "./GcsAccountMenu";
import { GcsCreateMenu } from "./GcsCreateMenu";
import { GcsHeaderFrame } from "./GcsHeaderFrame";
import { GcsDesktopOnly, GcsMobileBar, GcsNavElement, GcsServersLiveSummary, GcsThemeToggle } from "./GcsHeaderBits";
import { GcsMegaNav, type GcsMegaEntry } from "./GcsMegaNav";
import { GcsMessagesMenu } from "./GcsMessagesMenu";
import { GcsCrumbTrail, GcsGuestPrefs, GcsMobileNav, type GcsNavEntry } from "./GcsNavClient";
import { GcsSearchPanel } from "./GcsSearchPanel";

/** Un item al meniului, cu descrierea și insigna (pentru mega meniuri), gata tradus. */
export type GcsHeaderNavItem = GcsNavEntry & { description: string | null; badge: string | null; iconName: string | null; children: GcsHeaderNavItem[] };

/** Iconițele folosite de meniurile clientului („Creează”, contul), randate aici o singură dată. */
const MENU_ICONS = [
  "fa-solid fa-pen-to-square",
  "fa-solid fa-envelope",
  "fa-solid fa-people-group",
  "fa-solid fa-ticket",
  "fa-solid fa-gavel",
  "fa-solid fa-comments",
  "fa-solid fa-plus",
  "fa-solid fa-user",
  "fa-solid fa-file-lines",
  "fa-solid fa-paperclip",
  "fa-solid fa-eye",
  "fa-solid fa-crosshairs",
  "fa-solid fa-link",
  "fa-solid fa-gear",
  "fa-solid fa-bell",
  "fa-solid fa-lock",
  "fa-solid fa-paintbrush",
  "fa-solid fa-shield-halved",
  "fa-solid fa-palette",
  "fa-solid fa-table-columns",
  "fa-solid fa-screwdriver-wrench",
];

type Props = {
  actor: GcsActor;
  theme: GcsThemeView;
  siteName: string;
  brand: ReactNode;
  menu: GcsHeaderNavItem[];
  landing: string | undefined;
  user: GcsUserDisplay | null;
  counts: { messages: number; notifications: number };
  staff: { themeEditor: string | null; pageEditor: boolean };
  /** Intrările pluginurilor în meniul contului (`menus("user")`). */
  userExtra?: { key: string; label: string; href: string; icon: ReactNode }[];
};

/**
 * Antetul construit (antetul sistemului, în orice temă; constructorul de antet, specul 2026-10-10-hero-cockpit §1–3, §9): aici se randează
 * o singură dată fiecare element (logo, meniul cu mega meniuri, căutarea, „Creează”, mesajele, notificările, contul,
 * breadcrumb-ul, statusul serverelor, rețelele sociale, tema, limba, textul propriu și elementele aplicațiilor), iar
 * `GcsHeaderFrame` le așază după aspectul temei pentru dispozitivul curent.
 */
export async function GcsHeaderBuilder({ actor, theme, siteName, brand, menu, landing, user, counts, staff, userExtra = [] }: Props) {
  const s = theme.settings;
  const [t, th, locale, h, locales, mode, socials, servers, toggle] = await Promise.all([
    getTranslations("site"),
    getTranslations("header"),
    getLocale(),
    headers(),
    localeOptions(),
    themeMode(),
    footerSocials(),
    visibleServers(actor),
    viewerThemeToggle(),
  ]);
  const { apps, settings } = services();
  const usable = await apps.accessFilter(actor);
  const [summary, account, poll] = await Promise.all([
    liveSummary(actor, servers),
    user ? accountMenuData(actor, staff) : Promise.resolve(null),
    settings.get<number>(POLL_INTERVAL_SETTING).catch(() => 30),
  ]);
  const icons = Object.fromEntries(MENU_ICONS.map((n) => [n, <GcsIcon key={n} name={n} />]));

  // Meniul: descrierile, insignele (fixe și live) și rândul de jos al mega meniurilor.
  const play = pickPlayNow(servers.map((v) => ({ id: v.id, name: v.name, connectHref: v.connectHref, online: !!v.status?.online, players: v.status?.players ?? 0, maxPlayers: v.status?.maxPlayers ?? 0 })));
  const entries = megaEntries(menu, summary, th, play?.connectHref ?? "/servers");
  const desktop = s.header.layout.desktop;
  const split = [desktop.top, desktop.main, desktop.bottom].some((r) => [...r.left, ...r.center, ...r.right].includes("navRight"));
  const halves = split ? splitNavItems(entries, s.header.layout.split) : { left: entries, right: [] };
  const navLabels = { label: t("mainNav"), moreLabel: t("nav.more"), home: landing };

  const parts: Record<string, ReactNode> = {
    logo: (
      <Link href="/" aria-label={t("home")} className="gcs-brand gcs-hb__logo" data-testid="gcs-brand">
        {brand}
      </Link>
    ),
    nav: (
      <GcsNavElement
        bar={<GcsMegaNav items={halves.left} {...navLabels} testId="gcs-hb-nav" />}
        drawer={
          <GcsMobileNav
            items={menu}
            home={landing}
            extra={user ? [] : [
              { href: "/login", label: t("login"), icon: <GcsIcon name="fa-solid fa-right-to-bracket" /> },
              { href: "/register", label: t("register"), icon: <GcsIcon name="fa-solid fa-user-plus" /> },
            ]}
            labels={{ open: t("openMenu"), close: t("closeMenu"), menu: t("mainNav") }}
          />
        }
      />
    ),
    navRight: halves.right.length > 0 ? (
      <GcsDesktopOnly>
        <GcsMegaNav items={halves.right} {...navLabels} testId="gcs-hb-nav-right" />
      </GcsDesktopOnly>
    ) : null,
    search: <GcsSearchPanel variant="icon" />,
    searchField: <GcsSearchPanel variant="field" />,
    breadcrumb: <GcsCrumbTrail items={menu} home={landing} labels={{ home: t("home"), trail: t("crumbs") }} />,
    themeToggle: <GcsThemeToggle toggle={toggle} mode={s.scheme.toggle ? mode : null} />,
    language: <GcsGuestPrefs locales={locales} currentLocale={locale} labels={{ language: t("language") }} />,
  };
  if (user && account) {
    parts.create = <GcsCreateMenu icons={icons} />;
    parts.messages = <GcsMessagesMenu initialUnread={counts.messages} />;
    parts.notifications = <GcsNotificationBell initialUnread={counts.notifications} icons={await notificationIcons()} />;
    parts.account = (
      <GcsAccountMenu
        data={account}
        icons={icons}
        mode={mode}
        locales={locales}
        locale={locale}
        compactTrigger={s.header.layout.preset === "esports"}
        toggle={toggle}
        modeSwitch={s.scheme.toggle}
        extra={userExtra}
      />
    );
  } else {
    parts.account = (
      <span className="gcs-hb__auth">
        <GcsAuthLink href="/register" className="gcs-hb__authLink" data-testid="gcs-header-register">
          <GcsIcon name="fa-solid fa-pen" />
          <span className="gcs-hb__authText">{t("register")}</span>
        </GcsAuthLink>
        <span className="gcs-hb__authOr">{th("or")}</span>
        <GcsAuthLink href="/login" className="gcs-hb__authLink" data-testid="gcs-header-login">
          <GcsIcon name="fa-solid fa-right-to-bracket" />
          <span className="gcs-hb__authText">{t("login")}</span>
        </GcsAuthLink>
      </span>
    );
  }
  if (summary.servers.enabled) parts.serversLive = <GcsServersLiveSummary statuses={Object.fromEntries(servers.map((v) => [v.id, v.status]))} pollSeconds={poll} matches={summary.liveMatches} />;
  if (socials.length > 0) {
    parts.social = (
      <span className="gcs-hb__social">
        <span className="gcs-hb__small">{th("social.follow")}</span>
        {socials.map((n) => (
          <a key={n.key} href={n.href} className="gcs-hb__sq gcs-hb__sq--social" target="_blank" rel="noopener noreferrer" aria-label={n.label} title={n.label} data-network={n.key}>
            <GcsIcon name={n.icon} />
          </a>
        ))}
      </span>
    );
  }
  // Textul / HTML-ul propriu al temei (doar adminii cu drept pe teme îl scriu), trecut prin sanitizer-ul conținutului
  // (lista albă de etichete și atribute, fără scripturi, stiluri sau evenimente).
  const customHtml = s.header.customHtml.trim() ? sanitizeContentHtml(s.header.customHtml) : "";
  if (customHtml) parts.custom = <div className="gcs-hb__custom" dangerouslySetInnerHTML={{ __html: customHtml }} />;
  // Elementele aplicațiilor: chat-ul (iconiță) și „Joacă acum” (Servere).
  if (usable("chat")) {
    parts["chat.button"] = (
      <Link href="/chat" className="gcs-hb__sq" aria-label={th("chat")} data-testid="gcs-header-chat">
        <GcsIcon name="fa-solid fa-comment-dots" />
      </Link>
    );
  }
  if (summary.servers.enabled) {
    parts["servers.playNow"] = (
      <a href={play?.connectHref ?? "/servers"} className="gcs-btn gcs-btn--primary gcs-btn--sm" data-testid="gcs-header-play">
        <GcsIcon name="fa-solid fa-play" />
        {th("playNow")}
      </a>
    );
  }

  const layout = s.header.layout;
  return (
    <GcsHeaderFrame
      parts={parts}
      layout={layout}
      initialDevice={guessDevice(h.get("user-agent"), h.get("sec-ch-ua-mobile"))}
      options={{
        rowTop: s.header.rowTop,
        rowMain: s.header.rowMain,
        rowBottom: s.header.rowBottom,
        sticky: s.header.sticky,
        compact: s.header.compact,
        hideOnScroll: s.header.hideOnScroll,
        dropdowns: s.header.dropdowns,
        mega: s.header.mega,
        navAlign: s.header.navAlign,
        placement: s.mobileNav.placement,
      }}
      mobileBar={
        <GcsMobileBar
          items={s.mobileNav.items}
          labels={s.mobileNav.labels}
          forumHref={landing ? "/forum" : "/"}
          accountHref={account?.user.href ?? null}
          unread={counts}
          member={!!user}
        />
      }
    />
  );
}

type Th = Awaited<ReturnType<typeof getTranslations<"header">>>;

/** Itemii meniului pentru mega meniuri: insigna live (după adresă) sau cea fixă, rândul de jos (după copii). */
function megaEntries(menu: GcsHeaderNavItem[], summary: GcsLiveSummary, th: Th, playHref: string): GcsMegaEntry[] {
  const badgeOf = (i: GcsHeaderNavItem): GcsMegaEntry["badge"] => {
    const live = liveBadge(i.href, summary);
    if (live) return { text: th(`nav.badges.${live.kind}`, { count: live.count }), tone: live.kind === "live" ? "live" : "soft" };
    return i.badge ? { text: i.badge, tone: "new" } : null;
  };
  const child = (i: GcsHeaderNavItem): GcsMegaEntry => ({ ...i, badge: badgeOf(i), footer: null, children: [] });
  return menu.map((i) => {
    const footer = i.children.length > 0 ? megaFooter(i.children, summary) : null;
    return {
      ...i,
      badge: badgeOf(i),
      children: i.children.map(child),
      footer: !footer
        ? null
        : footer.kind === "servers"
          ? { line: th("nav.footer.servers", { servers: footer.servers, players: footer.players }), cta: { label: th("playNow"), href: playHref } }
          : footer.kind === "community"
            ? { line: th("nav.footer.community", { members: footer.members, online: footer.online }), cta: { label: th("nav.cta.online"), href: footer.cta.href } }
            : { line: th("nav.footer.vip"), cta: { label: th("nav.cta.vip"), href: footer.cta.href } },
    };
  });
}
