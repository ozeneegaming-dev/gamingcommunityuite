import { PAGES_ACP } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsHtmlEditor } from "./GcsHtmlEditor";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.html"))("title") };
}

/**
 * ACP › Pagini › HTML: pagina scrisă de mână. Editorul de cod cu etichetele GCS gata de inserat (`{block="…"}` pentru un
 * bloc reutilizabil, `{database="…"}` pentru ultimele înregistrări ale unei baze). HTML-ul se curăță la salvare.
 */
export default async function AcpPageHtml({ params }: Props) {
  const { actor } = await requireAcpSection(PAGES_ACP.pages, "edit");
  const id = Number((await params).id);
  const { pagesAdmin, db } = services();
  const node = Number.isSafeInteger(id) ? await pagesAdmin.node(actor, id) : null;
  if (!node || node.kind !== "page") notFound();
  const [t, blocks, databases] = await Promise.all([
    getTranslations("acp.pages.html"),
    db.pagesBlock.findMany({ orderBy: { name: "asc" }, select: { key: true, name: true } }),
    db.pagesDatabase.findMany({ orderBy: { name: "asc" }, select: { key: true, name: true } }),
  ]);
  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-code"
        description={t("lead")}
        actions={
          <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href="/admin/pages">
            <GcsIcon name="fa-solid fa-arrow-left" />
            {t("back")}
          </Link>
        }
      >
        {t("titleFor", { title: node.title })}
      </GcsAcpTitle>
      {node.contentType !== "html" && <p className="gcs-notice">{t("notHtml")}</p>}
      <GcsHtmlEditor nodeId={node.id} initial={node.html} viewHref={`/pages/${node.path}`} tags={[...blocks.map((b) => ({ tag: `{block="${b.key}"}`, label: b.name, kind: "block" as const })), ...databases.map((d) => ({ tag: `{database="${d.key}"}`, label: d.name, kind: "database" as const }))]} />
    </>
  );
}
