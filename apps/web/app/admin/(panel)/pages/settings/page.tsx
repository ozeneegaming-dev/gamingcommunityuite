import { PAGES_ACP, readPagesOptions } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { savePagesSettings } from "../actions";
import { Toggle } from "../_parts";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.settings"))("title") };
}

/**
 * ACP › Pagini › Setări: pagina de pornire și cuprinsul, afișarea (firimituri, „actualizat la”, pe pagină, ordinea
 * comentariilor, insigna NOU), trimiterile (pauza, notificările staff-ului și ale autorilor) și biblioteca media.
 * Permisiunile pe grupuri sunt în ACP › Grupuri; cele pe baze de date, în fișa fiecărei baze.
 */
export default async function AcpPagesSettings() {
  const { actor } = await requireAcpSection(PAGES_ACP.settings);
  const { settings, pagesAdmin } = services();
  const [t, o, tree] = await Promise.all([getTranslations("acp.pages.settings"), readPagesOptions(settings), pagesAdmin.tree(actor)]);
  const pages = tree.filter((n) => n.kind === "page");
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-gear" description={t("lead")}>
        {t("title")}
      </GcsAcpTitle>
      <section className="gcs-card" style={{ padding: 16, maxWidth: 860 }} data-testid="gcs-acp-pages-settings">
        <GcsActionForm action={savePagesSettings} submitLabel={t("save")} submitKind="save" keepOpen>
          <fieldset className="gcs-formSec">
            <legend>{t("secHome")}</legend>
            <label className="gcs-field">
              {t("homePage")}
              <select className="gcs-input" name="pages.home_page" defaultValue={o.homePage}>
                <option value={0}>{t("homeDirectory")}</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} — /pages/{p.path}
                  </option>
                ))}
              </select>
              <span className="gcs-field__hint">{t("homePageHint")}</span>
            </label>
            <Toggle name="pages.directory_folders" label={t("directoryFolders")} hint={t("directoryFoldersHint")} checked={o.directoryFolders} />
          </fieldset>
          <fieldset className="gcs-formSec">
            <legend>{t("secDisplay")}</legend>
            <Toggle name="pages.breadcrumbs" label={t("breadcrumbs")} checked={o.breadcrumbs} />
            <Toggle name="pages.show_updated" label={t("showUpdated")} checked={o.showUpdated} />
            <div className="gcs-formGrid gcs-formGrid--3">
              <label className="gcs-field">
                {t("recordsPerPage")}
                <input className="gcs-input" type="number" name="pages.records_per_page" min={5} max={100} defaultValue={o.recordsPerPage} />
                <span className="gcs-field__hint">{t("recordsPerPageHint")}</span>
              </label>
              <label className="gcs-field">
                {t("commentsPerPage")}
                <input className="gcs-input" type="number" name="pages.comments_per_page" min={5} max={100} defaultValue={o.commentsPerPage} />
              </label>
              <label className="gcs-field">
                {t("commentOrder")}
                <select className="gcs-input" name="pages.comment_order" defaultValue={o.commentOrder}>
                  <option value="oldest">{t("orders.oldest")}</option>
                  <option value="newest">{t("orders.newest")}</option>
                </select>
              </label>
              <label className="gcs-field">
                {t("newDays")}
                <input className="gcs-input" type="number" name="pages.new_days" min={0} max={90} defaultValue={o.newDays} />
                <span className="gcs-field__hint">{t("newDaysHint")}</span>
              </label>
            </div>
          </fieldset>
          <fieldset className="gcs-formSec">
            <legend>{t("secSubmissions")}</legend>
            <label className="gcs-field" style={{ maxWidth: 280 }}>
              {t("submitCooldown")}
              <input className="gcs-input" type="number" name="pages.submit_cooldown" min={0} max={86400} defaultValue={o.submitCooldown} />
              <span className="gcs-field__hint">{t("submitCooldownHint")}</span>
            </label>
            <Toggle name="pages.notify_staff" label={t("notifyStaff")} hint={t("notifyStaffHint")} checked={o.notifyStaff} />
            <Toggle name="pages.notify_author" label={t("notifyAuthor")} checked={o.notifyAuthor} />
          </fieldset>
          <fieldset className="gcs-formSec">
            <legend>{t("secMedia")}</legend>
            <label className="gcs-field" style={{ maxWidth: 280 }}>
              {t("mediaMaxMb")}
              <input className="gcs-input" type="number" name="pages.media_max_mb" min={1} max={200} defaultValue={o.mediaMaxMb} />
            </label>
          </fieldset>
        </GcsActionForm>
      </section>
      <section className="gcs-card" style={{ padding: 16, maxWidth: 860 }}>
        <h2 className="gcs-pgBlock__title">
          <GcsIcon name="fa-solid fa-user-shield" />
          {t("permsTitle")}
        </h2>
        <p className="gcs-muted">{t("permsHint")}</p>
        <p>
          <Link href="/admin/groups">{t("toGroups")}</Link> · <Link href="/admin/pages/databases">{t("toDatabases")}</Link> · <Link href="/admin/system/menu">{t("toMenu")}</Link>
        </p>
      </section>
    </>
  );
}
