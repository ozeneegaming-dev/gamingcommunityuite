import { REACTIONS_ACP_SECTION } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { saveReaction } from "../../../moderation-actions";
import { ReactionOrder } from "./ReactionOrder";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.reactions"))("title") };
}

/** ACP → Membri → Setări membri → Reputație & Reacții: reacțiile, cu simbol, culoare, greutate și ordine. */
export default async function AcpReactionsPage() {
  await requireAcpSection(REACTIONS_ACP_SECTION);
  const t = await getTranslations("acp.reactions");
  const reactions = await services().reactions.all();

  const fields = (r?: (typeof reactions)[number]) => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="gcs-field" style={{ width: 120 }}>
        {t("key")}
        <input className="gcs-input" name="key" defaultValue={r?.key ?? ""} required pattern="[a-z0-9_]{2,20}" readOnly={Boolean(r)} />
      </label>
      <label className="gcs-field" style={{ width: 160 }}>
        {t("label")}
        <input className="gcs-input" name="label" defaultValue={r?.label ?? ""} required maxLength={30} />
      </label>
      <label className="gcs-field" style={{ width: 90 }}>
        {t("symbol")}
        <input className="gcs-input" name="symbol" defaultValue={r?.symbol ?? ""} required maxLength={8} />
      </label>
      <label className="gcs-field" style={{ width: 110 }}>
        {t("color")}
        <input className="gcs-input" name="color" defaultValue={r?.color ?? "#FF6B74"} required pattern="#[0-9A-Fa-f]{6}" />
      </label>
      <label className="gcs-field" style={{ width: 90 }}>
        {t("weight")}
        <input className="gcs-input" name="weight" type="number" min={-10} max={10} defaultValue={r?.weight ?? 1} required />
      </label>
      <label className="gcs-check">
        <input type="checkbox" name="enabled" defaultChecked={r?.enabled ?? true} />
        {t("enabled")}
      </label>
    </div>
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-thumbs-up">
        {t("title")}
      </GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("help")}
      </p>
      <GcsCard style={{ padding: 16 }}>
        <ReactionOrder key={reactions.map((r) => r.id).join(",")} reactions={reactions.map((r) => ({ id: r.id, label: r.label, symbol: r.symbol, color: r.color }))} />
      </GcsCard>
      {reactions.map((r) => (
        <GcsCard key={r.id} as="section" aria-label={r.label} style={{ padding: 16 }} data-testid="gcs-acp-reaction">
          <GcsActionForm action={saveReaction.bind(null, r.id)} submitLabel={t("save")} submitKind="save">
            {fields(r)}
          </GcsActionForm>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-reaction-new" style={{ padding: 16 }}>
        <h2 id="gcs-reaction-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("add")}
        </h2>
        <GcsActionForm action={saveReaction.bind(null, null)} submitLabel={t("add")} submitKind="create">
          {fields()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
