import { DONATIONS_ACP_SECTION, dayKey } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { updateDonation } from "../actions";
import { GcsDonationFields } from "../GcsDonationFields";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.donations"))("editTitle") };
}

/** ACP › Donații › editarea unei donații (aceleași câmpuri ca la adăugare). */
export default async function AcpDonationEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAcpSection(DONATIONS_ACP_SECTION, "edit");
  const { id: raw } = await params;
  const id = /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const { donations, settings } = services();
  const [t, row, methods, tz] = await Promise.all([getTranslations("acp.donations"), id ? donations.donation(id) : Promise.resolve(null), donations.methods(), settings.get<string>("site.timezone")]);
  if (!row) notFound();

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-pen">{t("editTitle")}</GcsAcpTitle>
      <p style={{ margin: 0 }}>
        <Link href="/admin/vip/donations" className="gcs-arrowLink">
          <GcsIcon name="fa-solid fa-arrow-left" /> {t("back")}
        </Link>
      </p>
      <GcsCard style={{ padding: 20, maxWidth: 860 }}>
        <GcsActionForm action={updateDonation.bind(null, row.id)} submitLabel={t("save")} submitKind="save" redirectTo="/admin/vip/donations">
          <GcsDonationFields
            idPrefix="gcs-acp-don-edit"
            methods={methods}
            values={{
              member: row.user?.name ?? "",
              donorName: row.donorName,
              amount: (row.amount / 100).toFixed(row.amount % 100 === 0 ? 0 : 2),
              currency: row.currency,
              donatedAt: dayKey(row.donatedAt, tz),
              method: row.method,
              reference: row.reference,
              note: row.note,
              anonymous: row.anonymous,
              status: row.status,
            }}
          />
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
