import { GROUPS_PRO_APP } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpAppSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsLegendEditor, type GcsLegendEditorGroup } from "./GcsLegendEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.groupsLegend"))("title") };
}

/**
 * ACP → Membri → Legenda grupurilor (aplicația premium Grupuri Pro; oprită sau fără acces → 404): categoriile legendei,
 * locul fiecărui grup (categoria, grupul sub care apare, ordinea, „Neafișate”), opțiunile de afișare și previzualizarea
 * live. Dreptul e cel al grupurilor (`members.groups`); salvarea cere și dreptul de editare.
 */
export default async function AcpGroupsLegendPage() {
  await requireAcpAppSection(GROUPS_PRO_APP, "members.groups");
  const [t, data] = await Promise.all([getTranslations("acp.groupsLegend"), services().groupsPro.editor()]);
  const groups: GcsLegendEditorGroup[] = data.groups.map((g) => {
    const def = resolveIcon(g.icon ?? "fa-solid fa-users");
    return {
      id: g.id,
      key: g.key,
      name: g.name,
      color: g.color,
      icon: g.icon,
      public: g.public,
      description: g.description,
      inLegend: g.inLegend,
      priority: g.priority,
      position: g.position,
      iconDef: def ? { prefix: def.prefix, iconName: def.iconName, icon: def.icon } : null,
    };
  });
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-layer-group">{t("title")}</GcsAcpTitle>
      <GcsCard as="section" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>
          {t("intro")}{" "}
          <Link href="/" target="_blank" rel="noopener">
            <GcsIcon name="fa-solid fa-arrow-up-right-from-square" className="gcs-hIcon" />
            {t("viewSite")}
          </Link>
        </p>
        <GcsLegendEditor initial={data.tree} groups={groups} counts={data.counts} />
      </GcsCard>
    </>
  );
}
