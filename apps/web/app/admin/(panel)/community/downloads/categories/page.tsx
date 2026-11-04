import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { GCS_RICH_FIELDS } from "@gcs/core";
import { CATEGORY_SORTS, DEFAULT_CATEGORY_OPTIONS, DOWNLOADS_ACP, TERMS_WHEN, VERSIONING_MODES, type GcsCategoryAdminRow } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpAppSection } from "@/lib/acp";
import { GcsIconInput } from "@/lib/ui-inputs";
import { services } from "@/lib/services";
import { GcsRichTextInput } from "../../../../(site)/_components/editor/GcsRichTextInput";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { copyCategory, deleteCategory, saveCategory } from "../actions";
import { GcsDownloadImageField } from "../GcsDownloadAcpBits";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.downloads"))("categories.title") };
}

/**
 * ACP → Descărcări → Categorii: arborele (iconița, numele, fișierele, VIP / clan / oprită) și panoul unei categorii, pe
 * secțiuni: de bază, afișare, fișiere permise, versiuni, capturi, moderare, comentarii și recenzii, termeni și mesaje,
 * topicul din forum, logul, câmpurile suplimentare. „Permisiuni” deschide matricea categoriei; „Copiază” și „Șterge”
 * (cu mutarea fișierelor) sunt în panou.
 */
export default async function AcpDownloadCategories() {
  const { actor } = await requireAcpAppSection("downloads", DOWNLOADS_ACP.categories);
  const { downloads, db, acp } = services();
  const [t, data, fields, forums, canDelete] = await Promise.all([
    getTranslations("acp.downloads.categories"),
    downloads.admin.categories(actor),
    db.downloadField.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, type: true } }),
    db.forum.findMany({ where: { type: { in: ["FORUM", "QA"] } }, orderBy: [{ parentId: "asc" }, { position: "asc" }], select: { id: true, name: true } }),
    acp.can(actor, DOWNLOADS_ACP.categories, "delete"),
  ]);
  const toggle = (name: string, value: boolean, label: string, hint?: string) => (
    <label className="gcs-toggleRow">
      <span>
        {label}
        {hint && <small className="gcs-achHint">{hint}</small>}
      </span>
      <input type="checkbox" name={name} defaultChecked={value} />
    </label>
  );
  const section = (legend: string, children: ReactNode) => (
    <fieldset className="gcs-formSec">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );

  const form = (c?: GcsCategoryAdminRow) => {
    const o = c?.options ?? DEFAULT_CATEGORY_OPTIONS;
    return (
      <>
        {section(
          t("secBasics"),
          <>
            <div className="gcs-formGrid gcs-formGrid--3">
              <label className="gcs-field">
                {t("name")}
                <input className="gcs-input" name="name" defaultValue={c?.name ?? ""} required maxLength={80} data-testid="gcs-acp-dlcat-name" />
              </label>
              <label className="gcs-field">
                {t("parent")}
                <select className="gcs-input" name="parentId" defaultValue={c?.parentId ?? ""}>
                  <option value="">{t("noParent")}</option>
                  {data.rows.filter((p) => p.id !== c?.id).map((p) => (
                    <option key={p.id} value={p.id}>{`${"— ".repeat(p.depth)}${p.name}`}</option>
                  ))}
                </select>
              </label>
              <div className="gcs-field">
                {t("icon")}
                <GcsIconInput name="icon" value={c?.icon ?? ""} testId="gcs-acp-dlcat-icon" />
              </div>
            </div>
            <div className="gcs-field">
              <span id={`gcs-dlcat-desc-${c?.id ?? "new"}`}>{t("description")}</span>
              <GcsRichTextInput name="description" initial={c?.descriptionJson ?? ""} allow={GCS_RICH_FIELDS.downloadText} maxLength={3000} compact labelledBy={`gcs-dlcat-desc-${c?.id ?? "new"}`} />
            </div>
            <div className="gcs-formGrid gcs-formGrid--3">
              <div className="gcs-field">
                {t("iconImage")}
                <GcsDownloadImageField name="iconId" kind="icon" title={t("iconImage")} initial={c?.iconId ? { id: c.iconId, url: `/files/${c.iconId}` } : null} />
              </div>
              <div className="gcs-field">
                {t("cover")}
                <GcsDownloadImageField name="coverId" kind="cover" title={t("cover")} initial={c?.coverId ? { id: c.coverId, url: `/files/${c.coverId}` } : null} />
              </div>
              {data.clans.length > 0 && (
                <label className="gcs-field">
                  {t("clan")}
                  <select className="gcs-input" name="clanId" defaultValue={c?.clanId ?? ""}>
                    <option value="">{t("noClan")}</option>
                    {data.clans.map((cl) => <option key={cl.id} value={cl.id}>{`[${cl.tag}] ${cl.name}`}</option>)}
                  </select>
                  <span className="gcs-field__hint">{t("clanHint")}</span>
                </label>
              )}
            </div>
            {toggle("enabled", c?.enabled ?? true, t("enabled"), t("enabledHint"))}
            {toggle("vipOnly", c?.vipOnly ?? false, t("vipOnly"), t("vipOnlyHint"))}
          </>,
        )}
        {section(
          t("secDisplay"),
          <label className="gcs-field">
            {t("sort")}
            <select className="gcs-input" name="opt:sort" defaultValue={o.sort}>
              {CATEGORY_SORTS.map((s) => <option key={s} value={s}>{t(`sorts.${s}`)}</option>)}
            </select>
          </label>,
        )}
        {section(
          t("secFiles"),
          <>
            {toggle("opt:anyExtension", o.extensions.length === 0, t("anyExtension"), t("anyExtensionHint"))}
            <label className="gcs-field">
              {t("extensions")}
              <textarea className="gcs-input" name="opt:extensions" rows={2} defaultValue={o.extensions.join(", ")} data-testid="gcs-acp-dlcat-extensions" />
              <span className="gcs-field__hint">{t("extensionsHint")}</span>
            </label>
            <div className="gcs-formGrid gcs-formGrid--3">
              <label className="gcs-field">
                {t("maxFileMb")}
                <input className="gcs-input" name="opt:maxFileMb" type="number" min={0} max={51200} defaultValue={o.maxFileMb ?? ""} placeholder={t("maxFileDefault")} />
                <span className="gcs-field__hint">{t("maxFileHint")}</span>
              </label>
            </div>
            {toggle("opt:multipleFiles", o.multipleFiles, t("multipleFiles"))}
          </>,
        )}
        {section(
          t("secVersions"),
          <>
            <div className="gcs-formGrid gcs-formGrid--3">
              <label className="gcs-field">
                {t("versioning")}
                <select className="gcs-input" name="opt:versioning" defaultValue={o.versioning}>
                  {VERSIONING_MODES.map((m) => <option key={m} value={m}>{t(`versioningModes.${m}`)}</option>)}
                </select>
              </label>
              <label className="gcs-field">
                {t("versionsToKeep")}
                <input className="gcs-input" name="opt:versionsToKeep" type="number" min={0} max={1000} defaultValue={o.versionsToKeep} />
                <span className="gcs-field__hint">{t("versionsToKeepHint")}</span>
              </label>
            </div>
            {toggle("opt:keepVersions", o.keepVersions, t("keepVersions"))}
            {toggle("opt:requireChangelog", o.requireChangelog, t("requireChangelog"))}
          </>,
        )}
        {section(
          t("secScreenshots"),
          <>
            {toggle("opt:screenshots", o.screenshots, t("screenshots"))}
            {toggle("opt:requireScreenshots", o.requireScreenshots, t("requireScreenshots"))}
            <div className="gcs-formGrid gcs-formGrid--3">
              <label className="gcs-field">
                {t("maxScreenshots")}
                <input className="gcs-input" name="opt:maxScreenshots" type="number" min={1} max={30} defaultValue={o.maxScreenshots} />
              </label>
              <label className="gcs-field">
                {t("screenshotMaxKb")}
                <input className="gcs-input" name="opt:screenshotMaxKb" type="number" min={0} max={102400} defaultValue={o.screenshotMaxKb} />
                <span className="gcs-field__hint">{t("screenshotMaxKbHint")}</span>
              </label>
            </div>
          </>,
        )}
        {section(
          t("secModeration"),
          <>
            {toggle("opt:approval", o.approval, t("approval"), t("approvalHint"))}
            {toggle("opt:tags", o.tags, t("tags"))}
            {toggle("opt:comments", o.comments, t("comments"))}
            {toggle("opt:commentsApproval", o.commentsApproval, t("commentsApproval"))}
            {toggle("opt:reviews", o.reviews, t("reviews"))}
            {toggle("opt:reviewNeedsDownload", o.reviewNeedsDownload, t("reviewNeedsDownload"))}
            {toggle("opt:reviewsApproval", o.reviewsApproval, t("reviewsApproval"))}
          </>,
        )}
        {section(
          t("secTerms"),
          <>
            <label className="gcs-field">
              {t("terms")}
              <textarea className="gcs-input" name="opt:terms" rows={3} maxLength={5000} defaultValue={o.terms} />
            </label>
            <label className="gcs-field">
              {t("termsWhen")}
              <select className="gcs-input" name="opt:termsWhen" defaultValue={o.termsWhen}>
                {TERMS_WHEN.map((w) => <option key={w} value={w}>{t(`termsWhenOptions.${w}`)}</option>)}
              </select>
            </label>
            <label className="gcs-field">
              {t("submitTerms")}
              <textarea className="gcs-input" name="opt:submitTerms" rows={3} maxLength={5000} defaultValue={o.submitTerms} />
            </label>
            <label className="gcs-field">
              {t("cannotView")}
              <textarea className="gcs-input" name="opt:cannotView" rows={2} maxLength={2000} defaultValue={o.cannotView} placeholder={t("messagePlaceholder")} />
            </label>
            <label className="gcs-field">
              {t("cannotDownload")}
              <textarea className="gcs-input" name="opt:cannotDownload" rows={2} maxLength={2000} defaultValue={o.cannotDownload} placeholder={t("cannotDownloadPlaceholder")} />
            </label>
          </>,
        )}
        {section(
          t("secTopic"),
          <>
            {toggle("opt:topicEnabled", o.forumTopic.enabled, t("topicEnabled"), t("topicEnabledHint"))}
            <div className="gcs-formGrid gcs-formGrid--3">
              <label className="gcs-field">
                {t("topicForum")}
                <select className="gcs-input" name="opt:topicForumId" defaultValue={o.forumTopic.forumId || ""}>
                  <option value="">{t("chooseForum")}</option>
                  {forums.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label className="gcs-field">
                {t("topicPrefix")}
                <input className="gcs-input" name="opt:topicPrefix" maxLength={40} defaultValue={o.forumTopic.prefix} placeholder="[Mod]" />
              </label>
              <label className="gcs-field">
                {t("topicSuffix")}
                <input className="gcs-input" name="opt:topicSuffix" maxLength={40} defaultValue={o.forumTopic.suffix} />
              </label>
            </div>
            {toggle("opt:topicDelete", o.forumTopic.deleteWithFile, t("topicDelete"))}
            {toggle("opt:topicScreenshot", o.forumTopic.screenshot, t("topicScreenshot"))}
          </>,
        )}
        {section(
          t("secLog"),
          <>
            {toggle("opt:logDownloads", o.logDownloads, t("logDownloads"))}
            <label className="gcs-field">
              {t("logDays")}
              <input className="gcs-input" name="opt:logDays" type="number" min={0} max={3650} defaultValue={o.logDays} />
              <span className="gcs-field__hint">{t("logDaysHint")}</span>
            </label>
            {toggle("opt:authorSeesLog", o.authorSeesLog, t("authorSeesLog"))}
          </>,
        )}
        {section(
          t("secFields"),
          fields.length === 0 ? (
            <p className="gcs-field__hint">
              {t("noFields")} <Link href="/admin/community/downloads/fields">{t("manageFields")}</Link>
            </p>
          ) : (
            <div className="gcs-dlAcpChecks">
              {fields.map((f) => (
                <label key={f.id} className="gcs-check">
                  <input type="checkbox" name="fieldIds" value={f.id} defaultChecked={c?.fieldIds.includes(f.id) ?? false} />
                  {f.name}
                </label>
              ))}
            </div>
          ),
        )}
      </>
    );
  };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-folder-tree"
        description={t("help")}
        actions={
          <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} titleIcon={<GcsIconSvg icon={faPlus} />} size="lg" testId="gcs-acp-dlcat-new">
            <GcsActionForm action={saveCategory.bind(null, null)} submitLabel={t("create")} submitKind="create">
              {form()}
            </GcsActionForm>
          </GcsAcpEditPanel>
        }
      >
        {t("title")}
      </GcsAcpTitle>
      {data.rows.length === 0 ? (
        <p className="gcs-card gcs-dlAcpEmpty" data-testid="gcs-acp-dlcat-empty"><GcsIcon name="fa-solid fa-folder-plus" /> {t("empty")}</p>
      ) : (
        <ul className="gcs-card gcs-dlAcpRows gcs-dlAcpTree" data-testid="gcs-acp-dlcats">
          {data.rows.map((c) => (
            <li key={c.id} className="gcs-dlAcpRow" style={{ paddingInlineStart: 14 + c.depth * 22 }} data-testid="gcs-acp-dlcat" data-category={c.id}>
              <span className="gcs-dlAcpRow__main">
                <GcsIcon name={c.icon || "fa-solid fa-folder"} />
                <strong>{c.name}</strong>
                {!c.enabled && <span className="gcs-dlStatus" data-status="hidden">{t("disabled")}</span>}
                {c.vipOnly && <span className="gcs-dlFlag" data-flag="vip"><GcsIcon name="fa-solid fa-crown" />VIP</span>}
                {c.clanId && <span className="gcs-dlFlag" data-flag="clan"><GcsIcon name="fa-solid fa-people-group" />{t("clanFlag")}</span>}
                {c.inherits && <span className="gcs-muted">{t("inherits")}</span>}
              </span>
              <span className="gcs-muted">{t("files", { count: c.filesCount })}</span>
              <span className="gcs-dlAcpRow__tools">
                <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/admin/permissions/downloads/${c.id}`} data-testid="gcs-acp-dlcat-perms">
                  <GcsIcon name="fa-solid fa-user-lock" />
                  {t("permissions")}
                </Link>
                <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/downloads/category/${c.id}-${c.slug}`}>
                  <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
                  {t("view")}
                </Link>
                <GcsAcpEditPanel
                  title={c.name}
                  titleIcon={<GcsIcon name={c.icon || "fa-solid fa-folder"} />}
                  size="lg"
                  testId="gcs-acp-dlcat-edit"
                  aside={
                    <GcsActionForm action={copyCategory.bind(null, c.id)} submitLabel={t("copy")} submitKind="create" variant="ghost" compact>
                      <label className="gcs-field">
                        {t("copyName")}
                        <input className="gcs-input" name="name" defaultValue={`${c.name} (2)`} maxLength={80} />
                      </label>
                    </GcsActionForm>
                  }
                  footer={
                    canDelete ? (
                      <GcsActionForm action={deleteCategory.bind(null, c.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("deleteConfirm")}>
                        {c.filesCount > 0 && (
                          <div className="gcs-formGrid gcs-formGrid--3">
                            <label className="gcs-field">
                              {t("moveTo")}
                              <select className="gcs-input" name="moveTo" defaultValue="">
                                <option value="">{t("moveNone")}</option>
                                {data.rows.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                              </select>
                            </label>
                            <label className="gcs-check">
                              <input type="checkbox" name="content" value="delete" />
                              {t("deleteContent")}
                            </label>
                          </div>
                        )}
                      </GcsActionForm>
                    ) : undefined
                  }
                >
                  <GcsActionForm action={saveCategory.bind(null, c.id)} submitLabel={t("save")} submitKind="save">
                    {form(c)}
                  </GcsActionForm>
                </GcsAcpEditPanel>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
