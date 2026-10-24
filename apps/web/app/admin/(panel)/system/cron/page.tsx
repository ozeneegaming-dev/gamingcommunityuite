import { CRON_STALE_MS, gcsEdition } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { cronLastRun, liteCronCommands } from "@/lib/cron";
import { services } from "@/lib/services";
import { GcsCronPanel } from "../../../../install/_components/GcsCronPanel";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("install.cron"))("title") };
}

/**
 * ACP › Sistem › Cron: în ediția Lite joburile programate (digesturi, curățenii, statistici…) rulează la cron-ul
 * gazdei; pagina arată comanda de pus în panou și dacă rulează. În ediția VPS le rulează `gcs-worker`.
 */
export default async function AcpCronPage() {
  await requireAcpSection("system.cron");
  const t = await getTranslations("install.cron");
  if (gcsEdition() !== "lite") {
    return (
      <>
        <GcsAcpTitle icon="fa-solid fa-clock">{t("title")}</GcsAcpTitle>
        <GcsCard style={{ padding: 20, maxWidth: 820 }} data-testid="gcs-cron-vps">
          <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("vps")}</p>
        </GcsCard>
      </>
    );
  }
  const siteUrl = await services().settings.get<string>("site.url");
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-clock">{t("title")}</GcsAcpTitle>
      <GcsCard style={{ padding: 20, maxWidth: 820 }}>
        <GcsCronPanel
          commands={liteCronCommands(siteUrl)}
          initialLastRun={await cronLastRun()}
          staleMs={CRON_STALE_MS}
          locale={await getLocale()}
          labels={{
            title: t("acpTitle"),
            body: t("acpBody"),
            schedule: t("schedule"),
            node: t("node"),
            curl: t("curl"),
            copy: t("copy"),
            copied: t("copied"),
            check: t("check"),
            checking: t("checking"),
            never: t("never"),
            lastRun: t.raw("lastRun") as string,
            stale: t("stale"),
          }}
        />
      </GcsCard>
    </>
  );
}
