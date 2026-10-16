import { MENUS_ACP_SECTION, type GcsNavItemEdit } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { localeOptions } from "@/lib/locales";
import { services } from "@/lib/services";
import { GcsMenuEditor } from "./GcsMenuEditor";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.menuManager"))("title") };
}

/** ACP → Sistem → Manager meniu (specul etapei 5): meniul principal al site-ului. */
export default async function AcpMenuManagerPage() {
  await requireAcpSection(MENUS_ACP_SECTION);
  const { nav, db } = services();
  const [t, tAll, items, locales, groups] = await Promise.all([
    getTranslations("acp.menuManager"),
    getTranslations(),
    nav.editable(),
    localeOptions(),
    db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  // Etichetele automate (cheile modulelor), traduse în limba adminului, ca editorul să le poată arăta.
  const keys = new Set<string>();
  const collect = (list: GcsNavItemEdit[]) => {
    for (const it of list) {
      const label = it.label as Record<string, string>;
      if ("key" in label && label.key) keys.add(label.key);
      collect(it.children);
    }
  };
  collect(items);
  const autoLabels = Object.fromEntries([...keys].map((k) => [k, tAll.has(k) ? tAll(k) : k]));
  const keysOf = ["add", "addChild", "label", "autoLabel", "href", "icon", "iconSearch", "iconNone", "iconNoResults", "groups", "groupsHint", "newTab", "enabled", "up", "down", "remove", "save", "saved", "newItem", "mega", "description", "descriptionHint", "badge", "badgeHint"] as const;
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-bars-staggered">
        {t("title")}
      </GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("hint")}
      </p>
      <GcsCard as="section" aria-label={t("title")} style={{ padding: 16 }}>
        <GcsMenuEditor
          initial={items}
          locales={locales.map((l) => ({ code: l.code, label: l.label }))}
          autoLabels={autoLabels}
          groups={groups}
          labels={Object.fromEntries(keysOf.map((k) => [k, t.raw(k) as string])) as Parameters<typeof GcsMenuEditor>[0]["labels"]}
        />
      </GcsCard>
    </>
  );
}
