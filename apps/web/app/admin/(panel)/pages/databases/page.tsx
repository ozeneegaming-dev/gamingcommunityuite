import { faFileImport, faPlus } from "@fortawesome/free-solid-svg-icons";
import { PAGES_ACP, PAGES_PRESETS, PAGES_PRESET_DEFS } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { createPagesDatabase, importPagesDatabase } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.databases"))("title") };
}

/**
 * ACP › Pagini › Baze de date: lista bazelor (pagina pe care stau, înregistrările, cele în așteptare, categoriile,
 * câmpurile), „Bază nouă” cu alegerea șablonului (Ghiduri, Regulamente servere, Config-uri, Recrutări, Goală) și
 * „Importă” un pachet descărcat. Fișa unei baze are tab-urile ei.
 */
export default async function AcpPagesDatabases() {
  const { actor } = await requireAcpSection(PAGES_ACP.databases);
  const { pagesAdmin, acp, db } = services();
  const [t, tp, format, list, folders, canEdit] = await Promise.all([
    getTranslations("acp.pages.databases"),
    getTranslations("pages.presets"),
    getFormatter(),
    pagesAdmin.databases(actor),
    db.pagesNode.findMany({ where: { kind: "folder" }, orderBy: { path: "asc" }, select: { id: true, path: true } }),
    acp.can(actor, PAGES_ACP.databases, "edit"),
  ]);
  const parentSelect = (
    <label className="gcs-field">
      {t("parent")}
      <select className="gcs-input" name="parentId" defaultValue="">
        <option value="">{t("noParent")}</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            /{f.path}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-database"
        description={t("lead")}
        actions={
          canEdit && (
            <>
              <GcsAcpEditPanel label={t("import")} buttonIcon={<GcsIconSvg icon={faFileImport} />} title={t("import")} testId="gcs-acp-db-import">
                <GcsActionForm action={importPagesDatabase} submitLabel={t("importSubmit")} submitKind="create">
                  <p className="gcs-muted gcs-acpHint">{t("importHint")}</p>
                  <GcsUploadInput name="file" title={t("import")} rules={UPLOAD_RULES.json(20)} required />
                  {parentSelect}
                </GcsActionForm>
              </GcsAcpEditPanel>
              <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} size="lg" testId="gcs-acp-db-new">
                <GcsActionForm action={createPagesDatabase} submitLabel={t("create")} submitKind="create">
                  <fieldset className="gcs-formSec">
                    <legend>{t("pickPreset")}</legend>
                    <div className="gcs-pgPresets" role="radiogroup" aria-label={t("pickPreset")}>
                      {PAGES_PRESETS.map((p, i) => (
                        <label key={p} className="gcs-pgPreset" data-testid={`gcs-acp-preset-${p}`}>
                          <input type="radio" name="preset" value={p} defaultChecked={i === 0} />
                          <GcsIcon name={PAGES_PRESET_DEFS[p].icon} className="gcs-pgPreset__icon" />
                          <span>
                            <strong>{tp(`${p}.name`)}</strong>
                            <small>{tp(`${p}.description`)}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="gcs-field">
                    {t("name")}
                    <input className="gcs-input" name="name" maxLength={80} placeholder={t("nameFromPreset")} />
                  </label>
                  {parentSelect}
                  <p className="gcs-muted gcs-acpHint">{t("createHint")}</p>
                </GcsActionForm>
              </GcsAcpEditPanel>
            </>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>
      <section className="gcs-card" style={{ overflow: "hidden" }}>
        {list.length === 0 ? (
          <p className="gcs-acpList__empty">
            <GcsIcon name="fa-solid fa-database" />
            {t("empty")}
          </p>
        ) : (
          <ul className="gcs-acpList" data-testid="gcs-acp-databases">
            {list.map((d) => (
              <li key={d.id} className="gcs-acpList__row" data-testid="gcs-acp-database" data-key={d.key}>
                <span className="gcs-acpList__main">
                  <GcsIcon name={d.icon ?? "fa-solid fa-database"} />
                  <span className="gcs-acpList__text">
                    <Link href={`/admin/pages/databases/${d.id}`} style={{ fontWeight: 700 }}>
                      {d.name}
                    </Link>
                    <span className="gcs-acpList__sub">
                      {d.node ? <code>/pages/{d.node.path}</code> : <span className="gcs-achChip">{t("noPage")}</span>}
                      {" · "}
                      {t("row", { records: format.number(d.recordsCount), categories: d.categories, fields: d.fields })}
                      {d.pending > 0 && (
                        <Link href={`/admin/pages/records?status=pending&db=${d.id}`} className="gcs-achChip gcs-achChip--acc">
                          {t("pending", { count: d.pending })}
                        </Link>
                      )}
                    </span>
                  </span>
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/admin/pages/databases/${d.id}`}>
                    <GcsIcon name="fa-solid fa-pen" />
                    {t("edit")}
                  </Link>
                  {d.node && (
                    <Link className="gcs-iconBtn" href={`/pages/${d.node.path}`} aria-label={t("view")} title={t("view")}>
                      <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
