import { SERVER_ADMINS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { serverAdminFormData } from "../form-data";
import { GcsServerAdminForm } from "../GcsServerAdminForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.serverAdmins"))("newTitle") };
}

/** ACP → Gaming → Admini servere → Adaugă. */
export default async function AcpNewServerAdminPage() {
  await requireAcpSection(SERVER_ADMINS_ACP_SECTION, "edit");
  const [t, data] = await Promise.all([getTranslations("acp.serverAdmins"), serverAdminFormData()]);
  const preset = data.presets.find((p) => p.name === "Admin") ?? data.presets[0] ?? null;
  return (
    <>
      <Link href="/admin/gaming/server-admins" className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>
      <GcsAcpTitle icon="fa-solid fa-user-shield">{t("newTitle")}</GcsAcpTitle>
      <GcsCard as="section" aria-label={t("newTitle")} style={{ padding: 20 }}>
        <GcsServerAdminForm
          values={{ id: null, subject: "USER", user: null, identity: "", identityKind: "steam", name: "", hasPassword: false, serverId: null, presetId: preset?.id ?? null, flags: null, immunity: null, allowNonSteam: false, note: "", expiresAt: null }}
          servers={data.servers}
          presets={data.presets}
        />
      </GcsCard>
    </>
  );
}
