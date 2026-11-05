import { formatBytes } from "@gcs/modules";
import { parseRef } from "@gcs/modules/slug";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsRelTime } from "../../../../_components/forum/GcsRelTime";
import { GcsPagination } from "../../../../_components/forum/GcsPagination";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("downloads.log"))("title") };
}

/** `/downloads/file/{id}-{slug}/log`: cine a descărcat fișierul și ce versiune (staff-ul, sau autorul dacă e permis). */
export default async function DownloadLogPage({ params, searchParams }: Props) {
  const { downloads } = services();
  const actor = await currentActor();
  if (!(await downloads.queries.canUseApp(actor))) notFound();
  const ref = parseRef((await params).ref);
  const raw = (await searchParams).page;
  const view = ref ? await downloads.queries.log(actor, ref.id, raw && /^\d{1,6}$/.test(raw) ? Number(raw) : 1) : null;
  if (!view) notFound();
  const [t, locale] = await Promise.all([getTranslations("downloads"), getLocale()]);
  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("title")} className="gcs-breadcrumb">
          <ol>
            <li><Link href="/downloads"><GcsIcon name="fa-solid fa-download" className="gcs-breadcrumb__home" />{t("title")}</Link></li>
            <li><Link href={view.file.href}>{view.file.title}</Link></li>
            <li aria-current="page">{t("log.title")}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title"><GcsIcon name="fa-solid fa-list-ol" className="gcs-hIcon" />{t("log.title")}</h1>
          <p className="gcs-pageHeader__desc">{t("log.count", { count: view.pagination.total })}</p>
        </div>
      </header>
      {view.rows.length === 0 ? (
        <div className="gcs-card gcs-dlEmpty"><p>{t("log.empty")}</p></div>
      ) : (
        <div className="gcs-card gcs-tableWrap">
          <table className="gcs-table gcs-dlLog" data-testid="gcs-download-log">
            <thead>
              <tr><th scope="col">{t("log.member")}</th><th scope="col">{t("log.version")}</th><th scope="col">{t("log.size")}</th><th scope="col">{t("log.when")}</th></tr>
            </thead>
            <tbody>
              {await Promise.all(view.rows.map(async (r) => (
                <tr key={r.id}>
                  <td>{r.user ? <GcsMemberLink user={r.user} /> : <span className="gcs-muted">{t("deletedMember")}</span>}</td>
                  <td>{r.version || "—"}</td>
                  <td>{formatBytes(r.size, locale)}</td>
                  <td><GcsRelTime at={r.at} /></td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      <GcsPagination pagination={view.pagination} href={(p) => (p > 1 ? `${view.file.href}/log?page=${p}` : `${view.file.href}/log`)} />
    </>
  );
}
