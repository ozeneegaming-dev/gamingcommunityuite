import { CHAT_PRO_ACP_BAR } from "@gcs/modules";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsChatProBarEditor } from "./GcsChatProBarEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.chatPro.bar"))("title") };
}

/** ACP → Comunitate → Chat Pro → Bara de anunțuri: elementele (text, buton, program, grupuri), ordinea și ștergerea. */
export default async function AcpChatProBarPage() {
  const { actor } = await requireAcpSection(CHAT_PRO_ACP_BAR);
  const { chatPro, db, acp } = services();
  const [t, items, groups, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.chatPro.bar"),
    chatPro.bar.adminList(actor),
    db.group.findMany({ where: { key: { not: "banned" } }, orderBy: { position: "asc" }, select: { id: true, key: true, name: true } }),
    acp.can(actor, CHAT_PRO_ACP_BAR, "edit"),
    acp.can(actor, CHAT_PRO_ACP_BAR, "delete"),
  ]);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-bullhorn">{t("title")}</GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0, maxWidth: 900 }}>
        {t("intro")}
      </p>
      <GcsChatProBarEditor items={items} groups={groups} canEdit={canEdit} canDelete={canDelete} />
    </>
  );
}
