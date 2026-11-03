import { faSliders } from "@fortawesome/free-solid-svg-icons";
import { loadSearchConfig, SEARCH_ACP_SECTION, searchTerms } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { clearSearchLog, saveSearchConfig } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.search"))("title") };
}

type Props = { searchParams: Promise<{ days?: string }> };

/**
 * ACP › Sistem › Descoperire › Căutare: cum caută membrii (rezumatul setărilor) și ce caută: termenii cei mai căutați și
 * cei fără niciun rezultat (conținut care lipsește), pe 7 sau 30 de zile, din jurnalul anonim. Panoul „Setări”:
 * vizitatorii, lungimea minimă, limita pe minut, rezultatele pe pagină, ce caută implicit, vechimea maximă, jurnalul.
 */
export default async function AcpSearchPage({ searchParams }: Props) {
  const panel = await requireAcpSection(SEARCH_ACP_SECTION);
  const days = (await searchParams).days === "30" ? 30 : 7;
  const { settings, kv, acp } = services();
  const [t, format, cfg, log, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.search"),
    getFormatter(),
    loadSearchConfig(settings),
    searchTerms(kv, Date.now() - days * 86_400_000),
    acp.can(panel.actor, SEARCH_ACP_SECTION, "edit"),
    acp.can(panel.actor, SEARCH_ACP_SECTION, "delete"),
  ]);
  const zero = log.terms.filter((x) => x.zero > 0).sort((a, b) => b.zero - a.zero).slice(0, 15);
  const top = log.terms.slice(0, 15);
  const zeroTotal = log.terms.reduce((n, x) => n + x.zero, 0);

  const terms = (rows: typeof top, testId: string, showZero: boolean) =>
    rows.length === 0 ? (
      <p className="gcs-acpList__empty gcs-sysEmpty">{t("noTerms")}</p>
    ) : (
      <ol className="gcs-sysList gcs-statsTop" data-testid={testId}>
        {rows.map((x, i) => (
          <li key={x.q} className="gcs-sysList__row" data-term={x.q}>
            <span className="gcs-statsTop__rank">{i + 1}</span>
            <span className="gcs-sysList__body">
              <strong>
                <Link href={`/search?q=${encodeURIComponent(x.q)}`} target="_blank">
                  {x.q}
                </Link>
              </strong>
              <small>{format.relativeTime(new Date(x.lastAt))}</small>
            </span>
            <span className="gcs-statsTop__value">{showZero ? x.zero : x.count}</span>
          </li>
        ))}
      </ol>
    );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-magnifying-glass"
        description={t("description")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("settings")} variant="primary" buttonIcon={<GcsIconSvg icon={faSliders} />} title={t("settings")} titleIcon={<GcsIconSvg icon={faSliders} />} testId="gcs-search-settings">
              <GcsActionForm action={saveSearchConfig} submitLabel={t("save")} submitKind="save">
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secWho")}</legend>
                  <label className="gcs-toggleRow">
                    <span>
                      {t("cfg.guests")}
                      <small className="gcs-achHint">{t("cfg.guestsHint")}</small>
                    </span>
                    <input type="checkbox" name="guests" defaultChecked={cfg.guests} />
                  </label>
                  <div className="gcs-formGrid gcs-formGrid--2">
                    <label className="gcs-field">
                      {t("cfg.minLength")}
                      <input className="gcs-input" type="number" name="minLength" min={2} max={10} defaultValue={cfg.minLength} required />
                    </label>
                    <label className="gcs-field">
                      {t("cfg.perMinute")}
                      <input className="gcs-input" type="number" name="perMinute" min={5} max={120} defaultValue={cfg.perMinute} required />
                    </label>
                  </div>
                </fieldset>
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secResults")}</legend>
                  <label className="gcs-field">
                    {t("cfg.defaultType")}
                    <select className="gcs-input" name="defaultType" defaultValue={cfg.defaultType}>
                      <option value="topics">{t("cfg.topics")}</option>
                      <option value="posts">{t("cfg.posts")}</option>
                    </select>
                  </label>
                  <div className="gcs-formGrid gcs-formGrid--2">
                    <label className="gcs-field">
                      {t("cfg.perPage")}
                      <input className="gcs-input" type="number" name="perPage" min={0} max={50} defaultValue={cfg.perPage} required />
                      <span className="gcs-field__hint">{t("cfg.perPageHint")}</span>
                    </label>
                    <label className="gcs-field">
                      {t("cfg.maxAgeDays")}
                      <input className="gcs-input" type="number" name="maxAgeDays" min={0} max={3650} defaultValue={cfg.maxAgeDays} required />
                      <span className="gcs-field__hint">{t("cfg.maxAgeHint")}</span>
                    </label>
                  </div>
                </fieldset>
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secLog")}</legend>
                  <label className="gcs-toggleRow">
                    <span>
                      {t("cfg.logTerms")}
                      <small className="gcs-achHint">{t("cfg.logHint")}</small>
                    </span>
                    <input type="checkbox" name="logTerms" defaultChecked={cfg.logTerms} />
                  </label>
                </fieldset>
              </GcsActionForm>
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <div className="gcs-sysSummary gcs-sysSummary--ok" data-testid="gcs-search-summary">
        <GcsIcon name="fa-solid fa-magnifying-glass" />
        <span>
          <strong>{cfg.guests ? t("stateAll") : t("stateMembers")}</strong>
          <small>
            {[t("chipMin", { n: cfg.minLength }), t("chipRate", { n: cfg.perMinute }), cfg.maxAgeDays > 0 ? t("chipAge", { n: cfg.maxAgeDays }) : null, cfg.logTerms ? t("chipLog") : t("chipNoLog")].filter(Boolean).join(" · ")}
          </small>
        </span>
      </div>

      <div className="gcs-statsFilters gcs-card">
        <nav className="gcs-segLinks" aria-label={t("period")}>
          {[7, 30].map((d) => (
            <Link key={d} href={d === 7 ? "/admin/system/search" : "/admin/system/search?days=30"} className={`gcs-segLink${days === d ? " gcs-segLink--active" : ""}`} aria-current={days === d ? "page" : undefined}>
              {t("lastDays", { days: d })}
            </Link>
          ))}
        </nav>
        <span className="gcs-sysMuted" data-testid="gcs-search-total">
          {t("searches", { count: log.total })} · {t("zeroShare", { count: zeroTotal })}
        </span>
        {canDelete && log.total > 0 && (
          <GcsActionForm action={clearSearchLog} submitLabel={t("clear")} submitKind="reset" variant="ghost" compact confirm={t("clearConfirm")}>
            {null}
          </GcsActionForm>
        )}
      </div>

      <div className="gcs-sysGrid">
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-search-top">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-search-top" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-fire" /> {t("topTitle")}
            </h2>
          </div>
          {terms(top, "gcs-search-top", false)}
        </GcsCard>
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-search-zero">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-search-zero" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-circle-question" /> {t("zeroTitle")}
            </h2>
          </div>
          <p className="gcs-sysHint">{t("zeroHint")}</p>
          {terms(zero, "gcs-search-zero", true)}
        </GcsCard>
      </div>
    </>
  );
}
