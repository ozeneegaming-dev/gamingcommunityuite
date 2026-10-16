import { ANNOUNCEMENT_ACP_SECTION, ANNOUNCEMENT_MAX_BARS, ANNOUNCEMENT_ROTATE } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { announcementConfig } from "@/lib/announcement";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsAnnouncementEditor } from "./GcsAnnouncementEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.announcementBar"))("title") };
}

/**
 * ACP → Aspect → Conținut → Bară de anunț: barele subțiri de deasupra conținutului (în orice temă). Fiecare bară:
 * eticheta, textul, butonul și linkul, programarea, publicul (vizitatorii, membrii, grupurile), paginile, stilul și
 * închiderea; mai multe bare active se rotesc.
 */
export default async function AcpAnnouncementBarPage() {
  await requireAcpSection(ANNOUNCEMENT_ACP_SECTION);
  const [t, config, groups] = await Promise.all([
    getTranslations("acp.announcementBar"),
    announcementConfig(),
    services().db.group.findMany({ where: { key: { notIn: ["guest", "banned"] } }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-bullhorn">{t("title")}</GcsAcpTitle>
      <GcsCard as="section" style={{ padding: 20, maxWidth: 1000, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>
          {t("intro")}{" "}
          <Link href="/" target="_blank" rel="noopener">
            <GcsIcon name="fa-solid fa-arrow-up-right-from-square" className="gcs-hIcon" />
            {t("preview")}
          </Link>
        </p>
        <GcsAnnouncementEditor initial={config} groups={groups} maxBars={ANNOUNCEMENT_MAX_BARS} rotate={ANNOUNCEMENT_ROTATE} />
      </GcsCard>
    </>
  );
}
