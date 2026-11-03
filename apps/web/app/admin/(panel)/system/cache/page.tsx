import { CACHE_ACP_SECTION } from "@gcs/modules";
import { GcsSqlKv } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { clearAllCache, clearCacheArea, clearCacheTag } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.cache"))("title") };
}

/**
 * ACP › Sistem › Cache: zonele cache-ului (setări, permisiuni, teme, meniu, statistici…) cu numărul de chei și golirea
 * fiecăreia, tag-urile (invalidarea lor, ca după o editare), „Golește tot” și ultimele goliri din jurnal. Golirea nu
 * pierde date: paginile recitesc din baza de date.
 */
export default async function AcpCachePage() {
  const panel = await requireAcpSection(CACHE_ACP_SECTION);
  const { cacheAdmin, acp, kv } = services();
  const [t, format, overview, recent, canEdit] = await Promise.all([
    getTranslations("acp.cache"),
    getFormatter(),
    cacheAdmin.overview(kv instanceof GcsSqlKv ? "sql" : "redis"),
    cacheAdmin.recentClears(),
    acp.can(panel.actor, CACHE_ACP_SECTION, "edit"),
  ]);
  const areaLabel = (area: string) => (t.has(`areas.${area}`) ? t(`areas.${area}`) : null);

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-bolt"
        description={t("description")}
        actions={
          canEdit && (
            <GcsActionForm action={clearAllCache} submitLabel={t("clearAll")} submitKind="reset" compact confirm={t("clearAllConfirm")}>
              {null}
            </GcsActionForm>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <ul className="gcs-acpTiles gcs-sysTiles" data-testid="gcs-cache-tiles">
        <li className="gcs-acpTile">
          <div className="gcs-acpTile__inner">
            <span className="gcs-acpTile__icon" aria-hidden="true">
              <GcsIcon name="fa-solid fa-key" />
            </span>
            <span className="gcs-acpTile__value gcs-display" data-testid="gcs-cache-keys">
              {format.number(overview.keys)}
            </span>
            <span className="gcs-acpTile__label">{t("keys")}</span>
          </div>
        </li>
        <li className="gcs-acpTile">
          <div className="gcs-acpTile__inner">
            <span className="gcs-acpTile__icon" aria-hidden="true">
              <GcsIcon name="fa-solid fa-layer-group" />
            </span>
            <span className="gcs-acpTile__value gcs-display">{format.number(overview.areas.length)}</span>
            <span className="gcs-acpTile__label">{t("areasCount")}</span>
          </div>
        </li>
        <li className="gcs-acpTile">
          <div className="gcs-acpTile__inner">
            <span className="gcs-acpTile__icon" aria-hidden="true">
              <GcsIcon name="fa-solid fa-database" />
            </span>
            <span className="gcs-acpTile__value gcs-display gcs-sysTiles__text">{t(`drivers.${overview.driver}`)}</span>
            <span className="gcs-acpTile__label">{t("driver")}</span>
          </div>
        </li>
      </ul>

      <div className="gcs-sysGrid">
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-cache-areas">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-cache-areas" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-layer-group" /> {t("areasTitle")}
            </h2>
          </div>
          {overview.areas.length === 0 ? (
            <p className="gcs-acpList__empty gcs-sysEmpty">
              <GcsIcon name="fa-solid fa-wind" /> {t("empty")}
            </p>
          ) : (
            <ul className="gcs-sysList" data-testid="gcs-cache-areas">
              {overview.areas.map((a) => (
                <li key={a.area} className="gcs-sysList__row" data-area={a.area}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name="fa-solid fa-box" />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{areaLabel(a.area) ?? a.area}</strong>
                    <small>
                      {areaLabel(a.area) && <code>{a.area}</code>} {t("areaKeys", { count: a.keys })}
                    </small>
                  </span>
                  {canEdit && (
                    <GcsActionForm action={clearCacheArea.bind(null, a.area)} submitLabel={t("clear")} submitKind="reset" variant="ghost" compact>
                      {null}
                    </GcsActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </GcsCard>

        <div className="gcs-sysStack">
          <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-cache-tags">
            <div className="gcs-acpPanel__head">
              <h2 id="gcs-cache-tags" className="gcs-acpPanel__title">
                <GcsIcon name="fa-solid fa-tags" /> {t("tagsTitle")}
              </h2>
            </div>
            <p className="gcs-sysHint">{t("tagsHint")}</p>
            {overview.tags.length === 0 ? (
              <p className="gcs-acpList__empty gcs-sysEmpty">{t("noTags")}</p>
            ) : (
              <ul className="gcs-sysTags" data-testid="gcs-cache-tags">
                {overview.tags.map((tag) => (
                  <li key={tag} data-tag={tag}>
                    <code>{tag}</code>
                    {canEdit && (
                      <GcsActionForm action={clearCacheTag.bind(null, tag)} submitLabel={t("invalidate")} submitKind="reset" variant="ghost" compact>
                        {null}
                      </GcsActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </GcsCard>

          <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-cache-log">
            <div className="gcs-acpPanel__head">
              <h2 id="gcs-cache-log" className="gcs-acpPanel__title">
                <GcsIcon name="fa-solid fa-clock-rotate-left" /> {t("logTitle")}
              </h2>
            </div>
            {recent.length === 0 ? (
              <p className="gcs-acpList__empty gcs-sysEmpty">{t("logEmpty")}</p>
            ) : (
              <ul className="gcs-sysList" data-testid="gcs-cache-log">
                {recent.map((r, i) => (
                  <li key={i} className="gcs-sysList__row">
                    <span className="gcs-sysList__body">
                      <strong>{r.target === "*" ? t("logAll") : r.target.startsWith("tag:") ? t("logTag", { tag: r.target.slice(4) }) : t("logArea", { area: r.target })}</strong>
                      <small>
                        {r.actor ? <GcsMemberLink user={r.actor} href={`/admin/members/${r.actor.id}`} /> : "—"} · {format.relativeTime(r.at)}
                        {r.removed > 0 && ` · ${t("areaKeys", { count: r.removed })}`}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </GcsCard>
        </div>
      </div>
    </>
  );
}
