import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { allowedBlocks, PAGES_ACP } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { JSONContent } from "@tiptap/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { deletePagesBlock, savePagesBlock } from "../actions";
import { GcsBlockEditor } from "./GcsBlockEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.blocks"))("title") };
}

/**
 * ACP › Pagini › Blocuri: blocurile reutilizabile, grupate pe categorii (conținut, HTML, șablon cu câmpuri), fiecare cu
 * eticheta lui (`{block="cheie"}`) și panoul de editare. Un bloc apare în constructor, în paginile HTML și ca widget.
 */
export default async function AcpPagesBlocks() {
  const { actor } = await requireAcpSection(PAGES_ACP.pages);
  const { pagesAdmin, acp } = services();
  const [t, list, editorBlocks, canEdit, canDelete] = await Promise.all([getTranslations("acp.pages.blocks"), pagesAdmin.blocks(actor), allowedBlocks(services(), actor), acp.can(actor, PAGES_ACP.pages, "edit"), acp.can(actor, PAGES_ACP.pages, "delete")]);
  const byCategory = new Map<string, typeof list>();
  for (const b of list) byCategory.set(b.category, [...(byCategory.get(b.category) ?? []), b]);

  const form = (b?: (typeof list)[number]) => (
    <GcsActionForm action={savePagesBlock.bind(null, b?.id ?? null)} submitLabel={b ? t("save") : t("create")} submitKind={b ? "save" : "create"}>
      <fieldset className="gcs-formSec">
        <legend>{t("secDetails")}</legend>
        <div className="gcs-formGrid gcs-formGrid--2">
          <label className="gcs-field">
            {t("name")}
            <input className="gcs-input" name="name" defaultValue={b?.name ?? ""} required minLength={2} maxLength={80} />
          </label>
          <label className="gcs-field">
            {t("key")}
            <input className="gcs-input" name="key" defaultValue={b?.key ?? ""} pattern="[a-z0-9-]{1,80}" placeholder={t("keyAuto")} />
          </label>
          <label className="gcs-field">
            {t("category")}
            <input className="gcs-input" name="category" defaultValue={b?.category ?? ""} maxLength={60} list="gcs-pg-block-cats" />
          </label>
          <label className="gcs-field">
            {t("description")}
            <input className="gcs-input" name="description" defaultValue={b?.description ?? ""} maxLength={300} />
          </label>
        </div>
      </fieldset>
      <GcsBlockEditor
        id={String(b?.id ?? "new")}
        kind={b?.kind ?? "content"}
        content={b?.kind === "content" ? ((b.contentJson as JSONContent | null) ?? null) : null}
        html={b ? (b.kind === "template" ? String(b.contentJson ?? "") : b.kind === "html" ? b.html : "") : ""}
        fields={b?.fields ?? []}
        values={b?.values ?? {}}
        blocks={editorBlocks}
      />
    </GcsActionForm>
  );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-cubes"
        description={t("lead")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} size="lg" testId="gcs-acp-block-new">
              {form()}
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>
      <datalist id="gcs-pg-block-cats">
        {[...byCategory.keys()].filter(Boolean).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {list.length === 0 ? (
        <p className="gcs-card gcs-acpList__empty">
          <GcsIcon name="fa-solid fa-cubes" />
          {t("empty")}
        </p>
      ) : (
        [...byCategory.entries()].map(([category, blocks]) => (
          <section key={category || "-"} className="gcs-card" aria-label={category || t("uncategorized")} style={{ overflow: "hidden" }}>
            <h2 className="gcs-acpList__group">{category || t("uncategorized")}</h2>
            <ul className="gcs-acpList" data-testid="gcs-acp-blocks">
              {blocks.map((b) => (
                <li key={b.id} className="gcs-acpList__row" data-testid="gcs-acp-block" data-block={b.key}>
                  <span className="gcs-acpList__main">
                    <GcsIcon name={b.kind === "html" ? "fa-solid fa-code" : b.kind === "template" ? "fa-solid fa-puzzle-piece" : "fa-solid fa-pen-to-square"} />
                    <span className="gcs-acpList__text">
                      <strong>{b.name}</strong>
                      <span className="gcs-acpList__sub">
                        <code>{`{block="${b.key}"}`}</code> · {t(`kinds.${b.kind === "html" || b.kind === "template" ? b.kind : "content"}`)}
                        {b.description && <> · {b.description}</>}
                      </span>
                    </span>
                  </span>
                  {canEdit && (
                    <GcsAcpEditPanel
                      title={b.name}
                      size="lg"
                      testId="gcs-acp-block-edit"
                      footer={
                        canDelete ? (
                          <GcsActionForm action={deletePagesBlock.bind(null, b.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("deleteConfirm", { name: b.name })}>
                            {null}
                          </GcsActionForm>
                        ) : undefined
                      }
                    >
                      {form(b)}
                    </GcsAcpEditPanel>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
