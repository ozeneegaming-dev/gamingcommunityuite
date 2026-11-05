import { DOWNLOADS_ACP, formatBytes } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireAcpAppSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.downloads"))("overview.title") };
}

/**
 * ACP → Comunitate → Descărcări: plăcile (publicate, în coadă, în carantină, descărcări, spațiu), starea antivirusului,
 * ultimele trimiteri și cele mai descărcate fișiere, cu scurtături spre coadă, categorii și setări.
 */
export default async function AcpDownloadsOverview() {
  const { actor } = await requireAcpAppSection("downloads", DOWNLOADS_ACP.overview);
  const [t, format, locale, data] = await Promise.all([getTranslations("acp.downloads"), getFormatter(), getLocale(), services().downloads.admin.overview(actor)]);
  const tiles = [
    { key: "approved", icon: "fa-solid fa-file-circle-check", value: data.counts.approved ?? 0, href: "/admin/community/downloads/files?filter=approved" },
    { key: "queue", icon: "fa-solid fa-hourglass-half", value: data.pendingVersions, href: "/admin/community/downloads/queue" },
    { key: "quarantine", icon: "fa-solid fa-shield-virus", value: data.infected, href: "/admin/community/downloads/antivirus" },
    { key: "downloads", icon: "fa-solid fa-download", value: data.downloads, href: "/admin/stats/downloads" },
    { key: "categories", icon: "fa-solid fa-folder-tree", value: data.categories, href: "/admin/community/downloads/categories" },
  ];
  const av = data.scanner;
  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-download"
        description={t("overview.help")}
        actions={
          <Link className="gcs-btn gcs-btn--ghost" href="/downloads">
            <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
            {t("overview.openSite")}
          </Link>
        }
      >
        {t("overview.title")}
      </GcsAcpTitle>
      <ul className="gcs-acpTiles gcs-sysTiles" data-testid="gcs-acp-downloads-tiles">
        {tiles.map((tile) => (
          <li key={tile.key} className="gcs-acpTile" data-tile={tile.key}>
            <Link href={tile.href} className="gcs-acpTile__inner">
              <span className="gcs-acpTile__icon" aria-hidden="true"><GcsIcon name={tile.icon} /></span>
              <span className="gcs-acpTile__value gcs-display">{format.number(tile.value)}</span>
              <span className="gcs-acpTile__label">{t(`overview.tiles.${tile.key}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="gcs-sysGrid">
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-dl-av">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-dl-av" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-shield-virus" /> {t("overview.antivirus")}</h2>
            <Link href="/admin/community/downloads/antivirus">{t("overview.manage")}</Link>
          </div>
          <p className="gcs-dlAvState" data-available={av.available ? "yes" : "no"} data-testid="gcs-acp-av-state">
            <GcsIcon name={av.available ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"} />
            {av.available ? t("antivirus.available", { engine: av.engine ?? "", signatures: av.signatures ?? "—" }) : t(`antivirus.reason.${av.reason ?? "unreachable"}`)}
          </p>
          <p className="gcs-muted">{t("overview.storage", { used: formatBytes(data.storage.used, locale), limit: data.storage.limit ? formatBytes(data.storage.limit, locale) : t("overview.unlimited") })}</p>
        </GcsCard>
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-dl-latest">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-dl-latest" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-clock-rotate-left" /> {t("overview.latest")}</h2>
            <Link href="/admin/community/downloads/files">{t("overview.all")}</Link>
          </div>
          {data.latest.length === 0 ? (
            <p className="gcs-muted">{t("overview.none")}</p>
          ) : (
            <ul className="gcs-dlAcpList">
              {await Promise.all(data.latest.map(async (f) => (
                <li key={f.id}>
                  <Link href={f.href}>{f.title}</Link>
                  <span className="gcs-dlStatus" data-status={f.status}>{t(`status.${f.status}`)}</span>
                  {f.author && <GcsMemberLink user={f.author} />}
                </li>
              )))}
            </ul>
          )}
        </GcsCard>
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-dl-top">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-dl-top" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-fire" /> {t("overview.top")}</h2>
            <Link href="/admin/stats/downloads">{t("overview.stats")}</Link>
          </div>
          {data.top.length === 0 ? (
            <p className="gcs-muted">{t("overview.none")}</p>
          ) : (
            <ol className="gcs-dlAcpList">
              {data.top.map((f) => (
                <li key={f.id}>
                  <Link href={f.href}>{f.title}</Link>
                  <span className="gcs-muted">{t("overview.downloadsN", { count: f.downloads })}</span>
                </li>
              ))}
            </ol>
          )}
        </GcsCard>
      </div>
    </>
  );
}
