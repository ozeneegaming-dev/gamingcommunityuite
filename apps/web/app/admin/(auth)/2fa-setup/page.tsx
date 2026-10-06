import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { GcsAcpTitle } from "../../(panel)/_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acp.twoFactorSetup");
  return { title: t("title"), robots: { index: false } };
}

export default async function AcpTwoFactorSetupPage() {
  const ctx = await getAcpContext();
  if (ctx.user?.twoFactorEnabled) redirect("/admin/reauth");
  const t = await getTranslations("acp.twoFactorSetup");
  const userId = ctx.user?.id;
  const hasPassword = userId
    ? (await services().db.account.count({ where: { userId, providerId: "credential", password: { not: null } } })) > 0
    : false;

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-shield-halved" variant="plain" style={{ fontSize: 24 }}>
        {t("title")}
      </GcsAcpTitle>
      <p style={{ margin: "6px 0 22px", color: "var(--gcs-muted)", fontSize: 14, lineHeight: 1.6 }}>{t("subtitle")}</p>
      <TwoFactorSetup askPassword={hasPassword} />
    </>
  );
}
