import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { DOWNLOAD_FIELD_LOCATIONS, DOWNLOAD_FIELD_TYPES, DOWNLOADS_ACP } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpAppSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { deleteField, saveField } from "../actions";
import { GcsDownloadOrderButtons } from "../GcsDownloadAcpBits";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.downloads"))("fields.title") };
}

const TYPE_ICONS: Record<string, string> = { text: "fa-solid fa-font", textarea: "fa-solid fa-align-left", url: "fa-solid fa-link", number: "fa-solid fa-hashtag", select: "fa-solid fa-list", checkbox: "fa-solid fa-square-check", member: "fa-solid fa-user-group", date: "fa-solid fa-calendar" };

/**
 * ACP → Descărcări → Câmpuri suplimentare: câmpurile completate la trimitere (ex. co-autori, versiunea jocului,
 * compatibilitatea), activate pe categorii; tipul, locul pe pagina fișierului, includerea în topicul din forum și
 * grupurile care îl văd / completează.
 */
export default async function AcpDownloadFields() {
  const { actor } = await requireAcpAppSection("downloads", DOWNLOADS_ACP.fields);
  const { downloads, db, acp } = services();
  const [t, rows, categories, groups, canDelete] = await Promise.all([
    getTranslations("acp.downloads.fields"),
    downloads.admin.fields(actor),
    db.downloadCategory.findMany({ orderBy: [{ parentId: "asc" }, { position: "asc" }], select: { id: true, name: true } }),
    db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, key: true } }),
    acp.can(actor, DOWNLOADS_ACP.fields, "delete"),
  ]);
  const form = (f?: (typeof rows)[number]) => (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("secField")}</legend>
        <div className="gcs-formGrid gcs-formGrid--3">
          <label className="gcs-field">
            {t("name")}
            <input className="gcs-input" name="name" defaultValue={f?.name ?? ""} required maxLength={60} data-testid="gcs-acp-dlfield-name" />
          </label>
          <label className="gcs-field">
            {t("type")}
            <select className="gcs-input" name="type" defaultValue={f?.type ?? "text"}>
              {DOWNLOAD_FIELD_TYPES.map((x) => <option key={x} value={x}>{t(`types.${x}`)}</option>)}
            </select>
          </label>
          <label className="gcs-field">
            {t("location")}
            <select className="gcs-input" name="location" defaultValue={f?.location ?? "sidebar"}>
              {DOWNLOAD_FIELD_LOCATIONS.map((x) => <option key={x} value={x}>{t(`locations.${x}`)}</option>)}
            </select>
          </label>
        </div>
        <label className="gcs-field">
          {t("description")}
          <input className="gcs-input" name="description" defaultValue={f?.description ?? ""} maxLength={300} />
        </label>
        <label className="gcs-field">
          {t("options")}
          <textarea className="gcs-input" name="options" rows={4} defaultValue={(f?.options ?? []).join("\n")} />
          <span className="gcs-field__hint">{t("optionsHint")}</span>
        </label>
        <label className="gcs-toggleRow"><span>{t("multiple")}<small className="gcs-achHint">{t("multipleHint")}</small></span><input type="checkbox" name="multiple" defaultChecked={f?.multiple ?? false} /></label>
        <label className="gcs-toggleRow"><span>{t("required")}</span><input type="checkbox" name="required" defaultChecked={f?.required ?? false} /></label>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("secCategories")}</legend>
        <div className="gcs-dlAcpChecks">
          {categories.map((c) => (
            <label key={c.id} className="gcs-check">
              <input type="checkbox" name="categoryIds" value={c.id} defaultChecked={f?.categories.some((x) => x.id === c.id) ?? false} />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("secTopic")}</legend>
        <label className="gcs-toggleRow"><span>{t("inTopic")}</span><input type="checkbox" name="inTopic" defaultChecked={f?.inTopic ?? false} /></label>
        <label className="gcs-field">
          {t("topicFormat")}
          <input className="gcs-input" name="topicFormat" defaultValue={f?.topicFormat ?? ""} maxLength={500} placeholder="{title}: {content}" />
        </label>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("secGroups")}</legend>
        <p className="gcs-field__hint">{t("groupsHint")}</p>
        <div className="gcs-formGrid gcs-formGrid--3">
          {(["viewGroups", "editGroups"] as const).map((key) => (
            <div key={key} className="gcs-field">
              {t(key)}
              <div className="gcs-dlAcpChecks">
                {groups.filter((g) => g.key !== "banned").map((g) => (
                  <label key={g.id} className="gcs-check">
                    <input type="checkbox" name={key} value={g.id} defaultChecked={f?.[key].includes(g.id) ?? false} />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
    </>
  );
  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-list-check"
        description={t("help")}
        actions={
          <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} titleIcon={<GcsIconSvg icon={faPlus} />} size="lg" testId="gcs-acp-dlfield-new">
            <GcsActionForm action={saveField.bind(null, null)} submitLabel={t("create")} submitKind="create">{form()}</GcsActionForm>
          </GcsAcpEditPanel>
        }
      >
        {t("title")}
      </GcsAcpTitle>
      {rows.length === 0 ? (
        <p className="gcs-card gcs-dlAcpEmpty">{t("empty")}</p>
      ) : (
        <ul className="gcs-card gcs-dlAcpRows" data-testid="gcs-acp-dlfields">
          {rows.map((f, i) => (
            <li key={f.id} className="gcs-dlAcpRow" data-testid="gcs-acp-dlfield">
              <GcsDownloadOrderButtons kind="field" ids={rows.map((r) => r.id)} index={i} name={f.name} />
              <span className="gcs-dlAcpRow__main">
                <GcsIcon name={TYPE_ICONS[f.type] ?? "fa-solid fa-font"} />
                <strong>{f.name}</strong>
                <span className="gcs-muted">{t(`types.${f.type}`)}</span>
                {f.required && <span className="gcs-dlFlag" data-flag="required">{t("required")}</span>}
                {(f.viewGroups.length > 0 || f.editGroups.length > 0) && <GcsIcon name="fa-solid fa-lock" />}
              </span>
              <span className="gcs-muted">{f.categories.length === 0 ? t("noCategories") : f.categories.map((c) => c.name).join(", ")}</span>
              <GcsAcpEditPanel
                title={f.name}
                titleIcon={<GcsIcon name={TYPE_ICONS[f.type] ?? "fa-solid fa-font"} />}
                size="lg"
                testId="gcs-acp-dlfield-edit"
                footer={canDelete ? <GcsActionForm action={deleteField.bind(null, f.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("deleteConfirm")}>{null}</GcsActionForm> : undefined}
              >
                <GcsActionForm action={saveField.bind(null, f.id)} submitLabel={t("save")} submitKind="save">{form(f)}</GcsActionForm>
              </GcsAcpEditPanel>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
