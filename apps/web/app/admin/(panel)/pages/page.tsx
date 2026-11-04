import { faFolderPlus, faPlus } from "@fortawesome/free-solid-svg-icons";
import { PAGES_ACP, type GcsPagesNodeRow } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsIconInput } from "@/lib/ui-inputs";
import { GcsAcpEditPanel } from "../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../_components/GcsActionForm";
import { GcsAcpTitle } from "../_components/GcsAcpTitle";
import { deletePagesNode, duplicatePagesNode, savePagesNode, setPagesHome } from "./actions";
import { GcsPagesOrder } from "./GcsPagesOrder";
import { mediaImages, pagesGroups } from "./_parts";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages"))("title") };
}

/**
 * ACP › Pagini › Pagini: arborele de foldere și pagini (ordinea între frați, cu săgeți), fiecare rând cu starea lui
 * (publicată, în meniu, pagina de pornire, baza de date), „Construiește” / „HTML”, „Vezi”, „Versiuni”, „Copiază” și
 * panoul de editare (detalii, acces, SEO, meniu). „Pagină nouă” și „Folder nou” în titlu.
 */
export default async function AcpPagesTree() {
  const { actor } = await requireAcpSection(PAGES_ACP.pages);
  const { pagesAdmin, settings, acp } = services();
  const [t, tree, groups, databases, images, home, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.pages"),
    pagesAdmin.tree(actor),
    pagesGroups(),
    services().db.pagesDatabase.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, node: { select: { id: true } } } }),
    mediaImages(),
    settings.get<number>("pages.home_page"),
    acp.can(actor, PAGES_ACP.pages, "edit"),
    acp.can(actor, PAGES_ACP.pages, "delete"),
  ]);
  const folders = tree.filter((n) => n.kind === "folder");
  const path = (n: GcsPagesNodeRow) => `/${n.path}`;
  const nodes = await Promise.all(tree.map((n) => pagesAdmin.node(actor, n.id)));
  const full = new Map(nodes.filter((n) => n !== null).map((n) => [n!.id, n!]));

  const form = (n: GcsPagesNodeRow | null, kind: "folder" | "page") => {
    const f = n ? full.get(n.id) : null;
    const viewSet = new Set(n?.viewGroupIds ?? []);
    const homeSet = new Set(n?.homeGroupIds ?? []);
    return (
      <GcsActionForm action={savePagesNode.bind(null, n?.id ?? null)} submitLabel={n ? t("save") : t("create")} submitKind={n ? "save" : "create"}>
        <input type="hidden" name="kind" value={kind} />
        <fieldset className="gcs-formSec">
          <legend>{t("secDetails")}</legend>
          <div className="gcs-formGrid gcs-formGrid--2">
            <label className="gcs-field">
              {t("titleField")}
              <input className="gcs-input" name="title" defaultValue={n?.title ?? ""} required minLength={2} maxLength={120} />
            </label>
            <label className="gcs-field">
              {t("slug")}
              <input className="gcs-input" name="slug" defaultValue={n?.slug ?? ""} pattern="[a-z0-9-]{1,80}" maxLength={80} placeholder={t("slugAuto")} />
              <span className="gcs-field__hint">{t("slugHint")}</span>
            </label>
          </div>
          <div className="gcs-formGrid gcs-formGrid--2">
            <label className="gcs-field">
              {t("parent")}
              <select className="gcs-input" name="parentId" defaultValue={n?.parentId ?? ""}>
                <option value="">{t("noParent")}</option>
                {folders
                  .filter((x) => x.id !== n?.id && !x.path.startsWith(`${n?.path ?? "\u0000"}/`))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {path(x)}
                    </option>
                  ))}
              </select>
            </label>
            <div className="gcs-field" role="group" aria-label={t("icon")}>
              <span>{t("icon")}</span>
              <GcsIconInput name="icon" value={n?.icon ?? null} testId={`gcs-pages-icon-${n?.id ?? "new"}`} />
            </div>
          </div>
          {kind === "page" && (
            <div className="gcs-formGrid gcs-formGrid--2">
              <label className="gcs-field">
                {t("contentType")}
                <select className="gcs-input" name="contentType" defaultValue={n?.contentType ?? "layout"} data-testid="gcs-pages-content-type">
                  <option value="layout">{t("types.layout")}</option>
                  <option value="html">{t("types.html")}</option>
                  <option value="database">{t("types.database")}</option>
                </select>
                <span className="gcs-field__hint">{t("contentTypeHint")}</span>
              </label>
              <label className="gcs-field">
                {t("database")}
                <select className="gcs-input" name="databaseId" defaultValue={n?.databaseId ?? ""}>
                  <option value="">—</option>
                  {databases
                    .filter((d) => !d.node || d.node.id === n?.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
          <label className="gcs-toggleRow">
            <span>
              {t("published")}
              <small className="gcs-achHint">{t("publishedHint")}</small>
            </span>
            <input type="checkbox" name="published" defaultChecked={n?.published ?? true} />
          </label>
          {kind === "page" && (
            <label className="gcs-toggleRow">
              <span>{t("showTitle")}</span>
              <input type="checkbox" name="showTitle" defaultChecked={f?.showTitle ?? true} />
            </label>
          )}
        </fieldset>
        <fieldset className="gcs-formSec">
          <legend>{t("secAccess")}</legend>
          <p className="gcs-muted gcs-acpHint">{t("accessHint")}</p>
          <div className="gcs-forumAudience">
            {groups.map((g) => (
              <label key={g.id} className="gcs-check">
                <input type="checkbox" name="viewGroups" value={g.id} defaultChecked={viewSet.has(g.id)} />
                {g.name}
              </label>
            ))}
          </div>
        </fieldset>
        {kind === "page" && (
          <>
            <fieldset className="gcs-formSec">
              <legend>{t("secMenu")}</legend>
              <label className="gcs-toggleRow">
                <span>
                  {t("inMenu")}
                  <small className="gcs-achHint">{t("inMenuHint")}</small>
                </span>
                <input type="checkbox" name="inMenu" defaultChecked={n?.inMenu ?? false} />
              </label>
              <p className="gcs-muted gcs-acpHint">{t("homeGroupsHint")}</p>
              <div className="gcs-forumAudience">
                {groups.map((g) => (
                  <label key={g.id} className="gcs-check">
                    <input type="checkbox" name="homeGroups" value={g.id} defaultChecked={homeSet.has(g.id)} />
                    {g.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="gcs-formSec">
              <legend>{t("secSeo")}</legend>
              <label className="gcs-field">
                {t("seoTitle")}
                <input className="gcs-input" name="seoTitle" defaultValue={f?.seoTitle ?? ""} maxLength={120} placeholder={n?.title ?? ""} />
              </label>
              <label className="gcs-field">
                {t("seoDescription")}
                <textarea className="gcs-input" name="seoDescription" rows={3} defaultValue={f?.seoDescription ?? ""} maxLength={300} />
              </label>
              <label className="gcs-field">
                {t("seoImage")}
                <select className="gcs-input" name="seoMediaId" defaultValue={f?.seoMediaId ?? ""}>
                  <option value="">{t("seoImageNone")}</option>
                  {images.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
                <span className="gcs-field__hint">{t("seoImageHint")}</span>
              </label>
              <label className="gcs-toggleRow">
                <span>{t("noindex")}</span>
                <input type="checkbox" name="noindex" defaultChecked={f?.noindex ?? false} />
              </label>
            </fieldset>
          </>
        )}
      </GcsActionForm>
    );
  };

  const children = (parentId: number | null) => tree.filter((n) => n.parentId === parentId);
  // Arborele ca listă, în ordinea paginii (fiecare nod urmat de copiii lui), cu adâncimea pentru indentare.
  const flat: { n: GcsPagesNodeRow; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const n of children(parentId)) {
      flat.push({ n, depth });
      if (depth < 8) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  const Row = ({ n, depth }: { n: GcsPagesNodeRow; depth: number }) => {
    const kids = children(n.id);
    return (
      <li className="gcs-acpList__row gcs-pgTree__row" style={{ paddingLeft: 12 + depth * 22 }} data-testid="gcs-acp-pages-node" data-node={n.id} data-path={n.path}>
        <span className="gcs-acpList__main">
          <GcsIcon name={n.icon ?? (n.kind === "folder" ? "fa-regular fa-folder" : n.contentType === "database" ? "fa-solid fa-database" : n.contentType === "html" ? "fa-solid fa-code" : "fa-regular fa-file-lines")} className="gcs-pgTree__icon" />
          <span className="gcs-acpList__text">
            <strong>{n.title}</strong>
            <span className="gcs-acpList__sub">
              <code>/pages/{n.path}</code>
              {!n.published && <span className="gcs-achChip">{t("chips.draft")}</span>}
              {n.inMenu && <span className="gcs-achChip">{t("chips.menu")}</span>}
              {home === n.id && <span className="gcs-achChip gcs-achChip--acc">{t("chips.home")}</span>}
              {n.homeGroupIds.length > 0 && <span className="gcs-achChip">{t("chips.homeGroups", { count: n.homeGroupIds.length })}</span>}
              {n.viewGroupIds.length > 0 && <span className="gcs-achChip">{t("chips.restricted")}</span>}
              {n.contentType === "database" && <span className="gcs-achChip">{databases.find((d) => d.id === n.databaseId)?.name ?? t("types.database")}</span>}
            </span>
          </span>
        </span>
        <span className="gcs-pgTree__actions">
          {canEdit && <GcsPagesOrder id={n.id} parentId={n.parentId} siblings={children(n.parentId).map((s) => s.id)} />}
          {n.kind === "page" && n.contentType !== "database" && canEdit && (
            <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/admin/pages/${n.id}/${n.contentType === "html" ? "html" : "builder"}`} data-testid="gcs-acp-pages-build">
              <GcsIcon name={n.contentType === "html" ? "fa-solid fa-code" : "fa-solid fa-pen-ruler"} />
              {n.contentType === "html" ? t("editHtml") : t("build")}
            </Link>
          )}
          {n.kind === "page" && n.contentType !== "database" && (
            <Link className="gcs-iconBtn" href={`/admin/pages/${n.id}/revisions`} aria-label={t("revisions")} title={t("revisions")}>
              <GcsIcon name="fa-solid fa-clock-rotate-left" />
            </Link>
          )}
          <Link className="gcs-iconBtn" href={`/pages/${n.path}`} aria-label={t("view")} title={t("view")}>
            <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
          </Link>
          {n.kind === "page" && canEdit && (
            <>
              <GcsActionForm action={setPagesHome.bind(null, n.id)} submitLabel={home === n.id ? t("unsetHome") : t("setHome")} submitIcon={<GcsIcon name={home === n.id ? "fa-solid fa-star" : "fa-regular fa-star"} />} variant="ghost" compact />
              <GcsActionForm action={duplicatePagesNode.bind(null, n.id)} submitLabel={t("duplicate")} submitIcon={<GcsIcon name="fa-regular fa-copy" />} variant="ghost" compact />
            </>
          )}
          {canEdit && (
            <GcsAcpEditPanel
              iconOnly
              title={n.title}
              titleIcon={<GcsIcon name={n.icon ?? "fa-regular fa-file-lines"} />}
              size="lg"
              testId="gcs-acp-pages-edit"
              footer={
                canDelete ? (
                  <GcsActionForm action={deletePagesNode.bind(null, n.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t(kids.length > 0 ? "deleteFolderFirst" : "deleteConfirm", { title: n.title })}>
                    {null}
                  </GcsActionForm>
                ) : undefined
              }
            >
              {form(n, n.kind)}
            </GcsAcpEditPanel>
          )}
        </span>
      </li>
    );
  };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-sitemap"
        description={t("lead")}
        actions={
          canEdit && (
            <>
              <GcsAcpEditPanel label={t("newFolder")} buttonIcon={<GcsIconSvg icon={faFolderPlus} />} title={t("newFolder")} size="lg" testId="gcs-acp-pages-new-folder">
                {form(null, "folder")}
              </GcsAcpEditPanel>
              <GcsAcpEditPanel label={t("newPage")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("newPage")} size="lg" testId="gcs-acp-pages-new">
                {form(null, "page")}
              </GcsAcpEditPanel>
            </>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>
      <section className="gcs-card" aria-label={t("title")} style={{ overflow: "hidden" }}>
        {tree.length === 0 ? (
          <p className="gcs-acpList__empty">
            <GcsIcon name="fa-solid fa-sitemap" />
            {t("empty")}
          </p>
        ) : (
          <ul className="gcs-acpList gcs-pgTree" data-testid="gcs-acp-pages-tree">
            {flat.map(({ n, depth }) => (
              <Row key={n.id} n={n} depth={depth} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
