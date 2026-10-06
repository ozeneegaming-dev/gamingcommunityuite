import { PLUGINS_ACP_SECTION, type GcsActor } from "@gcs/core";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";

/**
 * Anunțul din ACP pentru pluginurile dezactivate automat (etapa 6 §3.3: prea multe eșecuri la rând), vizibil pe toate
 * paginile ACP adminilor care gestionează pluginurile, până la reactivare sau dezinstalare.
 */
export async function GcsPluginNotice({ actor }: { actor: GcsActor }) {
  const { pluginAdmin, acp } = services();
  if (!(await acp.can(actor, PLUGINS_ACP_SECTION, "view"))) return null;
  const disabled = (await pluginAdmin.list().catch(() => [])).filter((p) => p.status === "installed" && !p.enabled && p.disabledReason === "auto");
  if (disabled.length === 0) return null;
  const t = await getTranslations("acp.plugins.autoDisabled");
  return (
    <div role="alert" className="gcs-acpBanner gcs-card gcs-pluginNotice" data-testid="gcs-acp-plugin-notice">
      <strong>
        <GcsIcon name="fa-solid fa-triangle-exclamation" />
        {t("title", { count: disabled.length })}
      </strong>
      <span>
        {t("body", { names: disabled.map((p) => p.name).join(", ") })} <Link href="/admin/system/applications">{t("link")}</Link>
      </span>
    </div>
  );
}
