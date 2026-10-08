import { SERVER_ADMINS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { serverAdminFormData } from "../form-data";
import { GcsServerAdminForm } from "../GcsServerAdminForm";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.serverAdmins"))("editTitle") };
}

/** ACP → Gaming → Admini servere → Editează (parola unui admin pe nume nu se mai arată; goală = neschimbată). */
export default async function AcpEditServerAdminPage({ params }: Props) {
  const { actor } = await requireAcpSection(SERVER_ADMINS_ACP_SECTION, "edit");
  const id = Number((await params).id);
  const { bridge, db } = services();
  const row = Number.isInteger(id) ? await bridge.admins.get(actor, id) : null;
  if (!row) notFound();
  const raw = await db.gameAdmin.findUniqueOrThrow({ where: { id }, select: { flags: true, immunity: true, passwordVerifier: true } });
  const [t, data] = await Promise.all([getTranslations("acp.serverAdmins"), serverAdminFormData()]);
  return (
    <>
      <Link href="/admin/gaming/server-admins" className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>
      <GcsAcpTitle icon="fa-solid fa-user-shield" description={row.label}>
        {t("editTitle")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("editTitle")} style={{ padding: 20 }}>
        <GcsServerAdminForm
          values={{
            id: row.id,
            subject: row.subject,
            user: row.user,
            identity: row.player?.value ?? "",
            identityKind: row.player?.kind === "NONSTEAM" ? "nonsteam" : "steam",
            name: row.name ?? "",
            hasPassword: raw.passwordVerifier !== null,
            serverId: row.server?.id ?? null,
            presetId: row.preset?.id ?? null,
            flags: raw.flags,
            immunity: raw.immunity,
            allowNonSteam: row.allowNonSteam,
            note: row.note,
            expiresAt: row.expiresAt,
          }}
          servers={data.servers}
          presets={data.presets}
        />
      </GcsCard>
    </>
  );
}
