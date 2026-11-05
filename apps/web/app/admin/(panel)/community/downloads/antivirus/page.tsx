import { AV_ON_ERROR, DOWNLOAD_SETTING, DOWNLOADS_ACP, formatBytes } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireAcpAppSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsRelTime } from "../../../../../(site)/_components/forum/GcsRelTime";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { deleteQuarantined, releaseQuarantined, saveDownloadSettings } from "../actions";
import { GcsAntivirusTools } from "../GcsDownloadAcpBits";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.downloads"))("antivirus.title") };
}

/**
 * ACP → Descărcări → Antivirus: starea serviciului ClamAV (motorul, baza de semnături, de ce lipsește), testul cu
 * fișierul standard, rescanarea acum, numărul fișierelor pe rezultat, setările (pornit, adresa, limita scanării, ce se
 * întâmplă la o eroare, rescanările, carantina, atașamentele forumului) și carantina (eliberare / ștergere).
 */
export default async function AcpDownloadAntivirus() {
  const { actor } = await requireAcpAppSection("downloads", DOWNLOADS_ACP.antivirus);
  const { downloads, acp, edition } = services();
  const [t, format, locale, data, opts, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.downloads.antivirus"),
    getFormatter(),
    getLocale(),
    downloads.admin.antivirus(actor),
    downloads.queries.options(),
    acp.can(actor, DOWNLOADS_ACP.antivirus, "edit"),
    acp.can(actor, DOWNLOADS_ACP.antivirus, "delete"),
  ]);
  const s = data.status;
  const name = (k: string) => `setting:${k}`;
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-shield-virus" description={t("help")}>
        {t("title")}
      </GcsAcpTitle>
      <div className="gcs-sysGrid">
        <GcsCard as="section" className="gcs-acpPanel gcs-dlAvCard" data-available={s.available ? "yes" : "no"} aria-labelledby="gcs-av-status" data-testid="gcs-acp-av-status">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-av-status" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-heart-pulse" /> {t("status")}</h2>
          </div>
          <p className="gcs-dlAvState" data-available={s.available ? "yes" : "no"}>
            <GcsIcon name={s.available ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"} />
            {s.available ? t("available", { engine: s.engine ?? "", signatures: s.signatures ?? "—" }) : t(`reason.${edition === "lite" ? "unsupported" : (s.reason ?? "unreachable")}`)}
          </p>
          {s.signaturesAt && <p className="gcs-muted">{t("signaturesAt")} <GcsRelTime at={s.signaturesAt} /></p>}
          {!s.available && <p className="gcs-field__hint">{edition === "lite" ? t("liteHint") : t("manualHint")}</p>}
          {s.error && !s.available && edition !== "lite" && <p className="gcs-muted"><code>{s.error}</code></p>}
          {edition !== "lite" && <GcsAntivirusTools canEdit={canEdit} />}
        </GcsCard>
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-av-counts">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-av-counts" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-chart-simple" /> {t("counts")}</h2>
          </div>
          <dl className="gcs-dlAvCounts">
            {(["clean", "infected", "error", "skipped", "pending"] as const).map((k) => (
              <div key={k} data-scan={k}>
                <dt>{t(`scan.${k}`)}</dt>
                <dd>{format.number(data.counts[k] ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </GcsCard>
      </div>

      {canEdit && (
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-av-settings">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-av-settings" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-sliders" /> {t("settings")}</h2>
          </div>
          <GcsActionForm action={saveDownloadSettings.bind(null, "antivirus")} submitLabel={t("save")} submitKind="save" keepOpen>
            <input type="hidden" name={`present:${DOWNLOAD_SETTING.avEnabled}`} value="1" />
            <input type="hidden" name={`present:${DOWNLOAD_SETTING.avForumAttachments}`} value="1" />
            <label className="gcs-toggleRow"><span>{t("enabled")}<small className="gcs-achHint">{t("enabledHint")}</small></span><input type="checkbox" name={name(DOWNLOAD_SETTING.avEnabled)} defaultChecked={opts.av.enabled} data-testid="gcs-acp-av-enabled" /></label>
            <div className="gcs-formGrid gcs-formGrid--3">
              <label className="gcs-field">
                {t("address")}
                <input className="gcs-input" name={name(DOWNLOAD_SETTING.avAddress)} defaultValue={opts.av.address} placeholder="clamav:3310" />
                <span className="gcs-field__hint">{t("addressHint")}</span>
              </label>
              <label className="gcs-field">
                {t("maxScanMb")}
                <input className="gcs-input" type="number" min={10} max={4096} name={name(DOWNLOAD_SETTING.avMaxScanMb)} defaultValue={opts.av.maxScanMb} />
              </label>
              <label className="gcs-field">
                {t("onError")}
                <select className="gcs-input" name={name(DOWNLOAD_SETTING.avOnError)} defaultValue={opts.av.onError}>
                  {AV_ON_ERROR.map((o) => <option key={o} value={o}>{t(`onErrorOptions.${o}`)}</option>)}
                </select>
              </label>
              <label className="gcs-field">
                {t("rescanHours")}
                <input className="gcs-input" type="number" min={0} max={8760} name={name(DOWNLOAD_SETTING.avRescanHours)} defaultValue={opts.av.rescanHours} />
                <span className="gcs-field__hint">{t("rescanHint")}</span>
              </label>
              <label className="gcs-field">
                {t("quarantineDays")}
                <input className="gcs-input" type="number" min={0} max={3650} name={name(DOWNLOAD_SETTING.avQuarantineDays)} defaultValue={opts.av.quarantineDays} />
                <span className="gcs-field__hint">{t("quarantineHint")}</span>
              </label>
            </div>
            <label className="gcs-toggleRow"><span>{t("forumAttachments")}<small className="gcs-achHint">{t("forumAttachmentsHint")}</small></span><input type="checkbox" name={name(DOWNLOAD_SETTING.avForumAttachments)} defaultChecked={opts.av.forumAttachments} /></label>
          </GcsActionForm>
        </GcsCard>
      )}

      <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-av-quarantine" data-testid="gcs-acp-av-quarantine">
        <div className="gcs-acpPanel__head">
          <h2 id="gcs-av-quarantine" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-biohazard" /> {t("quarantine", { count: data.quarantine.length })}</h2>
        </div>
        {data.quarantine.length === 0 ? (
          <p className="gcs-muted">{t("quarantineEmpty")}</p>
        ) : (
          <ul className="gcs-dlAcpRows">
            {await Promise.all(data.quarantine.map(async (q) => (
              <li key={q.id} className="gcs-dlAcpRow" data-testid="gcs-acp-av-item">
                <span className="gcs-dlAcpRow__main">
                  <GcsIcon name="fa-solid fa-shield-virus" />
                  <strong>{q.name}</strong>
                  <code className="gcs-dlSig">{q.signature}</code>
                  <span className="gcs-muted">{formatBytes(q.size, locale)}</span>
                </span>
                <span className="gcs-dlAcpRow__by">
                  {q.uploader ? <GcsMemberLink user={q.uploader} /> : "—"} <GcsRelTime at={q.at} />
                  {q.file && <Link href={q.file.href}>{q.file.title}</Link>}
                </span>
                <span className="gcs-dlAcpRow__tools">
                  {canEdit && <GcsActionForm action={releaseQuarantined.bind(null, q.id)} submitLabel={t("release")} submitKind="save" variant="ghost" compact confirm={t("releaseConfirm")}>{null}</GcsActionForm>}
                  {canDelete && <GcsActionForm action={deleteQuarantined.bind(null, q.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("deleteConfirm")}>{null}</GcsActionForm>}
                </span>
              </li>
            )))}
          </ul>
        )}
      </GcsCard>
    </>
  );
}
