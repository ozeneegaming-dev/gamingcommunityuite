import { MENUS_ACP_SECTION, NAV_COUNTERS, navDescriptionKey, type GcsNavItemEdit } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { localeOptions } from "@/lib/locales";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsMenuManager, type GcsMenuAppPage } from "./GcsMenuManager";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.menuManager"))("title") };
}

/**
 * ACP → Aspect → Manager meniu (Manager meniu v2): arborele compact cu drag & drop, panoul de editare, ciorna cu
 * previzualizarea antetului real (desktop / mobil), „Publică” / „Renunță” și restaurarea meniului implicit.
 */
export default async function AcpMenuManagerPage() {
  await requireAcpSection(MENUS_ACP_SECTION);
  const { nav, db, registry, apps } = services();
  const [t, tAll, published, draft, locales, groups, enabled] = await Promise.all([
    getTranslations("acp.menuManager"),
    getTranslations(),
    nav.editable(),
    nav.draft(),
    localeOptions(),
    db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    apps.enabledFilter(),
  ]);
  const items = draft?.items ?? published;
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);
  // Etichetele automate (cheile modulelor), traduse în limba adminului, ca editorul să le poată arăta.
  const keys = new Set<string>();
  const collect = (list: GcsNavItemEdit[]) => {
    for (const it of list) {
      const l = it.label as Record<string, string>;
      if ("key" in l && l.key) keys.add(l.key);
      collect(it.children);
    }
  };
  collect(items);
  // Paginile aplicațiilor (alegerea „Pagina unei aplicații”): itemii impliciți ai modulelor, cu subitemii lor.
  const appPages: GcsMenuAppPage[] = [];
  for (const m of registry.all()) {
    if (!m.app || !m.nav) continue;
    if (m.app.optional && !enabled(m.key)) continue;
    for (const n of m.nav) {
      appPages.push({ appKey: m.key, label: label(n.labelKey), href: n.href, icon: n.icon, labelKey: n.labelKey });
      keys.add(n.labelKey);
      for (const c of n.children ?? []) {
        appPages.push({ appKey: m.key, label: `${label(n.labelKey)} › ${label(c.labelKey)}`, href: c.href, icon: c.icon, labelKey: c.labelKey });
        keys.add(c.labelKey);
      }
    }
  }
  const autoLabels = Object.fromEntries([...keys].map((k) => [k, label(k)]));
  // Descrierile automate ale acelorași chei (`site.nav.x` → `site.navDesc.x`), doar cele traduse: rezerva unei descrieri goale.
  const autoDescriptions: Record<string, string> = Object.fromEntries(
    [...keys].flatMap((k): [string, string][] => {
      const key = navDescriptionKey(k);
      return key && tAll.has(key) ? [[k, tAll(key)]] : [];
    }),
  );
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-bars-staggered" description={t("hint")}>
        {t("title")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("title")} style={{ padding: 16 }}>
        <GcsMenuManager
          key={draft ? `draft-${draft.updatedAt.getTime()}` : `published-${JSON.stringify(published).length}`}
          initial={items}
          hasDraft={!!draft}
          locales={locales.map((l) => ({ code: l.code, label: l.label }))}
          autoLabels={autoLabels}
          autoDescriptions={autoDescriptions}
          groups={groups}
          appPages={appPages}
          counters={NAV_COUNTERS.map((k) => ({ key: k, label: t(`v2.counters.${k}`) }))}
        />
      </GcsCard>
    </>
  );
}
