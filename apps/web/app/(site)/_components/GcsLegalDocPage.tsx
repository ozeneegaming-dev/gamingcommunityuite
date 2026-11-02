import { sanitizeContentHtml } from "@gcs/core";
import { legalDoc, type GcsLegalDocKind } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { services } from "@/lib/services";

const ICONS: Record<GcsLegalDocKind, string> = { terms: "fa-solid fa-file-contract", privacy: "fa-solid fa-user-shield" };

export async function legalDocMetadata(kind: GcsLegalDocKind): Promise<Metadata> {
  return { title: (await getTranslations("legalPage"))(`${kind}.title`) };
}

/**
 * `/terms` și `/privacy` (ACP → Setări → Termeni și confidențialitate): documentul scris în ACP, randat de același
 * randator și sanitizer ca postările și regulile. Fără document → 404; cu o adresă externă → redirecționare acolo.
 */
export async function GcsLegalDocPage({ kind }: { kind: GcsLegalDocKind }) {
  const doc = await legalDoc(services().settings, kind);
  if (doc.mode === "none") notFound();
  if (doc.mode === "external") redirect(doc.href);
  const [t, format] = await Promise.all([getTranslations("legalPage"), getFormatter()]);
  return (
    <GcsCard as="article" className="gcs-rules" aria-labelledby="gcs-legal-title" data-testid={`gcs-legal-page-${kind}`}>
      <header className="gcs-rules__head">
        <h1 id="gcs-legal-title" className="gcs-display gcs-pageHeader__title">
          <GcsIcon name={ICONS[kind]} className="gcs-hIcon" />
          {t(`${kind}.title`)}
        </h1>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
          <time dateTime={doc.doc.updatedAt}>{t("updated", { date: format.dateTime(new Date(doc.doc.updatedAt), { dateStyle: "long" }) })}</time>
        </p>
      </header>
      {/* Încă o trecere prin sanitizer: setarea se poate scrie și altfel decât prin editor. */}
      <div className="gcs-postBody gcs-rules__body" dangerouslySetInnerHTML={{ __html: sanitizeContentHtml(doc.doc.html) }} />
    </GcsCard>
  );
}
