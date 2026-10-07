import { SERVERS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { serverFormData } from "../form-data";
import { GcsServerForm } from "../GcsServerForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.servers"))("newTitle") };
}

/** ACP → Gaming → Servere → Server nou. */
export default async function AcpNewServerPage() {
  await requireAcpSection(SERVERS_ACP_SECTION);
  const [t, data] = await Promise.all([getTranslations("acp.servers"), serverFormData()]);
  return (
    <>
      <Link href="/admin/gaming/servers" className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>
      <GcsAcpTitle icon="fa-solid fa-plus">{t("newTitle")}</GcsAcpTitle>
      <GcsCard as="section" aria-label={t("newTitle")} style={{ padding: 20 }}>
        <GcsServerForm
          values={{ id: null, game: data.games[0]?.key ?? "", name: "", host: "", port: data.games[0]?.defaultPort ?? 27015, queryPort: null, description: "", forumId: null, groups: [], enabled: true, bannerUrl: null, admins: [] }}
          games={data.games}
          forums={data.forums}
          groups={data.groups}
        />
      </GcsCard>
    </>
  );
}
