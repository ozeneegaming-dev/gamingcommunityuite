import { DOWNLOADS_ACP, formatBytes } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAcpAppSection } from "@/lib/acp";
import { GcsMemberLink, GcsNamedHtml } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsRelTime } from "../../../../../(site)/_components/forum/GcsRelTime";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { approveVersion, rejectVersion } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.downloads"))("queue.title") };
}

type Props = { searchParams: Promise<{ page?: string }> };

/**
 * ACP → Descărcări → Coada de aprobare: fișierele noi și versiunile noi care așteaptă, cele mai vechi primele. Panoul
 * arată descrierea, lista schimbărilor și fiecare fișier cu tipul real, sha256 și rezultatul antivirusului; jos,
 * „Aprobă” și „Respinge” (cu motivul trimis autorului).
 */
export default async function AcpDownloadQueue({ searchParams }: Props) {
  const { actor } = await requireAcpAppSection("downloads", DOWNLOADS_ACP.queue);
  const raw = (await searchParams).page;
  const [t, locale, data, canEdit] = await Promise.all([
    getTranslations("acp.downloads"),
    getLocale(),
    services().downloads.admin.queue(actor, raw && /^\d{1,5}$/.test(raw) ? Number(raw) : 1),
    services().acp.can(actor, DOWNLOADS_ACP.queue, "edit"),
  ]);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-hourglass-half" description={t("queue.help")}>
        {t("queue.title")}
      </GcsAcpTitle>
      {data.rows.length === 0 ? (
        <p className="gcs-card gcs-dlAcpEmpty" data-testid="gcs-acp-queue-empty"><GcsIcon name="fa-solid fa-circle-check" /> {t("queue.empty")}</p>
      ) : (
        <ul className="gcs-card gcs-dlAcpRows" data-testid="gcs-acp-queue">
          {await Promise.all(data.rows.map(async (r) => (
            <li key={r.versionId} className="gcs-dlAcpRow" data-testid="gcs-acp-queue-row" data-version={r.versionId}>
              <span className="gcs-dlAcpRow__main">
                <strong>{r.file.title}</strong>
                <span className="gcs-dlFlag" data-flag={r.isNew ? "new" : "version"}>{r.isNew ? t("queue.newFile") : t("queue.newVersion", { label: r.label || "—" })}</span>
                <span className="gcs-muted">{r.file.category.name}</span>
              </span>
              <span className="gcs-dlAcpRow__by">{r.author ? <GcsMemberLink user={r.author} /> : "—"} <GcsRelTime at={r.createdAt} /></span>
              <span className="gcs-dlAcpRow__scan">
                {r.assets.map((a) => (
                  <span key={a.id} className="gcs-dlScanChip" data-scan={a.state === "failed" ? "failed" : a.scan} title={a.name}>
                    <GcsIcon name={a.scan === "clean" ? "fa-solid fa-shield-halved" : a.scan === "infected" ? "fa-solid fa-shield-virus" : a.scan === "skipped" ? "fa-solid fa-user-check" : "fa-solid fa-hourglass-half"} />
                    {t(`scan.${a.state === "failed" ? "failed" : a.scan}`)}
                  </span>
                ))}
              </span>
              <GcsAcpEditPanel label={t("queue.review")} title={r.file.title} titleIcon={<GcsIcon name="fa-solid fa-file-zipper" />} size="lg" testId="gcs-acp-queue-review"
                footer={canEdit && r.status === "pending" ? (
                  <GcsActionForm action={rejectVersion.bind(null, r.versionId)} submitLabel={t("queue.reject")} submitKind="reject" variant="ghost" compact confirm={t("queue.rejectConfirm")}>
                    <label className="gcs-field">
                      {t("queue.reason")}
                      <input className="gcs-input" name="reason" maxLength={500} placeholder={t("queue.reasonPlaceholder")} />
                    </label>
                  </GcsActionForm>
                ) : undefined}
              >
                <fieldset className="gcs-formSec">
                  <legend>{t("queue.files")}</legend>
                  <ul className="gcs-dlAcpAssets">
                    {r.assets.map((a) => (
                      <li key={a.id} data-scan={a.scan}>
                        <strong>{a.name}</strong>
                        <span>{a.source === "link" ? a.url : `${a.kind.toUpperCase() || "?"} · ${formatBytes(a.size, locale)}`}</span>
                        <span className="gcs-dlScanChip" data-scan={a.state === "failed" ? "failed" : a.scan}>{t(`scan.${a.state === "failed" ? "failed" : a.scan}`)}{a.scanResult ? ` · ${a.scanResult}` : ""}</span>
                        {a.sha256 && <code className="gcs-dlHash">sha256 {a.sha256}</code>}
                      </li>
                    ))}
                  </ul>
                </fieldset>
                {r.file.summary && <p>{r.file.summary}</p>}
                {r.isNew ? <GcsNamedHtml html={r.file.descriptionHtml} className="gcs-richText gcs-postBody" /> : r.changelogHtml && <GcsNamedHtml html={r.changelogHtml} className="gcs-richText gcs-postBody" />}
                <p><Link href={r.file.href}>{t("queue.openPage")}</Link></p>
                {canEdit && r.status === "pending" && (
                  <GcsActionForm action={approveVersion.bind(null, r.versionId)} submitLabel={t("queue.approve")} submitKind="approve">
                    {null}
                  </GcsActionForm>
                )}
                {r.status === "scanning" && <p className="gcs-muted">{t("queue.scanning")}</p>}
              </GcsAcpEditPanel>
            </li>
          )))}
        </ul>
      )}
    </>
  );
}
