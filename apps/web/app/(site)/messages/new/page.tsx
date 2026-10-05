import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsNewConversationForm } from "../../_components/messages/GcsMessageForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("messages"))("new"), robots: { index: false } };
}

/** Conversație nouă; `?to={id}` (de pe profil sau din card) precompletează destinatarul. */
export default async function NewConversationPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const to = (await searchParams).to;
  const t = await getTranslations("messages");
  const initial =
    to && /^[a-z0-9]{8,40}$/i.test(to) && to !== actor.userId
      ? await services().db.user.findUnique({ where: { id: to }, select: { id: true, name: true } })
      : null;
  return (
    <GcsCard as="section" style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 26 }}>
        {t("new")}
      </h1>
      <GcsNewConversationForm
        initial={initial ? [initial] : []}
        labels={{ to: t("to"), toPlaceholder: t("toPlaceholder"), remove: t("remove"), title: t("subject"), send: t("send"), sending: t("sending") }}
      />
    </GcsCard>
  );
}
