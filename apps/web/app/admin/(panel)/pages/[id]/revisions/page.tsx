import { PAGES_ACP } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { restorePagesRevision } from "../../actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.revisions"))("title") };
}

/** ACP › Pagini › Versiuni: versiunile salvate ale unei pagini (data, autorul, mărimea), fiecare cu „Restaurează”. */
export default async function AcpPageRevisions({ params }: Props) {
  const { actor } = await requireAcpSection(PAGES_ACP.pages);
  const id = Number((await params).id);
  const { pagesAdmin, acp } = services();
  const node = Number.isSafeInteger(id) ? await pagesAdmin.node(actor, id) : null;
  if (!node) notFound();
  const [t, format, list, canEdit] = await Promise.all([getTranslations("acp.pages.revisions"), getFormatter(), pagesAdmin.revisions(actor, id), acp.can(actor, PAGES_ACP.pages, "edit")]);
  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-clock-rotate-left"
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
      <section className="gcs-card" style={{ overflow: "hidden" }}>
        {list.length === 0 ? (
          <p className="gcs-acpList__empty">
            <GcsIcon name="fa-solid fa-clock-rotate-left" />
            {t("empty")}
          </p>
        ) : (
          <ul className="gcs-acpList" data-testid="gcs-acp-pages-revisions">
            {list.map((r) => (
              <li key={r.id} className="gcs-acpList__row">
                <span className="gcs-acpList__main">
                  <GcsIcon name={r.kind === "html" ? "fa-solid fa-code" : "fa-solid fa-pen-ruler"} />
                  <span className="gcs-acpList__text">
                    <strong>{format.dateTime(new Date(r.at), { dateStyle: "medium", timeStyle: "short" })}</strong>
                    <span className="gcs-acpList__sub">
                      {r.actor ?? t("unknown")} · {r.kind === "html" ? t("htmlSize", { n: r.length }) : t("blocks", { count: r.blocks })}
                    </span>
                  </span>
                </span>
                {canEdit && <GcsActionForm action={restorePagesRevision.bind(null, r.id)} submitLabel={t("restore")} submitKind="reset" variant="ghost" compact confirm={t("restoreConfirm")} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
