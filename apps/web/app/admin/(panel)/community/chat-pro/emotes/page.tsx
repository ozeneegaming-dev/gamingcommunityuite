import { CHAT_PRO_ACP_EMOTES } from "@gcs/modules";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsEmoteAdmin } from "./GcsEmoteAdmin";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.chatPro.emotes"))("title") };
}

/**
 * ACP → Comunitate → Chat Pro → Emoticoane: pachetele (categoriile), încărcarea în masă (PNG, GIF, WebP; codul din
 * numele fișierului), schimbarea codului și ștergerea (cu confirmare în pagină). Emoticoanele le încarcă adminii: GCS
 * nu livrează imagini ale altora.
 */
export default async function AcpChatProEmotesPage() {
  const { actor } = await requireAcpSection(CHAT_PRO_ACP_EMOTES);
  const { chatPro, settings, acp } = services();
  const [t, packs, maxKb, maxSide, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.chatPro.emotes"),
    chatPro.emotes.adminPacks(actor),
    settings.get<number>("chat_pro.emote_max_kb"),
    settings.get<number>("chat_pro.emote_max_side"),
    acp.can(actor, CHAT_PRO_ACP_EMOTES, "edit"),
    acp.can(actor, CHAT_PRO_ACP_EMOTES, "delete"),
  ]);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-face-grin-stars">{t("title")}</GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0, maxWidth: 900 }}>
        {t("intro", { kb: maxKb, side: maxSide })}
      </p>
      <GcsEmoteAdmin packs={packs} canEdit={canEdit} canDelete={canDelete} limits={{ kb: maxKb, side: maxSide }} />
    </>
  );
}
