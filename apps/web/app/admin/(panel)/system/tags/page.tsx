import { faPlus, faSliders, faTag } from "@fortawesome/free-solid-svg-icons";
import { TAGS_ACP_SECTION } from "@gcs/modules";
import { GcsButton, GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { createTag, deleteTag, mergeTag, pruneTags, renameTag, saveTagsConfig } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.tags"))("title") };
}

type Props = { searchParams: Promise<{ q?: string; sort?: string; page?: string }> };

/**
 * ACP › Sistem › Descoperire › Etichete: toate etichetele cu numărul de topicuri (căutare, după folosire sau nume).
 * Panoul fiecăreia: redenumirea, unirea în altă etichetă, ștergerea; „Etichetă nouă” pentru lista închisă și
 * „Șterge nefolosite”. Panoul „Setări”: etichetele pornite pe tot site-ul și lista deschisă / închisă.
 */
export default async function AcpTagsPage({ searchParams }: Props) {
  const panel = await requireAcpSection(TAGS_ACP_SECTION);
  const sp = await searchParams;
  const { tagsAdmin, acp, db } = services();
  const sort = sp.sort === "name" ? "name" : "used";
  const [t, format, cfg, result, canEdit, canDelete, all] = await Promise.all([
    getTranslations("acp.tags"),
    getFormatter(),
    tagsAdmin.config(),
    tagsAdmin.list(panel.actor, { page: Number(sp.page) || 1, sort, ...(sp.q?.trim() ? { q: sp.q.trim().slice(0, 40) } : {}) }),
    acp.can(panel.actor, TAGS_ACP_SECTION, "edit"),
    acp.can(panel.actor, TAGS_ACP_SECTION, "delete"),
    db.tag.findMany({ orderBy: { slug: "asc" }, select: { id: true, slug: true }, take: 2000 }),
  ]);
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, page: undefined, ...patch }).filter(([, v]) => v) as [string, string][]);
    const qs = p.toString();
    return `/admin/system/tags${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-tags"
        description={t("description")}
        actions={
          canEdit && (
            <>
              <GcsAcpEditPanel label={t("settings")} buttonIcon={<GcsIconSvg icon={faSliders} />} title={t("settings")} titleIcon={<GcsIconSvg icon={faSliders} />} testId="gcs-tags-settings">
                <GcsActionForm action={saveTagsConfig} submitLabel={t("save")} submitKind="save">
                  <fieldset className="gcs-formSec">
                    <legend>{t("cfg.title")}</legend>
                    <label className="gcs-toggleRow">
                      <span>
                        {t("cfg.enabled")}
                        <small className="gcs-achHint">{t("cfg.enabledHint")}</small>
                      </span>
                      <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} />
                    </label>
                    <label className="gcs-field">
                      {t("cfg.mode")}
                      <select className="gcs-input" name="mode" defaultValue={cfg.mode}>
                        <option value="open">{t("cfg.open")}</option>
                        <option value="closed">{t("cfg.closed")}</option>
                      </select>
                      <span className="gcs-field__hint">{t("cfg.modeHint")}</span>
                    </label>
                  </fieldset>
                </GcsActionForm>
              </GcsAcpEditPanel>
              <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} titleIcon={<GcsIconSvg icon={faTag} />} testId="gcs-tags-new">
                <GcsActionForm action={createTag} submitLabel={t("create")} submitKind="create">
                  <label className="gcs-field">
                    {t("name")}
                    <input className="gcs-input" name="name" required minLength={2} maxLength={40} />
                    <span className="gcs-field__hint">{t("nameHint")}</span>
                  </label>
                </GcsActionForm>
              </GcsAcpEditPanel>
            </>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <div className={`gcs-sysSummary gcs-sysSummary--${cfg.enabled ? "ok" : "down"}`} data-testid="gcs-tags-summary">
        <GcsIcon name={cfg.enabled ? "fa-solid fa-circle-check" : "fa-solid fa-circle-minus"} />
        <span>
          <strong>{cfg.enabled ? (cfg.mode === "open" ? t("stateOpen") : t("stateClosed")) : t("stateOff")}</strong>
          <small>{t("counts", { total: all.length, unused: result.unused })}</small>
        </span>
        {canDelete && result.unused > 0 && (
          <span className="gcs-sysSummary__alerts">
            <GcsActionForm action={pruneTags} submitLabel={t("prune", { count: result.unused })} submitKind="delete" variant="ghost" compact confirm={t("pruneConfirm", { count: result.unused })}>
              {null}
            </GcsActionForm>
          </span>
        )}
      </div>

      <GcsCard className="gcs-memberList">
        <div className="gcs-memberList__head gcs-fileHead">
          <nav className="gcs-segLinks" aria-label={t("sort")}>
            {(["used", "name"] as const).map((s) => (
              <Link key={s} href={href({ sort: s === "used" ? undefined : s })} className={`gcs-segLink${sort === s ? " gcs-segLink--active" : ""}`} aria-current={sort === s ? "page" : undefined}>
                {t(`sorts.${s}`)}
              </Link>
            ))}
          </nav>
          <form method="get" role="search" className="gcs-contactSearch">
            {sort === "name" && <input type="hidden" name="sort" value="name" />}
            <input className="gcs-input" type="search" name="q" defaultValue={sp.q ?? ""} placeholder={t("search")} aria-label={t("search")} />
          </form>
        </div>
        {result.items.length === 0 ? (
          <p className="gcs-acpList__empty gcs-sysEmpty">
            <GcsIcon name="fa-solid fa-tags" /> {t("empty")}
          </p>
        ) : (
          <ul className="gcs-sysList gcs-tagList" data-testid="gcs-tags-list">
            {result.items.map((tag) => (
              <li key={tag.id} className="gcs-sysList__row" data-testid="gcs-tag-row" data-slug={tag.slug}>
                <span className="gcs-sysList__icon" aria-hidden="true">
                  <GcsIcon name="fa-solid fa-hashtag" />
                </span>
                <span className="gcs-sysList__body">
                  <strong>
                    <Link href={`/tags/${tag.slug}`}>{tag.name}</Link>
                  </strong>
                  <small>
                    <code>{tag.slug}</code> · {t("topics", { count: tag.topics })}
                  </small>
                </span>
                {canEdit && (
                  <GcsAcpEditPanel
                    title={`#${tag.name}`}
                    titleIcon={<GcsIconSvg icon={faTag} />}
                    testId="gcs-tag-panel"
                    footer={
                      canDelete ? (
                        <GcsActionForm action={deleteTag.bind(null, tag.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete", { count: tag.topics })}>
                          {null}
                        </GcsActionForm>
                      ) : undefined
                    }
                  >
                    <div className="gcs-bulkDraft">
                      <GcsActionForm action={renameTag.bind(null, tag.id)} submitLabel={t("save")} submitKind="save">
                        <fieldset className="gcs-formSec">
                          <legend>{t("renameTitle")}</legend>
                          <label className="gcs-field">
                            {t("name")}
                            <input className="gcs-input" name="name" required minLength={2} maxLength={40} defaultValue={tag.name} />
                            <span className="gcs-field__hint">{t("nameHint")}</span>
                          </label>
                        </fieldset>
                      </GcsActionForm>
                      <GcsActionForm action={mergeTag.bind(null, tag.id)} submitLabel={t("merge")} submitKind="approve" variant="ghost" confirm={t("mergeConfirm", { count: tag.topics })}>
                        <fieldset className="gcs-formSec">
                          <legend>{t("mergeTitle")}</legend>
                          <label className="gcs-field">
                            {t("mergeInto")}
                            <select className="gcs-input" name="intoId" required defaultValue="">
                              <option value="" disabled>
                                {t("pick")}
                              </option>
                              {all
                                .filter((o) => o.id !== tag.id)
                                .map((o) => (
                                  <option key={o.id} value={o.id}>
                                    #{o.slug}
                                  </option>
                                ))}
                            </select>
                            <span className="gcs-field__hint">{t("mergeHint")}</span>
                          </label>
                        </fieldset>
                      </GcsActionForm>
                    </div>
                  </GcsAcpEditPanel>
                )}
              </li>
            ))}
          </ul>
        )}
        {result.pages > 1 && (
          <nav className="gcs-memberList__pages" aria-label={t("pages")}>
            {result.page > 1 && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href({ page: String(result.page - 1) })}>{t("prev")}</Link>
              </GcsButton>
            )}
            <span className="gcs-memberList__page">{t("page", { page: result.page, pages: result.pages, total: format.number(result.total) })}</span>
            {result.page < result.pages && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href({ page: String(result.page + 1) })}>{t("next")}</Link>
              </GcsButton>
            )}
          </nav>
        )}
      </GcsCard>
    </>
  );
}
