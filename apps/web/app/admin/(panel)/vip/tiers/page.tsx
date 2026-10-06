import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { createTier } from "../actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.vip"))("tiersTitle") };
}

/** ACP → VIP → Niveluri: grupurile VIP (privilegiile se editează ca setări de grup). */
export default async function AcpVipTiersPage() {
  await requireAcpSection("vip.tiers");
  const t = await getTranslations("acp.vip");
  const { db } = services();
  const tiers = await db.group.findMany({
    where: { isVip: true },
    orderBy: { position: "asc" },
    select: { id: true, key: true, name: true, _count: { select: { vipSubscriptions: { where: { status: "ACTIVE" } } } } },
  });
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-layer-group">
        {t("tiersTitle")}
      </GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("tiersHelp")}
      </p>
      <GcsCard as="section" style={{ overflow: "hidden" }}>
        {tiers.map((g) => (
          <div key={g.id} className="gcs-settingsList__row" style={{ padding: "0 16px" }} data-testid="gcs-acp-vip-tier">
            <span className={`gcs-name--${g.key}`} style={{ fontWeight: 700 }}>
              {g.name}
            </span>
            <span className="gcs-muted" style={{ fontSize: 13 }}>
              {t("activeCount", { count: g._count.vipSubscriptions })}
            </span>
            <span style={{ display: "flex", gap: 12 }}>
              <Link href={`/admin/vip/subscribers?tier=${g.id}`}>{t("subscribersTitle")}</Link>
              <Link href={`/admin/groups/${g.id}`}>{t("editTier")}</Link>
            </span>
          </div>
        ))}
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-tier-new" style={{ padding: 16 }}>
        <h2 id="gcs-tier-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("addTier")}
        </h2>
        <GcsActionForm action={createTier} submitLabel={t("addTier")} submitKind="create">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-field" style={{ width: 200 }}>
              {t("name")}
              <input className="gcs-input" name="name" required maxLength={40} />
            </label>
            <label className="gcs-field" style={{ width: 110 }}>
              {t("color")}
              <input className="gcs-input" name="color" placeholder="#B794FF" pattern="#[0-9A-Fa-f]{6}" />
            </label>
            <label className="gcs-field" style={{ width: 220 }}>
              {t("copyFrom")}
              <select className="gcs-input" name="copyFrom" defaultValue={tiers[tiers.length - 1]?.id}>
                {tiers.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
