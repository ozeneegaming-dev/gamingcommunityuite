import { DOWNLOADS_ACP, formatBytes, GCS_DOWNLOAD_ACP_FILTERS, type GcsDownloadAcpFilter } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAcpAppSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsPagination } from "../../../../../(site)/_components/forum/GcsPagination";
import { GcsRelTime } from "../../../../../(site)/_components/forum/GcsRelTime";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { deleteFile, setFileFlags } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.downloads"))("files.title") };
}

type Props = { searchParams: Promise<{ filter?: string; q?: string; page?: string }> };

/** ACP → Descărcări → Fișiere: toate intrările, pe stări, cu căutarea; recomandă, ascunde, șterge, deschide pagina. */
export default async function AcpDownloadFiles({ searchParams }: Props) {
  const { actor } = await requireAcpAppSection("downloads", DOWNLOADS_ACP.files);
  const sp = await searchParams;
  const filter: GcsDownloadAcpFilter = GCS_DOWNLOAD_ACP_FILTERS.includes(sp.filter as GcsDownloadAcpFilter) ? (sp.filter as GcsDownloadAcpFilter) : "all";
  const q = (sp.q ?? "").slice(0, 60);
  const { downloads, acp } = services();
  const [t, locale, data, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.downloads"),
    getLocale(),
    downloads.admin.files(actor, { filter, q, page: sp.page && /^\d{1,5}$/.test(sp.page) ? Number(sp.page) : 1 }),
    acp.can(actor, DOWNLOADS_ACP.files, "edit"),
    acp.can(actor, DOWNLOADS_ACP.files, "delete"),
  ]);
  const href = (p: number, f = filter) => {
    const params = new URLSearchParams();
    if (f !== "all") params.set("filter", f);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/community/downloads/files?${qs}` : "/admin/community/downloads/files";
  };
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-file-zipper" description={t("files.help")}>
        {t("files.title")}
      </GcsAcpTitle>
      <div className="gcs-dlAcpBar">
        <nav className="gcs-dlSorts" aria-label={t("files.filters")}>
          {GCS_DOWNLOAD_ACP_FILTERS.map((f) => (
            <Link key={f} href={href(1, f)} className="gcs-chip gcs-sweep" aria-current={f === filter ? "true" : undefined} data-testid={`gcs-acp-dl-filter-${f}`}>
              {t(`files.filter.${f}`)} <span className="gcs-muted">{data.counts[f]}</span>
            </Link>
          ))}
        </nav>
        <form action="/admin/community/downloads/files" role="search" className="gcs-dlSearch gcs-dlSearch--inline">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <label className="gcs-srOnly" htmlFor="gcs-acp-dl-q">{t("files.search")}</label>
          <input id="gcs-acp-dl-q" className="gcs-input" name="q" type="search" defaultValue={q} placeholder={t("files.search")} />
          <button type="submit" className="gcs-btn gcs-btn--ghost" aria-label={t("files.search")} title={t("files.search")}><GcsIcon name="fa-solid fa-magnifying-glass" /></button>
        </form>
      </div>
      {data.rows.length === 0 ? (
        <p className="gcs-card gcs-dlAcpEmpty">{t("files.empty")}</p>
      ) : (
        <ul className="gcs-card gcs-dlAcpRows" data-testid="gcs-acp-dl-files">
          {await Promise.all(data.rows.map(async (r) => (
            <li key={r.id} className="gcs-dlAcpRow" data-status={r.status}>
              <span className="gcs-dlAcpRow__main">
                <Link href={r.href}><strong>{r.title}</strong></Link>
                {r.version && <span className="gcs-dlVersion">{r.version}</span>}
                {r.featured && <span className="gcs-dlFlag" data-flag="featured"><GcsIcon name="fa-solid fa-star" /></span>}
                <span className="gcs-dlStatus" data-status={r.status}>{t(`status.${r.status}`)}</span>
                <span className="gcs-muted">{r.category.name}</span>
              </span>
              <span className="gcs-dlAcpRow__by">{r.author ? <GcsMemberLink user={r.author} /> : "—"} <GcsRelTime at={r.createdAt} /></span>
              <span className="gcs-muted">{formatBytes(r.size, locale)} · {t("overview.downloadsN", { count: r.downloads })}</span>
              <span className="gcs-dlAcpRow__tools">
                {canEdit && (r.status === "approved" || r.status === "hidden") && (
                  <>
                    <GcsActionForm action={setFileFlags.bind(null, r.id, { featured: !r.featured })} submitLabel={r.featured ? t("files.unfeature") : t("files.feature")} submitKind="save" variant="ghost" compact>{null}</GcsActionForm>
                    <GcsActionForm action={setFileFlags.bind(null, r.id, { hidden: r.status !== "hidden" })} submitLabel={r.status === "hidden" ? t("files.unhide") : t("files.hide")} submitKind="save" variant="ghost" compact>{null}</GcsActionForm>
                  </>
                )}
                {canDelete && (
                  <GcsActionForm action={deleteFile.bind(null, r.id)} submitLabel={t("files.delete")} submitKind="delete" variant="ghost" compact confirm={t("files.deleteConfirm", { title: r.title })}>{null}</GcsActionForm>
                )}
              </span>
            </li>
          )))}
        </ul>
      )}
      <GcsPagination pagination={data.pagination} href={(p) => href(p)} />
    </>
  );
}
