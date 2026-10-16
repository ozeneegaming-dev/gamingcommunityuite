import { ACP_DASHBOARD_HREF, acpAreas, type GcsAcpMenuSection } from "@gcs/core";
import { GcsAvatar } from "@gcs/ui";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { GcsNotificationBell } from "@/app/(site)/_components/notifications/GcsNotificationBell";
import { notificationIcons } from "@/app/(site)/_components/notifications/notification-icons";
import { requireAcpPanel } from "@/lib/acp";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsAcpAccountMenu } from "./_components/GcsAcpAccountMenu";
import { GcsAcpSearch } from "./_components/GcsAcpSearch";
import { GcsAcpShell } from "./_components/GcsAcpShell";
import { GcsPluginNotice } from "./_components/GcsPluginNotice";
import { ACP_AREA_COOKIE, ACP_COLUMN_COOKIE } from "./_components/acp-nav";
import { ACP_THEME_COOKIE, ACP_THEMES, type GcsAcpTheme } from "./_components/acp-theme";
import { GcsAcpThemeSwitch } from "./_components/GcsAcpThemeSwitch";
import type { GcsAcpIconDef, GcsAcpNavArea, GcsAcpNavItem } from "./_components/types";
import { GcsMemberLink } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acp");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/** Iconița unei intrări din meniu, rezolvată aici: la client ajung doar datele SVG ale iconițelor folosite. */
function navIcon(name: string | undefined): { icon?: GcsAcpIconDef } {
  const def = resolveIcon(name);
  return def ? { icon: { prefix: def.prefix, iconName: def.iconName, icon: def.icon } } : {};
}

/**
 * Zonele navigației (specul 2026-10-09-acp-navigatie-aplicatii §1.2), traduse. Drepturile sunt deja aplicate:
 * `panel.menu` conține doar ce vede adminul, iar zonele rămase fără pagini lipsesc.
 */
function buildAreas(menu: GcsAcpMenuSection[], tr: (key: string) => string): GcsAcpNavArea[] {
  return acpAreas(menu).map((area) => ({
    key: area.key,
    label: tr(`acp.areas.${area.key}`),
    groups: area.groups.map((g) => ({
      title: tr(g.title),
      items: g.items.map((i) => ({ key: i.key, href: i.href, label: tr(i.labelKey), ...navIcon(i.icon), ...(i.alias ? { alias: true } : {}) })),
    })),
  }));
}

/** Layout-ul ACP (etapa 6 §1.1). Garda de acces rulează înaintea oricărei randări: fără acces → 404. */
export default async function AcpPanelLayout({ children }: { children: ReactNode }) {
  const panel = await requireAcpPanel();
  const t = await getTranslations();
  const tr = (key: string) => (t.has(key) ? t(key) : key);
  const { settings, acp, notifications } = services();
  const [siteName, roles, unread] = await Promise.all([
    settings.get<string>("site.name"),
    acp.roleNames(panel.actor),
    notifications.unreadCount(panel.user.id).catch(() => 0),
  ]);

  const areas = buildAreas(panel.menu, tr);
  const dashboardItem = panel.menu.flatMap((s) => s.items).find((i) => i.href === ACP_DASHBOARD_HREF);
  const dashboard: GcsAcpNavItem | null = dashboardItem
    ? { key: dashboardItem.key, href: dashboardItem.href, label: tr(dashboardItem.labelKey), ...navIcon(dashboardItem.icon) }
    : null;

  const jar = await cookies();
  const themeCookie = jar.get(ACP_THEME_COOKIE)?.value as GcsAcpTheme | undefined;
  const theme: GcsAcpTheme = themeCookie && ACP_THEMES.includes(themeCookie) ? themeCookie : "dark";
  const user = panel.user;
  const avatar = (size: "s" | "m") => <GcsAvatar name={user.name} size={size} {...(user.image ? { src: user.image } : {})} />;
  const role = roles.length > 0 ? roles.join(", ") : user.primaryGroup.name;

  const brand = (
    <Link href={ACP_DASHBOARD_HREF} aria-label={t("acp.home", { site: siteName })} className="gcs-acpRail__logo">
      <span aria-hidden="true" className="gcs-acpRail__logoMark">
        {siteName.trim().charAt(0).toUpperCase() || "G"}
      </span>
    </Link>
  );

  const adminCard = (
    <div className="gcs-acpAdmin" data-testid="gcs-acp-admin-card">
      <span className="gcs-acpAdmin__avatar">{avatar("s")}</span>
      <span className="gcs-acpAdmin__who">
        <GcsMemberLink user={user} href={null} className="gcs-acpAdmin__name" data-testid="gcs-acp-user" />
        <span className="gcs-acpAdmin__role">{role}</span>
      </span>
      <span className="gcs-acpAdmin__twofa" title={t("acp.header.twoFactorOn")}>
        <GcsIcon name="fa-solid fa-shield-halved" />
        <span className="gcs-srOnly">{t("acp.header.twoFactorOn")}</span>
      </span>
    </div>
  );

  const topbar = (
    <>
      <GcsAcpSearch
        labels={{
          search: t("acp.header.search"),
          placeholder: t("acp.header.searchPlaceholder"),
          noResults: t("acp.header.noResults"),
          groups: {
            settings: t("acp.header.resultGroups.settings"),
            members: t("acp.header.resultGroups.members"),
            groups: t("acp.header.resultGroups.groups"),
            forums: t("acp.header.resultGroups.forums"),
          },
        }}
      />
      <div className="gcs-acpTop__tools">
        <Link href="/" className="gcs-acpTop__link" data-testid="gcs-acp-view-site">
          <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
          <span className="gcs-acpTop__linkText">{t("acp.header.viewSite")}</span>
        </Link>
        <GcsNotificationBell initialUnread={unread} icons={await notificationIcons()} />
        <GcsAcpThemeSwitch
          initial={theme}
          labels={{
            group: t("acp.header.theme"),
            auto: t("acp.header.themes.auto"),
            light: t("acp.header.themes.light"),
            dark: t("acp.header.themes.dark"),
          }}
        />
        <GcsAcpAccountMenu
          trigger={
            <>
              {avatar("s")}
              <GcsMemberLink user={user} href={null} className="gcs-acpTop__accountName" />
            </>
          }
          profileHref={memberHref(user)}
          labels={{
            menu: t("acp.header.account"),
            profile: t("acp.header.profile"),
            settings: t("acp.header.accountSettings"),
            logout: t("acp.header.logout"),
          }}
        />
      </div>
    </>
  );

  return (
    <div className="gcs-acp" data-theme={theme}>
      <GcsAcpShell
        areas={areas}
        dashboard={dashboard}
        initialArea={jar.get(ACP_AREA_COOKIE)?.value ?? null}
        initialCollapsed={jar.get(ACP_COLUMN_COOKIE)?.value === "collapsed"}
        brand={brand}
        siteName={siteName}
        adminCard={adminCard}
        topbar={topbar}
        labels={{
          rail: t("acp.areasNav"),
          menu: t("acp.openMenu"),
          closeMenu: t("acp.closeMenu"),
          collapse: t("acp.collapseMenu"),
          drawer: t("acp.drawer"),
          breadcrumb: t("acp.breadcrumb"),
          home: dashboard?.label ?? t("acp.dashboard.title"),
          skip: t("acp.skipToContent"),
        }}
      >
        <GcsPluginNotice actor={panel.actor} />
        {children}
      </GcsAcpShell>
    </div>
  );
}
