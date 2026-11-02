import { loadPasswordPolicy } from "@gcs/core";
import { GcsButton } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { passwordRuleHint } from "@/lib/legal";
import { services } from "@/lib/services";
import { GcsAuthCard } from "../_components/GcsAuthCard";
import { GcsPasswordResetUnavailable } from "../_components/GcsPasswordResetUnavailable";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset");
  // Tokenul e în adresă: nu pleacă mai departe în `Referer` și pagina nu se indexează.
  return { title: t("title"), referrer: "no-referrer", robots: { index: false, follow: false } };
}

/**
 * Linkul din emailul „Am uitat parola” (`/reset-password?token=…`): parola nouă de două ori, cu regula parolei din ACP
 * (verificată și pe server). Un link expirat, folosit sau înlocuit de o cerere nouă duce la o cerere nouă.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const t = await getTranslations("auth.reset");
  const { passwordReset, settings } = services();
  const [availability, valid, siteName, policy] = await Promise.all([
    passwordReset.availability(),
    passwordReset.check(token),
    settings.get<string>("site.name"),
    loadPasswordPolicy(settings),
  ]);
  return (
    <GcsAuthCard title={t("title")} subtitle={t("subtitle", { site: siteName })} icon={<GcsIcon name="fa-solid fa-key" />}>
      {availability !== "available" ? (
        <GcsPasswordResetUnavailable reason={availability} />
      ) : valid ? (
        <ResetPasswordForm token={token} minLength={policy.minLength} hint={await passwordRuleHint(policy)} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="gcs-reset-invalid">
          <p role="alert" className="gcs-notice gcs-notice--error" style={{ margin: 0 }}>
            {t("invalid")}
          </p>
          <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-paper-plane" />}>
            <Link href="/forgot-password">{t("requestNew")}</Link>
          </GcsButton>
        </div>
      )}
    </GcsAuthCard>
  );
}
