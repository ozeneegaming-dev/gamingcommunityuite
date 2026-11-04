import { faFolderPlus } from "@fortawesome/free-solid-svg-icons";
import { PAGES_ACP } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsCopyText } from "../../../../(site)/_components/pages/GcsCopyText";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { deletePagesMediaFolder, deletePagesMediaOne, savePagesMediaFolder, savePagesMediaItem } from "../actions";
import { GcsMediaUpload } from "./GcsMediaUpload";

type Props = { searchParams: Promise<{ folder?: string; q?: string; page?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.media"))("title") };
}

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * ACP › Pagini › Media: biblioteca de fișiere a paginilor, cu foldere (calea până la folderul deschis), căutare, grila
 * de miniaturi și „Încarcă fișiere” (mai multe odată). Un fișier deschis arată adresa lui de copiat, titlul, textul
 * alternativ, folderul și „Șterge”.
 */
export default async function AcpPagesMedia({ searchParams }: Props) {
  const { actor } = await requireAcpSection(PAGES_ACP.media);
  const sp = await searchParams;
  const folderId = Number(sp.folder) || null;
  const q = (sp.q ?? "").slice(0, 60);
  const { pagesAdmin, acp, settings } = services();
  const [t, view, folders, canEdit, canDelete, maxMb] = await Promise.all([
    getTranslations("acp.pages.media"),
    pagesAdmin.media(actor, { folderId, q, page: Number(sp.page) || 1 }),
    pagesAdmin.mediaFolders(actor),
    acp.can(actor, PAGES_ACP.media, "edit"),
    acp.can(actor, PAGES_ACP.media, "delete"),
    settings.get<number>("pages.media_max_mb"),
  ]);
  const folderSelect = (selected: number | null, exclude?: number) => (
    <label className="gcs-field">
      {t("folder")}
      <select className="gcs-input" name="folderId" defaultValue={selected ?? ""}>
        <option value="">{t("root")}</option>
        {folders
          .filter((f) => f.id !== exclude)
          .map((f) => (
            <option key={f.id} value={f.id}>
              {f.path}
            </option>
          ))}
      </select>
    </label>
  );
  const parentSelect = (selected: number | null, exclude?: number) => (
    <label className="gcs-field">
      {t("parentFolder")}
      <select className="gcs-input" name="parentId" defaultValue={selected ?? ""}>
        <option value="">{t("root")}</option>
        {folders
          .filter((f) => f.id !== exclude)
          .map((f) => (
            <option key={f.id} value={f.id}>
              {f.path}
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-photo-film"
        description={t("lead", { mb: maxMb })}
        actions={
          canEdit && (
            <>
              <GcsAcpEditPanel label={t("newFolder")} buttonIcon={<GcsIconSvg icon={faFolderPlus} />} title={t("newFolder")} testId="gcs-acp-media-folder-new">
                <GcsActionForm action={savePagesMediaFolder.bind(null, null)} submitLabel={t("create")} submitKind="create">
                  <label className="gcs-field">
                    {t("folderName")}
                    <input className="gcs-input" name="name" required maxLength={60} />
                  </label>
                  {parentSelect(view.folder?.id ?? null)}
                </GcsActionForm>
              </GcsAcpEditPanel>
              <GcsMediaUpload folderId={view.folder?.id ?? null} maxMb={maxMb} />
            </>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <div className="gcs-pgMediaBar">
        <nav className="gcs-breadcrumb" aria-label={t("path")}>
          <ol>
            <li>
              <Link href="/admin/pages/media">
                <GcsIcon name="fa-solid fa-photo-film" className="gcs-breadcrumb__home" />
                {t("root")}
              </Link>
            </li>
            {view.crumbs.map((c, i) => (
              <li key={c.id} aria-current={i === view.crumbs.length - 1 ? "page" : undefined}>
                {i === view.crumbs.length - 1 ? c.name : <Link href={`/admin/pages/media?folder=${c.id}`}>{c.name}</Link>}
              </li>
            ))}
          </ol>
        </nav>
        <form method="get" action="/admin/pages/media" role="search" className="gcs-pgMediaBar__search">
          <input className="gcs-input" type="search" name="q" defaultValue={q} maxLength={60} placeholder={t("search")} aria-label={t("search")} />
        </form>
        {view.folder && canEdit && (
          <GcsAcpEditPanel
            label={t("editFolder")}
            title={view.folder.name}
            footer={
              canDelete ? (
                <GcsActionForm action={deletePagesMediaFolder.bind(null, view.folder.id)} submitLabel={t("deleteFolder")} submitKind="delete" variant="ghost" compact confirm={t("deleteFolderConfirm")} redirectTo="/admin/pages/media">
                  {null}
                </GcsActionForm>
              ) : undefined
            }
          >
            <GcsActionForm action={savePagesMediaFolder.bind(null, view.folder.id)} submitLabel={t("save")} submitKind="save">
              <label className="gcs-field">
                {t("folderName")}
                <input className="gcs-input" name="name" required maxLength={60} defaultValue={view.folder.name} />
              </label>
              {parentSelect(view.folder.parentId, view.folder.id)}
            </GcsActionForm>
          </GcsAcpEditPanel>
        )}
      </div>

      {view.folders.length === 0 && view.items.length === 0 ? (
        <p className="gcs-card gcs-acpList__empty">
          <GcsIcon name="fa-regular fa-images" />
          {q ? t("noResults", { q }) : t("empty")}
        </p>
      ) : (
        <ul className="gcs-pgMedia" data-testid="gcs-acp-media">
          {view.folders.map((f) => (
            <li key={`f${f.id}`} className="gcs-card gcs-pgMedia__item gcs-pgMedia__item--folder">
              <Link href={`/admin/pages/media?folder=${f.id}`} className="gcs-pgMedia__thumb">
                <GcsIcon name="fa-solid fa-folder" />
              </Link>
              <span className="gcs-pgMedia__name">{f.name}</span>
              <small className="gcs-muted">{t("folderCount", { items: f.items, folders: f.children })}</small>
            </li>
          ))}
          {view.items.map((m) => (
            <li key={m.id} className="gcs-card gcs-pgMedia__item" data-testid="gcs-acp-media-item">
              <span className="gcs-pgMedia__thumb">{m.isImage ? <img src={m.url} alt={m.alt || m.title} loading="lazy" /> : <GcsIcon name="fa-regular fa-file" />}</span>
              <span className="gcs-pgMedia__name" title={m.filename}>
                {m.title}
              </span>
              <small className="gcs-muted">
                {sizeText(m.size)}
                {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
              </small>
              <span className="gcs-pgMedia__tools">
                <GcsCopyText text={m.url} label={t("copyUrl")} />
                {canEdit && (
                  <GcsAcpEditPanel
                    iconOnly
                    title={m.title}
                    testId="gcs-acp-media-edit"
                    footer={
                      canDelete ? (
                        <GcsActionForm action={deletePagesMediaOne.bind(null, m.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("deleteConfirm")}>
                          {null}
                        </GcsActionForm>
                      ) : undefined
                    }
                  >
                    {m.isImage && <img src={m.url} alt="" className="gcs-pgMedia__preview" />}
                    <p className="gcs-muted gcs-acpHint">
                      <code>{m.url}</code> · {m.filename} · {m.mime}
                    </p>
                    <GcsActionForm action={savePagesMediaItem.bind(null, m.id)} submitLabel={t("save")} submitKind="save">
                      <label className="gcs-field">
                        {t("itemTitle")}
                        <input className="gcs-input" name="title" required maxLength={120} defaultValue={m.title} />
                      </label>
                      <label className="gcs-field">
                        {t("alt")}
                        <input className="gcs-input" name="alt" maxLength={300} defaultValue={m.alt} />
                        <span className="gcs-field__hint">{t("altHint")}</span>
                      </label>
                      {folderSelect(m.folderId)}
                    </GcsActionForm>
                  </GcsAcpEditPanel>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.pagination.pages > 1 && (
        <p className="gcs-acpList__more">
          {view.pagination.page > 1 && <Link href={`/admin/pages/media?${new URLSearchParams({ ...(folderId ? { folder: String(folderId) } : {}), ...(q ? { q } : {}), page: String(view.pagination.page - 1) })}`}>{t("prev")}</Link>}{" "}
          {view.pagination.page < view.pagination.pages && <Link href={`/admin/pages/media?${new URLSearchParams({ ...(folderId ? { folder: String(folderId) } : {}), ...(q ? { q } : {}), page: String(view.pagination.page + 1) })}`}>{t("next")}</Link>}
        </p>
      )}
    </>
  );
}
