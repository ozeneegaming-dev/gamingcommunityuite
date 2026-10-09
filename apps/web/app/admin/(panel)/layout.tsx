import { acpAppEntries, type GcsAcpMenuSection } from "@gcs/core";
import { GcsAvatar } from "@gcs/ui";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { GcsNotificationBell } from "@/app/(site)/_components/notifications/GcsNotificationBell";
import { requireAcpPanel } from "@/lib/acp";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsAcpAccountMenu } from "./_components/GcsAcpAccountMenu";
import { GcsAcpSearch } from "./_components/GcsAcpSearch";
import { GcsAcpShell } from "./_components/GcsAcpShell";
import { GcsPluginNotice } from "./_components/GcsPluginNotice";
import { ACP_THEME_COOKIE, ACP_THEMES, type GcsAcpTheme } from "./_components/acp-theme";
import { GcsAcpThemeSwitch } from "./_components/GcsAcpThemeSwitch";
import type { GcsAcpIconDef, GcsAcpNavGroup, GcsAcpNavItem, GcsAcpNavSection } from "./_components/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acp");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const DASHBOARD_HREF = "/admin";

/**
 * Secțiunile scoase într-un grup propriu în sidebar (etapa 6 §1.3), după titlul lor din meniul modulelor.
 * Grupul nou apare înaintea aplicației din `before` (sau la final).
 */
const OWN_GROUPS: Record<string, { group: string; before: string }> = {
  "acp.menu.system.conversions": { group: "conversions", before: "stats" },
};

/** Iconița unei intrări din meniu, rezolvată aici: la client ajung doar datele SVG ale iconițelor folosite. */
function navIcon(name: string | undefined): { icon?: GcsAcpIconDef } {
  const def = resolveIcon(name);
  return def ? { icon: { prefix: def.prefix, iconName: def.iconName, icon: def.icon } } : {};
}

/**
 * Grupurile sidebar-ului, în ordinea aplicațiilor (cea salvată de admin, apoi cea implicită). Dashboard-ul nu intră
 * în grupuri: are intrarea lui, deasupra. Drepturile sunt deja aplicate: `panel.menu` conține doar ce vede adminul.
 */
function buildGroups(menu: GcsAcpMenuSection[], appOrder: string[], tr: (key: string) => string): GcsAcpNavGroup[] {
  const groups = new Map<string, GcsAcpNavGroup>();
  const order = acpAppEntries(menu, appOrder).map((a) => a.app as string);
  const extra: { group: string; before: string }[] = [];
  for (const s of menu) {
    const own = OWN_GROUPS[s.title];
    const id = own?.group ?? s.app;
    if (own && !extra.some((e) => e.group === own.group)) extra.push(own);
    const items = s.items.filter((i) => i.href !== DASHBOARD_HREF).map((i) => ({ key: i.key, href: i.href, label: tr(i.labelKey), ...navIcon(i.icon) }));
    if (items.length === 0) continue;
    const section: GcsAcpNavSection = { app: id, title: tr(s.title), ...navIcon(s.icon), items };
    const group = groups.get(id) ?? { id, label: tr(`acp.apps.${id}`), sections: [] };
    group.sections.push(section);
    groups.set(id, group);
  }
  for (const e of extra) {
    const at = order.indexOf(e.before);
    if (at === -1) order.push(e.group);
    else order.splice(at, 0, e.group);
  }
  return order.map((id) => groups.get(id)).filter((g): g is GcsAcpNavGroup => !!g);
}

/** Layout-ul ACP (etapa 6 §1.1). Garda de acces rulează înaintea oricărei randări: fără acces → 404. */
export default async function AcpPanelLayout({ children }: { children: ReactNode }) {
  const panel = await requireAcpPanel();
  const t = await getTranslations();
  const tr = (key: string) => (t.has(key) ? t(key) : key);
  const { acpDashboard, settings, acp, notifications } = services();
  const [layout, siteName, roles, unread] = await Promise.all([
    acpDashboard.getLayout(panel.user.id),
    settings.get<string>("site.name"),
    acp.roleNames(panel.actor),
    notifications.unreadCount(panel.user.id).catch(() => 0),
  ]);

  const groups = buildGroups(panel.menu, layout.appOrder, tr);
  const dashboardItem = panel.menu.flatMap((s) => s.items).find((i) => i.href === DASHBOARD_HREF);
  const dashboard: GcsAcpNavItem | null = dashboardItem
    ? { key: dashboardItem.key, href: dashboardItem.href, label: tr(dashboardItem.labelKey), ...navIcon(dashboardItem.icon) }
    : null;

  const themeCookie = (await cookies()).get(ACP_THEME_COOKIE)?.value as GcsAcpTheme | undefined;
  const theme: GcsAcpTheme = themeCookie && ACP_THEMES.includes(themeCookie) ? themeCookie : "dark";
  const user = panel.user;
  const avatar = (size: "s" | "m") => <GcsAvatar name={user.name} size={size} {...(user.image ? { src: user.image } : {})} />;
  const role = roles.length > 0 ? roles.join(", ") : user.primaryGroup.name;

  const brand = (
    <Link href={DASHBOARD_HREF} aria-label={t("acp.home", { site: siteName })} className="gcs-acpSide__logo">
      <span aria-hidden="true" className="gcs-acpSide__mark">
        {siteName.trim().charAt(0).toUpperCase() || "G"}
      </span>
      <span className="gcs-acpSide__site gcs-display">{siteName}</span>
    </Link>
  );

  const adminCard = (
    <div className="gcs-acpSide__admin" data-testid="gcs-acp-admin-card">
      <span className="gcs-acpSide__avatar">{avatar("m")}</span>
      <span className="gcs-acpSide__who">
        <span className={`gcs-acpSide__name gcs-name--${user.primaryGroup.key}`} data-testid="gcs-acp-user">
          {user.name}
        </span>
        <span className="gcs-acpSide__role">
          <GcsIcon name="fa-solid fa-user-shield" />
          {role}
        </span>
        <span className="gcs-acpSide__twofa">
          <GcsIcon name="fa-solid fa-shield-halved" />
          {t("acp.header.twoFactorOn")}
        </span>
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
        <GcsNotificationBell
          initialUnread={unread}
          labels={{
            title: t("notifications.title"),
            unread: t.raw("notifications.unreadLabel") as string,
            empty: t("notifications.empty"),
            markAll: t("notifications.markAll"),
            seeAll: t("notifications.seeAll"),
          }}
        />
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
              <span className="gcs-acpTop__accountName">{user.name}</span>
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
        groups={groups}
        dashboard={dashboard}
        brand={brand}
        adminCard={adminCard}
        topbar={topbar}
        labels={{
          nav: t("acp.appsNav"),
          menu: t("acp.openMenu"),
          closeMenu: t("acp.closeMenu"),
          drawer: t("acp.drawer"),
          breadcrumb: t("acp.breadcrumb"),
          home: dashboard?.label ?? t("acp.dashboard.title"),
        }}
      >
        <GcsPluginNotice actor={panel.actor} />
        {children}
      </GcsAcpShell>
    </div>
  );
}
