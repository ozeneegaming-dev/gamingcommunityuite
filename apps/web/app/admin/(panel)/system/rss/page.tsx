import { faSliders } from "@fortawesome/free-solid-svg-icons";
import { forumContainer, loadRssConfig, RSS_ACP_SECTION, RSS_ENABLED_SETTING } from "@gcs/modules";
import { GcsButton, GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { guestActor } from "@/lib/seo";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { saveRssConfig } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.rss"))("title") };
}

/** Pluginul care importă fluxuri RSS ca topicuri ale botului. */
const NEWS_BOT = "gcs.news_bot";

/**
 * ACP › Sistem › Descoperire › RSS: fluxurile site-ului (cel general și câte unul pe forumurile publice, cu adresa de
 * copiat) și importul de fluxuri (pluginul Bot de știri). Panoul „Setări”: fluxurile pornite, câte topicuri, rezumatul,
 * fluxul general și cache-ul.
 */
export default async function AcpRssPage() {
  const panel = await requireAcpSection(RSS_ACP_SECTION);
  const { settings, acp, db, permissions } = services();
  const [t, cfg, enabled, canEdit, siteUrl, forums, guest, newsBot] = await Promise.all([
    getTranslations("acp.rss"),
    loadRssConfig(settings),
    settings.get<boolean>(RSS_ENABLED_SETTING),
    acp.can(panel.actor, RSS_ACP_SECTION, "edit"),
    settings.get<string>("site.url"),
    db.forum.findMany({ where: { type: { in: ["FORUM", "QA"] } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, slug: true, passwordHash: true } }),
    guestActor(),
    db.plugin.findUnique({ where: { key: NEWS_BOT }, select: { enabled: true } }),
  ]);
  const readable = await permissions.filterContainers(guest, "forums.read", forums.map((f) => forumContainer(f.id)));
  const publicForums = forums.filter((f) => readable.has(String(f.id)) && !f.passwordHash);
  const base = (siteUrl || process.env.GCS_BASE_URL || "").replace(/\/$/, "");
  const feeds = [
    ...(cfg.siteFeed ? [{ key: "site", name: t("siteFeed"), path: "/rss.xml", icon: "fa-solid fa-globe" }] : []),
    ...publicForums.map((f) => ({ key: `forum-${f.id}`, name: f.name, path: `/forum/${f.id}-${f.slug}/rss.xml`, icon: "fa-solid fa-comments" })),
  ];

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-rss"
        description={t("description")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("settings")} variant="primary" buttonIcon={<GcsIconSvg icon={faSliders} />} title={t("settings")} titleIcon={<GcsIconSvg icon={faSliders} />} testId="gcs-rss-settings">
              <GcsActionForm action={saveRssConfig} submitLabel={t("save")} submitKind="save">
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secFeeds")}</legend>
                  <label className="gcs-toggleRow">
                    <span>{t("cfg.enabled")}</span>
                    <input type="checkbox" name="enabled" defaultChecked={enabled} />
                  </label>
                  <label className="gcs-toggleRow">
                    <span>
                      {t("cfg.siteFeed")}
                      <small className="gcs-achHint">{t("cfg.siteFeedHint")}</small>
                    </span>
                    <input type="checkbox" name="siteFeed" defaultChecked={cfg.siteFeed} />
                  </label>
                </fieldset>
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secItems")}</legend>
                  <div className="gcs-formGrid gcs-formGrid--2">
                    <label className="gcs-field">
                      {t("cfg.items")}
                      <input className="gcs-input" type="number" name="items" min={5} max={50} defaultValue={cfg.items} required />
                    </label>
                    <label className="gcs-field">
                      {t("cfg.cacheMinutes")}
                      <input className="gcs-input" type="number" name="cacheMinutes" min={1} max={1440} defaultValue={cfg.cacheMinutes} required />
                    </label>
                  </div>
                  <label className="gcs-toggleRow">
                    <span>
                      {t("cfg.snippets")}
                      <small className="gcs-achHint">{t("cfg.snippetsHint")}</small>
                    </span>
                    <input type="checkbox" name="snippets" defaultChecked={cfg.snippets} />
                  </label>
                </fieldset>
              </GcsActionForm>
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <div className={`gcs-sysSummary gcs-sysSummary--${enabled ? "ok" : "down"}`} data-testid="gcs-rss-summary">
        <GcsIcon name={enabled ? "fa-solid fa-circle-check" : "fa-solid fa-circle-minus"} />
        <span>
          <strong>{enabled ? t("stateOn", { count: feeds.length }) : t("stateOff")}</strong>
          <small>{[t("chipItems", { n: cfg.items }), cfg.snippets ? t("chipSnippets") : null, t("chipCache", { n: cfg.cacheMinutes })].filter(Boolean).join(" · ")}</small>
        </span>
      </div>

      <div className="gcs-sysGrid">
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-rss-feeds">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-rss-feeds" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-rss" /> {t("feeds")}
            </h2>
          </div>
          {!enabled || feeds.length === 0 ? (
            <p className="gcs-acpList__empty gcs-sysEmpty">{enabled ? t("noFeeds") : t("stateOff")}</p>
          ) : (
            <ul className="gcs-sysList" data-testid="gcs-rss-feeds">
              {feeds.map((f) => (
                <li key={f.key} className="gcs-sysList__row" data-feed={f.key}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name={f.icon} />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{f.name}</strong>
                    <small>
                      <code>{`${base}${f.path}`}</code>
                    </small>
                  </span>
                  <GcsButton variant="ghost" size="sm" asChild icon={<GcsIcon name="fa-solid fa-arrow-up-right-from-square" />}>
                    <a href={f.path} target="_blank" rel="noopener">
                      {t("open")}
                    </a>
                  </GcsButton>
                </li>
              ))}
            </ul>
          )}
        </GcsCard>
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-rss-import">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-rss-import" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-file-import" /> {t("importTitle")}
            </h2>
          </div>
          <p className="gcs-sysHint">{t("importBody")}</p>
          <div className="gcs-sysList__row">
            {newsBot ? (
              <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-robot" />}>
                <Link href={`/admin/plugins/${NEWS_BOT}`} data-testid="gcs-rss-import">
                  {newsBot.enabled ? t("importOpen") : t("importDisabled")}
                </Link>
              </GcsButton>
            ) : (
              <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-cubes" />}>
                <Link href="/admin/system/applications" data-testid="gcs-rss-import">
                  {t("importInstall")}
                </Link>
              </GcsButton>
            )}
          </div>
        </GcsCard>
      </div>
    </>
  );
}
