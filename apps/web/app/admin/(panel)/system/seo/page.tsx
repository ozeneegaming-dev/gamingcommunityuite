import { buildRobotsTxt, SEO_ACP_SECTION, SEO_GROUPS, SEO_SETTINGS, type GcsSeoGroup } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { siteBaseUrl } from "@/lib/seo";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { GcsSettingsForm, type GcsSettingsField } from "../../_components/GcsSettingsForm";
import { clearShareImage, regenerateIndexNowKey, saveSeoGroup } from "./actions";
import { GcsShareImageField } from "./GcsShareImageField";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.seo"))("title") };
}

const CARDS: { group: GcsSeoGroup; icon: string }[] = [
  { group: "meta", icon: "fa-solid fa-heading" },
  { group: "robots", icon: "fa-solid fa-robot" },
  { group: "sitemap", icon: "fa-solid fa-sitemap" },
  { group: "indexNow", icon: "fa-solid fa-bolt" },
  { group: "verification", icon: "fa-solid fa-circle-check" },
  { group: "links", icon: "fa-solid fa-link" },
];

/**
 * ACP → Promovare → SEO: titlul și metadatele paginilor (formatul, descrierea, imaginea de distribuire, contul X),
 * `robots.txt` (implicit sau personalizat, cu previzualizare), sitemap-ul (tipurile de conținut, limita, profilurile),
 * IndexNow (cheia, starea jobului), codurile de verificare ale motoarelor și linkurile externe (nofollow, lista albă).
 */
export default async function AcpSeoPage() {
  await requireAcpSection(SEO_ACP_SECTION);
  const { settings, registry, sitemap, indexNow } = services();
  const [t, tAll, format, base] = await Promise.all([getTranslations("acp.seo"), getTranslations(), getFormatter(), siteBaseUrl()]);
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);
  const defs = new Map(registry.settingDefs().map((d) => [d.key, d]));

  const fieldsFor = (keys: readonly string[]): Promise<GcsSettingsField[]> =>
    Promise.all(
      keys.map(async (key) => {
        const def = defs.get(key)!;
        const f: GcsSettingsField = { key, label: label(def.labelKey), type: def.type, value: await settings.get(key) };
        if (def.options) f.options = def.options.map((o) => ({ value: o, label: label(`settings.choices.${o}`) }));
        if (def.multiline) f.multiline = true;
        if (tAll.has(`${def.labelKey}_hint`)) f.hint = tAll(`${def.labelKey}_hint`);
        return f;
      }),
    );
  const fields = Object.fromEntries(await Promise.all(CARDS.map(async (c) => [c.group, await fieldsFor(SEO_GROUPS[c.group])] as const))) as Record<GcsSeoGroup, GcsSettingsField[]>;
  const [robotsMode, robotsCustom, sitemapOn, shareImage, key, state, chunks] = await Promise.all([
    settings.get<string>(SEO_SETTINGS.robotsMode),
    settings.get<string>(SEO_SETTINGS.robotsCustom),
    sitemap.enabled(),
    settings.get<string>(SEO_SETTINGS.shareImage),
    settings.get<string>(SEO_SETTINGS.indexNowKey),
    indexNow.state(),
    sitemap.chunks().catch(() => []),
  ]);
  const robots = buildRobotsTxt({ mode: robotsMode, custom: robotsCustom, base, sitemap: sitemapOn });
  const formLabels = { save: t("save"), saved: tAll("acp.saved"), secretSet: "", secretEmpty: "", on: tAll("acp.settings.on") };
  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : t("indexNow.never"));
  const link = (href: string, text: string, testId?: string) => (
    <a href={href} target="_blank" rel="noopener" data-testid={testId}>
      <GcsIcon name="fa-solid fa-arrow-up-right-from-square" className="gcs-hIcon" />
      {text}
    </a>
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-magnifying-glass-chart">{t("title")}</GcsAcpTitle>
      <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14, maxWidth: 820 }}>{t("intro")}</p>
      {CARDS.map(({ group, icon }) => (
        <GcsCard key={group} as="section" aria-labelledby={`gcs-seo-${group}-title`} style={{ padding: 20, maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }} data-testid={`gcs-seo-${group}`}>
          <h2 id={`gcs-seo-${group}-title`} className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name={icon} />
            {t(`${group}.title`)}
          </h2>
          <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t(`${group}.hint`)}</p>
          {/* Cheia formularului: după o încărcare a imaginii de distribuire câmpul arată noua adresă. */}
          <GcsSettingsForm key={group === "meta" ? `meta-${shareImage}` : group} fields={fields[group]} action={saveSeoGroup.bind(null, group)} labels={formLabels} />

          {group === "meta" && (
            <GcsShareImageField
              value={shareImage}
              remove={clearShareImage}
              labels={{ title: t("meta.image"), hint: t("meta.imageHint"), upload: t("meta.upload"), replace: t("meta.replace"), uploading: t("meta.uploading"), remove: t("meta.remove"), preview: t("meta.image") }}
            />
          )}

          {group === "robots" && (
            <>
              <h3 style={{ margin: "4px 0 0", fontSize: 15 }}>
                {t("robots.preview")} {link("/robots.txt", "/robots.txt", "gcs-seo-robots-link")}
              </h3>
              <pre style={{ margin: 0, padding: 12, borderRadius: 10, background: "var(--gcs-surface2)", maxHeight: 260, overflow: "auto", fontSize: 12.5, whiteSpace: "pre-wrap" }} data-testid="gcs-seo-robots-preview">
                {robots}
              </pre>
            </>
          )}

          {group === "sitemap" && (
            <p style={{ margin: 0, fontSize: 14 }} data-testid="gcs-seo-sitemap-status">
              {sitemapOn ? t("sitemap.status", { files: chunks.length }) : t("sitemap.off")} {sitemapOn && link("/sitemap.xml", "/sitemap.xml")}
            </p>
          )}

          {group === "indexNow" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }} data-testid="gcs-seo-indexnow-status">
              <span>
                {t("indexNow.key")}: {key ? <code data-testid="gcs-seo-indexnow-key">{key}</code> : <span className="gcs-muted">{t("indexNow.noKey")}</span>}{" "}
                {key && link(`/${key}.txt`, t("indexNow.keyFile"))}
              </span>
              <span className="gcs-muted">
                {t("indexNow.lastRun", { at: when(state.lastRunAt) })}
                {state.lastSentAt ? ` · ${t("indexNow.lastSent", { count: state.lastSent, at: when(state.lastSentAt) })}` : ""}
                {state.lastError ? ` · ${t("indexNow.lastError", { error: state.lastError })}` : ""}
                {state.retryAt && new Date(state.retryAt).getTime() > Date.now() ? ` · ${t("indexNow.retryAt", { at: when(state.retryAt) })}` : ""}
              </span>
              {key && (
                <GcsActionForm action={regenerateIndexNowKey} submitLabel={t("indexNow.regenerate")} submitKind="recompute" variant="ghost" confirm={t("indexNow.regenerateConfirm")} />
              )}
            </div>
          )}
        </GcsCard>
      ))}
    </>
  );
}
