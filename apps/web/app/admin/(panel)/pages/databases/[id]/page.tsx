import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { PAGES_ACP } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsIconInput } from "@/lib/ui-inputs";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { deletePagesCategory, deletePagesDatabase, savePagesCategory, savePagesDatabase } from "../../actions";
import { GcsPagesOrder } from "../../GcsPagesOrder";
import { GroupChecks, mediaImages, pagesGroups, Toggle } from "../../_parts";
import { GcsFieldsEditor } from "./GcsFieldsEditor";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> };
const TABS = ["details", "fields", "categories", "features", "permissions", "forum"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.database"))("title") };
}

/**
 * ACP › Pagini › Baze de date › o bază: tab-urile Detalii (nume, cheie, substantive, aspect, ordine), Câmpuri, Categorii
 * (listă + panou), Funcții (comentarii, note, trimiteri, aprobare, wiki, revizii, căutare, flux, RSS), Permisiuni
 * (grupurile pe acțiuni) și Forum (publicarea ca topic), plus „Descarcă” și „Șterge”.
 */
export default async function AcpPagesDatabase({ params, searchParams }: Props) {
  const { actor } = await requireAcpSection(PAGES_ACP.databases);
  const [{ id: raw }, sp] = await Promise.all([params, searchParams]);
  const id = Number(raw);
  const { pagesAdmin, acp, apps, db } = services();
  const d = Number.isSafeInteger(id) ? await pagesAdmin.database(actor, id) : null;
  if (!d) notFound();
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "details";
  const [t, groups, images, canEdit, canDelete, serversOn, forums] = await Promise.all([
    getTranslations("acp.pages.database"),
    pagesGroups(),
    mediaImages(),
    acp.can(actor, PAGES_ACP.databases, "edit"),
    acp.can(actor, PAGES_ACP.databases, "delete"),
    apps.enabled("servers"),
    db.forum.findMany({ where: { type: { in: ["FORUM", "QA"] } }, orderBy: [{ parentId: "asc" }, { position: "asc" }], select: { id: true, name: true } }),
  ]);
  const save = savePagesDatabase.bind(null, d.id);
  const nameInput = <input type="hidden" name="name" value={d.name} />;

  return (
    <>
      <GcsAcpTitle
        icon={d.icon ?? "fa-solid fa-database"}
        description={d.description || t("lead")}
        actions={
          <>
            <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href="/admin/pages/databases">
              <GcsIcon name="fa-solid fa-arrow-left" />
              {t("back")}
            </Link>
            {d.node && (
              <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/pages/${d.node.path}`}>
                <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
                {t("view")}
              </Link>
            )}
            <a className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/admin/pages/databases/${d.id}/export?records=1`} download>
              <GcsIcon name="fa-solid fa-download" />
              {t("export")}
            </a>
          </>
        }
      >
        {d.name}
      </GcsAcpTitle>
      {!d.node && (
        <p className="gcs-notice" role="status">
          {t("noPage")} <Link href="/admin/pages">{t("noPageLink")}</Link>
        </p>
      )}
      <nav className="gcs-segLinks" aria-label={t("tabs")}>
        {TABS.map((x) => (
          <Link key={x} href={`/admin/pages/databases/${d.id}?tab=${x}`} className={`gcs-segLink${x === tab ? " gcs-segLink--active" : ""}`} aria-current={x === tab ? "page" : undefined} data-testid={`gcs-acp-db-tab-${x}`}>
            {t(`tab.${x}`)}
          </Link>
        ))}
      </nav>

      <section className="gcs-card" style={{ padding: 16 }} data-testid={`gcs-acp-db-${tab}`}>
        {tab === "details" && (
          <GcsActionForm action={save} submitLabel={t("save")} submitKind="save">
            <fieldset className="gcs-formSec">
              <legend>{t("secIdentity")}</legend>
              <div className="gcs-formGrid gcs-formGrid--2">
                <label className="gcs-field">
                  {t("name")}
                  <input className="gcs-input" name="name" defaultValue={d.name} required minLength={2} maxLength={80} />
                </label>
                <label className="gcs-field">
                  {t("key")}
                  <input className="gcs-input" name="key" defaultValue={d.key} pattern="[a-z0-9-]{1,80}" required />
                  <span className="gcs-field__hint">{t("keyHint", { key: d.key })}</span>
                </label>
              </div>
              <label className="gcs-field">
                {t("description")}
                <textarea className="gcs-input" name="description" rows={2} defaultValue={d.description} maxLength={500} />
              </label>
              <div className="gcs-field" role="group" aria-label={t("icon")}>
                <span>{t("icon")}</span>
                <GcsIconInput name="icon" value={d.icon} />
              </div>
            </fieldset>
            <fieldset className="gcs-formSec">
              <legend>{t("secLanguage")}</legend>
              <p className="gcs-muted gcs-acpHint">{t("languageHint")}</p>
              <div className="gcs-formGrid gcs-formGrid--2">
                <label className="gcs-field">
                  {t("recordLabel")}
                  <input className="gcs-input" name="recordLabel" defaultValue={d.recordLabel} maxLength={40} placeholder={t("recordLabelPh")} />
                </label>
                <label className="gcs-field">
                  {t("recordPlural")}
                  <input className="gcs-input" name="recordPlural" defaultValue={d.recordPlural} maxLength={40} placeholder={t("recordPluralPh")} />
                </label>
              </div>
            </fieldset>
            <fieldset className="gcs-formSec">
              <legend>{t("secDisplay")}</legend>
              <div className="gcs-formGrid gcs-formGrid--2">
                <label className="gcs-field">
                  {t("indexMode")}
                  <select className="gcs-input" name="indexMode" defaultValue={d.indexMode}>
                    {(["all", "categories", "featured"] as const).map((v) => (
                      <option key={v} value={v}>
                        {t(`indexModes.${v}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gcs-field">
                  {t("listLayout")}
                  <select className="gcs-input" name="listLayout" defaultValue={d.listLayout}>
                    {(["list", "grid", "table"] as const).map((v) => (
                      <option key={v} value={v}>
                        {t(`layouts.${v}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gcs-field">
                  {t("sort")}
                  <select className="gcs-input" name="sort" defaultValue={d.sort}>
                    {(["newest", "updated", "title", "rating", "views", "comments"] as const).map((v) => (
                      <option key={v} value={v}>
                        {t(`sorts.${v}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gcs-field">
                  {t("perPage")}
                  <input className="gcs-input" type="number" name="perPage" min={5} max={100} defaultValue={d.perPage} />
                </label>
              </div>
            </fieldset>
          </GcsActionForm>
        )}

        {tab === "fields" && (
          <GcsActionForm action={save} submitLabel={t("save")} submitKind="save">
            {nameInput}
            <p className="gcs-muted gcs-acpHint">{t("fieldsHint")}</p>
            <GcsFieldsEditor initial={d.fields} serversOn={serversOn} />
          </GcsActionForm>
        )}

        {tab === "categories" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <p className="gcs-muted gcs-acpHint" style={{ margin: 0 }}>
                {d.useCategories ? t("categoriesHint") : t("categoriesOff")}
              </p>
              {canEdit && (
                <GcsAcpEditPanel label={t("addCategory")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("addCategory")} size="lg" testId="gcs-acp-cat-new">
                  <CategoryForm databaseId={d.id} categories={d.categories} groups={groups} images={images} t={t} />
                </GcsAcpEditPanel>
              )}
            </div>
            {d.categories.length === 0 ? (
              <p className="gcs-acpList__empty">{t("noCategories")}</p>
            ) : (
              <ul className="gcs-acpList" data-testid="gcs-acp-categories">
                {d.categories.map((c) => (
                  <li key={c.id} className="gcs-acpList__row" data-testid="gcs-acp-category">
                    <span className="gcs-acpList__main">
                      <GcsIcon name={c.icon ?? "fa-regular fa-folder"} />
                      <span className="gcs-acpList__text">
                        <strong>
                          {c.parentId ? "— " : ""}
                          {c.name}
                        </strong>
                        <span className="gcs-acpList__sub">
                          <code>{c.slug}</code> · {t("recordsCount", { count: c.recordsCount })}
                          {c.private && <span className="gcs-achChip">{t("private")}</span>}
                          {c.viewGroupIds.length > 0 && <span className="gcs-achChip">{t("restricted")}</span>}
                        </span>
                      </span>
                    </span>
                    {canEdit && (
                      <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <GcsPagesOrder id={c.id} parentId={null} siblings={d.categories.map((x) => x.id)} databaseId={d.id} />
                        <GcsAcpEditPanel
                          iconOnly
                          title={c.name}
                          size="lg"
                          testId="gcs-acp-cat-edit"
                          footer={
                            canDelete ? (
                              <GcsActionForm action={deletePagesCategory.bind(null, d.id, c.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("deleteCategoryConfirm", { name: c.name })}>
                                {null}
                              </GcsActionForm>
                            ) : undefined
                          }
                        >
                          <CategoryForm databaseId={d.id} category={c} categories={d.categories} groups={groups} images={images} t={t} />
                        </GcsAcpEditPanel>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "features" && (
          <GcsActionForm action={save} submitLabel={t("save")} submitKind="save">
            {nameInput}
            <fieldset className="gcs-formSec">
              <legend>{t("secContent")}</legend>
              <Toggle name="useCategories" label={t("f.useCategories")} hint={t("f.useCategoriesHint")} checked={d.useCategories} />
              <Toggle name="recordImage" label={t("f.recordImage")} checked={d.recordImage} />
              <Toggle name="revisions" label={t("f.revisions")} hint={t("f.revisionsHint")} checked={d.revisions} />
            </fieldset>
            <fieldset className="gcs-formSec">
              <legend>{t("secSubmissions")}</legend>
              <Toggle name="submissions" label={t("f.submissions")} hint={t("f.submissionsHint")} checked={d.submissions} />
              <Toggle name="approval" label={t("f.approval")} hint={t("f.approvalHint")} checked={d.approval} />
              <Toggle name="authorEdit" label={t("f.authorEdit")} checked={d.authorEdit} />
              <Toggle name="wiki" label={t("f.wiki")} hint={t("f.wikiHint")} checked={d.wiki} />
            </fieldset>
            <fieldset className="gcs-formSec">
              <legend>{t("secCommunity")}</legend>
              <Toggle name="comments" label={t("f.comments")} checked={d.comments} />
              <Toggle name="commentApproval" label={t("f.commentApproval")} checked={d.commentApproval} />
              <Toggle name="ratings" label={t("f.ratings")} checked={d.ratings} />
            </fieldset>
            <fieldset className="gcs-formSec">
              <legend>{t("secDiscovery")}</legend>
              <Toggle name="searchable" label={t("f.searchable")} checked={d.searchable} />
              <Toggle name="inStream" label={t("f.inStream")} checked={d.inStream} />
              <Toggle name="rss" label={t("f.rss")} hint={t("f.rssHint", { key: d.key })} checked={d.rss} />
            </fieldset>
          </GcsActionForm>
        )}

        {tab === "permissions" && (
          <GcsActionForm action={save} submitLabel={t("save")} submitKind="save">
            {nameInput}
            <p className="gcs-muted gcs-acpHint">{t("permissionsHint")}</p>
            <GroupChecks name="viewGroups" groups={groups} selected={d.viewGroupIds} legend={t("perm.view")} />
            <GroupChecks name="submitGroups" groups={groups} selected={d.submitGroupIds} legend={t("perm.submit")} />
            <GroupChecks name="commentGroups" groups={groups} selected={d.commentGroupIds} legend={t("perm.comment")} />
            <GroupChecks name="rateGroups" groups={groups} selected={d.rateGroupIds} legend={t("perm.rate")} />
          </GcsActionForm>
        )}

        {tab === "forum" && (
          <GcsActionForm action={save} submitLabel={t("save")} submitKind="save">
            {nameInput}
            <p className="gcs-muted gcs-acpHint">{t("forumHint")}</p>
            <label className="gcs-field" style={{ maxWidth: 420 }}>
              {t("forum")}
              <select className="gcs-input" name="forumId" defaultValue={d.forumId ?? ""}>
                <option value="">{t("noForum")}</option>
                {forums.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </GcsActionForm>
        )}
      </section>

      {canDelete && (
        <section className="gcs-card" style={{ padding: 16, maxWidth: 760 }}>
          <p className="gcs-muted" style={{ marginTop: 0 }}>
            {t("deleteHint", { count: d.recordsCount })}
          </p>
          <GcsActionForm action={deletePagesDatabase.bind(null, d.id)} submitLabel={t("deleteDb")} submitKind="delete" variant="ghost" confirm={t("deleteDbConfirm", { name: d.name })} redirectTo="/admin/pages/databases" />
        </section>
      )}
    </>
  );
}

type Cat = { id: number; name: string; slug: string; description: string; icon: string | null; color: string | null; parentId: number | null; private: boolean; viewGroupIds: number[]; coverMediaId: number | null };

/** Formularul unei categorii (panoul): numele, slug-ul, descrierea, iconița, culoarea, părintele, coperta, accesul. */
function CategoryForm({ databaseId, category: c, categories, groups, images, t }: { databaseId: number; category?: Cat; categories: Cat[]; groups: { id: number; name: string }[]; images: { id: number; title: string }[]; t: Awaited<ReturnType<typeof getTranslations>> }) {
  return (
    <GcsActionForm action={savePagesCategory.bind(null, databaseId, c?.id ?? null)} submitLabel={c ? t("save") : t("create")} submitKind={c ? "save" : "create"}>
      <fieldset className="gcs-formSec">
        <legend>{t("secCategory")}</legend>
        <div className="gcs-formGrid gcs-formGrid--2">
          <label className="gcs-field">
            {t("name")}
            <input className="gcs-input" name="name" defaultValue={c?.name ?? ""} required minLength={2} maxLength={80} />
          </label>
          <label className="gcs-field">
            {t("slug")}
            <input className="gcs-input" name="slug" defaultValue={c?.slug ?? ""} pattern="[a-z0-9-]{1,60}" placeholder={t("slugAuto")} />
          </label>
          <label className="gcs-field">
            {t("parentCategory")}
            <select className="gcs-input" name="parentId" defaultValue={c?.parentId ?? ""}>
              <option value="">{t("noParentCategory")}</option>
              {categories
                .filter((x) => x.id !== c?.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="gcs-field">
            {t("color")}
            <input className="gcs-input" type="color" name="color" defaultValue={c?.color ?? "#4fb3ff"} />
          </label>
        </div>
        <label className="gcs-field">
          {t("description")}
          <input className="gcs-input" name="description" defaultValue={c?.description ?? ""} maxLength={300} />
        </label>
        <div className="gcs-field" role="group" aria-label={t("icon")}>
          <span>{t("icon")}</span>
          <GcsIconInput name="icon" value={c?.icon ?? null} />
        </div>
        <label className="gcs-field">
          {t("cover")}
          <select className="gcs-input" name="mediaId" defaultValue={c?.coverMediaId ?? ""}>
            <option value="">{t("noCover")}</option>
            {images.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("secCategoryAccess")}</legend>
        <label className="gcs-toggleRow">
          <span>
            {t("private")}
            <small className="gcs-achHint">{t("privateHint")}</small>
          </span>
          <input type="checkbox" name="private" defaultChecked={c?.private ?? false} />
        </label>
        <p className="gcs-muted gcs-acpHint">{t("categoryGroupsHint")}</p>
        <div className="gcs-forumAudience">
          {groups.map((g) => (
            <label key={g.id} className="gcs-check">
              <input type="checkbox" name="viewGroups" value={g.id} defaultChecked={c?.viewGroupIds.includes(g.id) ?? false} />
              {g.name}
            </label>
          ))}
        </div>
      </fieldset>
    </GcsActionForm>
  );
}
