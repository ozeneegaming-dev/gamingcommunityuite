import { GcsButton } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * „Am uitat parola” nu merge pe site: oprit din ACP (Setări → Securitate) sau fără trimiterea emailurilor configurată.
 * Membrul află că trebuie să contacteze echipa (pagina echipei) și se poate întoarce la autentificare.
 */
export async function GcsPasswordResetUnavailable({ reason }: { reason: "disabled" | "no_email" }) {
  const t = await getTranslations("auth.forgot");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="gcs-reset-unavailable">
      <p role="status" className="gcs-notice gcs-notice--warn" style={{ margin: 0 }}>
        {t(reason === "disabled" ? "disabled" : "noEmail")}
      </p>
      <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-user-shield" />}>
        <Link href="/staff">{t("staffLink")}</Link>
      </GcsButton>
      <p style={{ margin: 0, fontSize: 14, textAlign: "center" }}>
        <Link href="/login">{t("back")}</Link>
      </p>
    </div>
  );
}
