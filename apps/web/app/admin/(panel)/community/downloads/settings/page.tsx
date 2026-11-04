import { DOWNLOAD_SETTING, DOWNLOADS_ACP, WATERMARK_POSITIONS } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpAppSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { saveDownloadSettings } from "../actions";
import { GcsDownloadImageField } from "../GcsDownloadAcpBits";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.downloads"))("settings.title") };
}

/**
 * ACP → Descărcări → Setări: pagina principală (casetele și categoriile lor), fișierele (mărimea implicită, spațiul total,
 * încărcările neterminate), capturile (watermark-ul, locul, opacitatea), linkurile (domeniile blocate, fără linkuri
 * directe) și RSS-ul. Limitele pe grup (mărimea, spațiul, linkurile, trimiterea în bloc) sunt în ACP → Grupuri.
 */
export default async function AcpDownloadSettings() {
  await requireAcpAppSection("downloads", DOWNLOADS_ACP.settings);
  const { downloads } = services();
  const [t, o, cats] = await Promise.all([getTranslations("acp.downloads.settings"), downloads.queries.options(), downloads.access.categories()]);
  const name = (k: string) => `setting:${k}`;
  const present = (...keys: string[]) => keys.map((k) => <input key={k} type="hidden" name={`present:${k}`} value="1" />);
  const toggle = (k: string, v: boolean, label: string, hint?: string) => (
    <label className="gcs-toggleRow">
      <span>{label}{hint && <small className="gcs-achHint">{hint}</small>}</span>
      <input type="checkbox" name={name(k)} defaultChecked={v} />
    </label>
  );
  const catChecks = (k: string, chosen: number[]) => (
    <details className="gcs-dlAcpDetails">
      <summary>{chosen.length === 0 ? t("allCategories") : t("someCategories", { count: chosen.length })}</summary>
      <div className="gcs-dlAcpChecks">
        {cats.map((c) => (
          <label key={c.id} className="gcs-check">
            <input type="checkbox" name={name(k)} value={c.id} defaultChecked={chosen.includes(c.id)} />
            {c.name}
          </label>
        ))}
      </div>
    </details>
  );
  const boxes = [
    { key: "featured", show: DOWNLOAD_SETTING.boxFeatured, value: o.boxes.featured.show, cats: null },
    { key: "new", show: DOWNLOAD_SETTING.boxNew, value: o.boxes.new.show, cats: [DOWNLOAD_SETTING.boxNewCategories, o.boxes.new.categories] as const },
    { key: "rated", show: DOWNLOAD_SETTING.boxRated, value: o.boxes.rated.show, cats: [DOWNLOAD_SETTING.boxRatedCategories, o.boxes.rated.categories] as const },
    { key: "downloaded", show: DOWNLOAD_SETTING.boxDownloaded, value: o.boxes.downloaded.show, cats: [DOWNLOAD_SETTING.boxDownloadedCategories, o.boxes.downloaded.categories] as const },
  ];
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-sliders" description={t("help")}>
        {t("title")}
      </GcsAcpTitle>
      <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-dls-index">
        <div className="gcs-acpPanel__head"><h2 id="gcs-dls-index" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-table-cells-large" /> {t("secIndex")}</h2></div>
        <GcsActionForm action={saveDownloadSettings.bind(null, "settings")} submitLabel={t("save")} submitKind="save" keepOpen>
          {present(DOWNLOAD_SETTING.boxFeatured, DOWNLOAD_SETTING.boxNew, DOWNLOAD_SETTING.boxRated, DOWNLOAD_SETTING.boxDownloaded, DOWNLOAD_SETTING.boxNewCategories, DOWNLOAD_SETTING.boxRatedCategories, DOWNLOAD_SETTING.boxDownloadedCategories, DOWNLOAD_SETTING.boxFeaturedCount, DOWNLOAD_SETTING.boxCount)}
          {boxes.map((b) => (
            <div key={b.key} className="gcs-dlAcpBoxRow">
              {toggle(b.show, b.value, t(`boxes.${b.key}`))}
              {b.cats ? catChecks(b.cats[0], [...b.cats[1]]) : (
                <label className="gcs-field gcs-field--inline">
                  {t("featuredCount")}
                  <input className="gcs-input" type="number" min={1} max={12} name={name(DOWNLOAD_SETTING.boxFeaturedCount)} defaultValue={o.boxes.featured.count} />
                </label>
              )}
            </div>
          ))}
          <label className="gcs-field">
            {t("boxCount")}
            <input className="gcs-input" type="number" min={3} max={24} name={name(DOWNLOAD_SETTING.boxCount)} defaultValue={o.boxes.count} />
          </label>
        </GcsActionForm>
      </GcsCard>

      <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-dls-files">
        <div className="gcs-acpPanel__head"><h2 id="gcs-dls-files" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-hard-drive" /> {t("secFiles")}</h2></div>
        <GcsActionForm action={saveDownloadSettings.bind(null, "settings")} submitLabel={t("save")} submitKind="save" keepOpen>
          {present(DOWNLOAD_SETTING.maxFileMb, DOWNLOAD_SETTING.totalQuotaGb, DOWNLOAD_SETTING.perPage, DOWNLOAD_SETTING.unfinishedHours)}
          <div className="gcs-formGrid gcs-formGrid--3">
            <label className="gcs-field">
              {t("maxFileMb")}
              <input className="gcs-input" type="number" min={1} max={51200} name={name(DOWNLOAD_SETTING.maxFileMb)} defaultValue={o.maxFileMb} data-testid="gcs-acp-dls-maxmb" />
              <span className="gcs-field__hint">{t("maxFileHint")}</span>
            </label>
            <label className="gcs-field">
              {t("totalQuotaGb")}
              <input className="gcs-input" type="number" min={0} max={100000} name={name(DOWNLOAD_SETTING.totalQuotaGb)} defaultValue={o.totalQuotaGb} />
              <span className="gcs-field__hint">{t("totalQuotaHint")}</span>
            </label>
            <label className="gcs-field">
              {t("perPage")}
              <input className="gcs-input" type="number" min={6} max={100} name={name(DOWNLOAD_SETTING.perPage)} defaultValue={o.perPage} />
            </label>
            <label className="gcs-field">
              {t("unfinishedHours")}
              <input className="gcs-input" type="number" min={1} max={720} name={name(DOWNLOAD_SETTING.unfinishedHours)} defaultValue={o.unfinishedHours} />
            </label>
          </div>
          <p className="gcs-field__hint">{t("groupLimits")} <Link href="/admin/groups">{t("groupsLink")}</Link></p>
        </GcsActionForm>
      </GcsCard>

      <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-dls-shots">
        <div className="gcs-acpPanel__head"><h2 id="gcs-dls-shots" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-stamp" /> {t("secWatermark")}</h2></div>
        <GcsActionForm action={saveDownloadSettings.bind(null, "settings")} submitLabel={t("save")} submitKind="save" keepOpen>
          {present(DOWNLOAD_SETTING.watermarkId, DOWNLOAD_SETTING.watermarkPosition, DOWNLOAD_SETTING.watermarkOpacity)}
          <div className="gcs-formGrid gcs-formGrid--3">
            <div className="gcs-field">
              {t("watermark")}
              <GcsDownloadImageField name={name(DOWNLOAD_SETTING.watermarkId)} kind="watermark" title={t("watermark")} initial={o.watermark.id ? { id: o.watermark.id, url: `/files/${o.watermark.id}` } : null} />
              <span className="gcs-field__hint">{t("watermarkHint")}</span>
            </div>
            <label className="gcs-field">
              {t("watermarkPosition")}
              <select className="gcs-input" name={name(DOWNLOAD_SETTING.watermarkPosition)} defaultValue={o.watermark.position}>
                {WATERMARK_POSITIONS.map((p) => <option key={p} value={p}>{t(`positions.${p}`)}</option>)}
              </select>
            </label>
            <label className="gcs-field">
              {t("watermarkOpacity")}
              <input className="gcs-input" type="number" min={10} max={100} name={name(DOWNLOAD_SETTING.watermarkOpacity)} defaultValue={o.watermark.opacity} />
            </label>
          </div>
        </GcsActionForm>
      </GcsCard>

      <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-dls-links">
        <div className="gcs-acpPanel__head"><h2 id="gcs-dls-links" className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-link-slash" /> {t("secLinks")}</h2></div>
        <GcsActionForm action={saveDownloadSettings.bind(null, "settings")} submitLabel={t("save")} submitKind="save" keepOpen>
          {present(DOWNLOAD_SETTING.preventDirect, DOWNLOAD_SETTING.rss, DOWNLOAD_SETTING.urlBlocklist)}
          {toggle(DOWNLOAD_SETTING.preventDirect, o.preventDirect, t("preventDirect"), t("preventDirectHint"))}
          {toggle(DOWNLOAD_SETTING.rss, o.rss, t("rss"), t("rssHint"))}
          <label className="gcs-field">
            {t("urlBlocklist")}
            <textarea className="gcs-input" rows={4} name={name(DOWNLOAD_SETTING.urlBlocklist)} defaultValue={o.urlBlocklist.join("\n")} placeholder={"example.com\nmirror.example.net"} />
            <span className="gcs-field__hint">{t("urlBlocklistHint")}</span>
          </label>
        </GcsActionForm>
      </GcsCard>
      <p className="gcs-field__hint">{t("paidLater")}</p>
    </>
  );
}
