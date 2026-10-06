import { acpAppEntries } from "@gcs/core";
import { GcsAvatar, GcsButton } from "@gcs/ui";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { GcsLogoutButton } from "@/app/(site)/_components/GcsLogoutButton";
import { requireAcpPanel } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpSearch } from "./_components/GcsAcpSearch";
import { GcsAcpShell } from "./_components/GcsAcpShell";
import { ACP_THEME_COOKIE, GcsAcpThemeSwitch, type GcsAcpTheme } from "./_components/GcsAcpThemeSwitch";
import type { GcsAcpIconDef, GcsAcpNavApp, GcsAcpNavSection } from "./_components/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acp");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const THEMES: GcsAcpTheme[] = ["auto", "light", "dark"];

/** Iconița unei intrări din meniu, rezolvată aici: la client ajung doar datele SVG ale iconițelor folosite. */
function navIcon(name: string | undefined): { icon?: GcsAcpIconDef } {
  const def = resolveIcon(name);
  return def ? { icon: { prefix: def.prefix, iconName: def.iconName, icon: def.icon } } : {};
}

/** Layout-ul ACP (macheta Admin). Garda de acces rulează înaintea oricărei randări: fără acces → 404. */
export default async function AcpPanelLayout({ children }: { children: ReactNode }) {
  const panel = await requireAcpPanel();
  const t = await getTranslations();
  const tr = (key: string) => (t.has(key) ? t(key) : key);
  const [layout, siteName] = await Promise.all([services().acpDashboard.getLayout(panel.user.id), services().settings.get<string>("site.name")]);

  const apps: GcsAcpNavApp[] = acpAppEntries(panel.menu, layout.appOrder).map((a) => ({
    app: a.app,
    href: a.href,
    label: tr(`acp.apps.${a.app}`),
  }));
  const sections: GcsAcpNavSection[] = panel.menu.map((s) => ({
    app: s.app,
    title: tr(s.title),
    ...navIcon(s.icon),
    items: s.items.map((i) => ({ key: i.key, href: i.href, label: tr(i.labelKey), ...navIcon(i.icon) })),
  }));
  const perApp = (key: string) => Object.fromEntries(apps.map((a) => [a.app, t(key, { app: a.label })]));

  const themeCookie = (await cookies()).get(ACP_THEME_COOKIE)?.value as GcsAcpTheme | undefined;
  const theme: GcsAcpTheme = themeCookie && THEMES.includes(themeCookie) ? themeCookie : "dark";

  const header = (
    <header className="gcs-acpHeader">
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
      <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-arrow-up-right-from-square" />}>
        <Link href="/">{t("acp.header.viewSite")}</Link>
      </GcsButton>
      <GcsAcpThemeSwitch
        initial={theme}
        labels={{
          group: t("acp.header.theme"),
          auto: t("acp.header.themes.auto"),
          light: t("acp.header.themes.light"),
          dark: t("acp.header.themes.dark"),
        }}
      />
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <GcsAvatar name={panel.user.name} size="s" {...(panel.user.image ? { src: panel.user.image } : {})} />
        <span style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          <span className={`gcs-name--${panel.user.primaryGroup.key}`} style={{ fontSize: 13 }} data-testid="gcs-acp-user">
            {panel.user.name}
          </span>
          <span style={{ color: "var(--gcs-muted)" }}>
            {panel.user.primaryGroup.name} · {t("acp.header.twoFactorOn")}
          </span>
        </span>
      </span>
      <GcsLogoutButton label={t("acp.header.logout")} />
    </header>
  );

  return (
    <div className="gcs-acp" data-theme={theme}>
      <GcsAcpShell
        apps={apps}
        sections={sections}
        header={header}
        labels={{
          appsNav: t("acp.appsNav"),
          submenuNav: perApp("acp.submenuNav"),
          home: t("acp.home", { site: siteName }),
          reorderApps: t("acp.reorderApps"),
          reorderDone: t("acp.reorderDone"),
          moveUp: perApp("acp.moveUp"),
          moveDown: perApp("acp.moveDown"),
          openMenu: t("acp.openMenu"),
          closeMenu: t("acp.closeMenu"),
        }}
      >
        {children}
      </GcsAcpShell>
    </div>
  );
}
