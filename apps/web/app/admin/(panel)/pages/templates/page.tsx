import { defaultTemplate, TEMPLATE_GROUPS } from "@gcs/core";
import { PAGES_ACP } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.templates"))("title") };
}

const PAGES_TEMPLATES = ["pages.record_card"] as const;

/**
 * ACP › Pagini › Șabloane: șabloanele aplicației Pagini din fiecare temă (grupul „Pagini” al editorului de cod), cu starea
 * lor (modificat / original) și linkul spre editor; plus etichetele GCS din paginile HTML și blocurile-șablon.
 */
export default async function AcpPagesTemplates() {
  await requireAcpSection(PAGES_ACP.templates);
  const [t, locale] = await Promise.all([getTranslations("acp.pages.templates"), getLocale()]);
  const { themes, templates } = services();
  const all = await themes.list();
  const rows = await Promise.all(
    all.map(async (theme) => {
      const tree = await templates.tree(theme.key);
      return { theme, items: tree.filter((e) => (PAGES_TEMPLATES as readonly string[]).includes(e.def.key)) };
    }),
  );
  const text = (v: { ro: string; en: string }) => (locale === "ro" ? v.ro : v.en);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-code" description={t("lead")}>
        {t("title")}
      </GcsAcpTitle>
      {TEMPLATE_GROUPS.includes("pages") && (
        <section className="gcs-card" style={{ overflow: "hidden" }} data-testid="gcs-acp-pages-templates">
          <ul className="gcs-acpList">
            {rows.flatMap(({ theme, items }) =>
              items.map((e) => {
                const def = defaultTemplate(e.def.key)!;
                return (
                  <li key={`${theme.key}-${e.def.key}`} className="gcs-acpList__row">
                    <span className="gcs-acpList__main">
                      <GcsIcon name={def.icon} />
                      <span className="gcs-acpList__text">
                        <strong>{text(def.title)}</strong>
                        <span className="gcs-acpList__sub">
                          {theme.name} · <code>{def.key}</code> · {e.status === "default" ? t("original") : t("modified")}
                        </span>
                        <span className="gcs-acpList__sub">{text(def.description)}</span>
                      </span>
                    </span>
                    <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/admin/appearance/templates?theme=${encodeURIComponent(theme.key)}&template=${encodeURIComponent(def.key)}`}>
                      <GcsIcon name="fa-solid fa-pen" />
                      {t("edit")}
                    </Link>
                  </li>
                );
              }),
            )}
          </ul>
        </section>
      )}
      <section className="gcs-card" style={{ padding: 16 }}>
        <h2 className="gcs-pgBlock__title">
          <GcsIcon name="fa-solid fa-tags" />
          {t("tagsTitle")}
        </h2>
        <dl className="gcs-pgTagHelp">
          <dt>
            <code>{'{block="cheie"}'}</code>
          </dt>
          <dd>{t("tagBlock")}</dd>
          <dt>
            <code>{'{database="cheie"}'}</code>
          </dt>
          <dd>{t("tagDatabase")}</dd>
          <dt>
            <code>{"{{câmp}}"}</code>
          </dt>
          <dd>{t("tagField")}</dd>
        </dl>
        <p className="gcs-muted">
          <Link href="/admin/pages/blocks">{t("toBlocks")}</Link> · <Link href="/admin/appearance/templates">{t("toEditor")}</Link>
        </p>
      </section>
    </>
  );
}
