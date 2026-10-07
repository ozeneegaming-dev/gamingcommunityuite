import { IMPORT_ACP_SECTION } from "@gcs/modules";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsImportWizard } from "./GcsImportWizard";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("importer"))("title") };
}

/**
 * ACP → Sistem → Conversii → Import din altă platformă (specul importului, §9): conexiunea la baza veche și testul ei,
 * opțiunile, rularea de probă, progresul live, raportul final și redirecturile 301.
 */
export default async function AcpImportPage() {
  const panel = await requireAcpSection(IMPORT_ACP_SECTION);
  const t = await getTranslations("importer");
  const { importer, acp } = services();
  const [job, redirects, canEdit, canDelete] = await Promise.all([
    importer.latest(panel.actor),
    importer.redirectConfig(panel.actor),
    acp.can(panel.actor, IMPORT_ACP_SECTION, "edit"),
    acp.can(panel.actor, IMPORT_ACP_SECTION, "delete"),
  ]);
  const [logs, errors, samples] = job
    ? await Promise.all([
        importer.logs(panel.actor, job.id, { limit: 30 }),
        importer.logs(panel.actor, job.id, { level: "error", limit: 30 }),
        job.status === "DONE" && !job.dryRun ? importer.redirectSamples(panel.actor, job.id) : Promise.resolve([]),
      ])
    : [[], [], []];
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-file-import" description={t("description")}>
        {t("title")}
      </GcsAcpTitle>
      <GcsImportWizard
        key={job?.id ?? "nou"}
        initial={{ job, logs, errors }}
        redirects={redirects}
        samples={samples}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </>
  );
}
