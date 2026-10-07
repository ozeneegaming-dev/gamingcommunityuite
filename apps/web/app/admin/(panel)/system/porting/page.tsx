import { GcsNotFound } from "@gcs/core";
import { PORT_SOURCE_LIMITS, PORTING_ACP_SECTION, type GcsPortView } from "@gcs/modules";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsPortingWizard } from "./GcsPortingWizard";

type Props = { searchParams: Promise<{ id?: string | string[] }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("porting"))("title") };
}

/**
 * ACP → Sistem → Conversii → Portare plugin (designul portării, §2.2): încărcarea pluginului sursă, confirmarea
 * dreptului de a-l modifica și folosi, conversia într-un plugin GCS și rezultatul (descărcare, predare la instalator,
 * ștergere). Portarea deschisă e în adresă (`?id=`), ca să rămână la un refresh.
 */
export default async function AcpPortingPage({ searchParams }: Props) {
  const panel = await requireAcpSection(PORTING_ACP_SECTION);
  const [t, sp] = await Promise.all([getTranslations("porting"), searchParams]);
  const { porting, acp } = services();
  const id = typeof sp.id === "string" ? sp.id.slice(0, 64) : "";
  const [port, recent, canEdit, canDelete] = await Promise.all([
    id
      ? porting.get(panel.actor, id).catch((error: unknown): GcsPortView | null => {
          // O portare ștearsă sau expirată (după o zi): asistentul pornește de la încărcare, cu un mesaj.
          if (error instanceof GcsNotFound) return null;
          throw error;
        })
      : Promise.resolve(null),
    porting.list(panel.actor, 10),
    acp.can(panel.actor, PORTING_ACP_SECTION, "edit"),
    acp.can(panel.actor, PORTING_ACP_SECTION, "delete"),
  ]);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-code-compare" description={t("description")}>
        {t("title")}
      </GcsAcpTitle>
      <GcsPortingWizard
        key={port?.id ?? (id ? `lipsa-${id}` : "nou")}
        port={port}
        missing={id !== "" && port === null}
        recent={recent}
        canEdit={canEdit}
        canDelete={canDelete}
        maxBytes={PORT_SOURCE_LIMITS.maxArchiveBytes}
        maxFiles={PORT_SOURCE_LIMITS.maxFiles}
      />
    </>
  );
}
