import { APPS_ACP_SECTION } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { setAppEnabled } from "../../appearance/actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.apps"))("title") };
}

/**
 * ACP → Sistem → Aplicații (specul etapei 5): aplicațiile opționale (Chat, VIP…). O aplicație dezactivată dispare din
 * meniu, din widget-uri și din statistici, iar paginile ei răspund cu 404.
 */
export default async function AcpApplicationsPage() {
  await requireAcpSection(APPS_ACP_SECTION);
  const [t, tAll, apps] = await Promise.all([getTranslations("acp.apps"), getTranslations(), services().apps.list()]);
  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title")}
      </h1>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("hint")}
      </p>
      <div className="gcs-acpGrid">
        {apps.map((app) => (
          <GcsCard key={app.key} as="section" aria-label={tAll.has(app.labelKey) ? tAll(app.labelKey) : app.key} style={{ padding: 16 }} data-testid={`gcs-acp-app-${app.key}`}>
            <h2 className="gcs-acpWidget__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <GcsIcon name={app.icon} /> {tAll.has(app.labelKey) ? tAll(app.labelKey) : app.key}
            </h2>
            <GcsActionForm action={setAppEnabled.bind(null, app.key)} submitLabel={t("save")}>
              <label className="gcs-checkRow">
                <input type="checkbox" name="enabled" defaultChecked={app.enabled} />
                {t("enabled")}
              </label>
            </GcsActionForm>
          </GcsCard>
        ))}
      </div>
    </>
  );
}
