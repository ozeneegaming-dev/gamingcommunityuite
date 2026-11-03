import { jsonInts } from "@gcs/db";
import { DEFAULT_THEME_TOGGLE } from "@gcs/core";
import { allowedBlocks, FORUMS_ACP_SECTION, forumPreviewOf, GCS_FORUM_PREVIEW_MODES, GCS_TOPIC_SORTS, type GcsForumTabView } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { JSONContent } from "@tiptap/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { forumExtOptions } from "@/lib/forum-ext-options";
import { FORUM_TAB_COMPONENTS } from "@/lib/forum-slot-components";
import { pluginHost, safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";
import { GcsIconInput } from "@/lib/ui-inputs";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { GcsIcon } from "@gcs/ui/icons";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteForum, resetForumRatings, saveForumExtensionTab, saveForumOptions, saveForumPage, setForumPrefixes, updateForum } from "../actions";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsAcpDocInput } from "./GcsAcpDocInput";
import { GcsForumPreviewField, type GcsForumPreviewLabels } from "./GcsForumPreviewField";
import { GcsAspectPreview } from "../../../_components/GcsAspectPreview";
import { GcsExtFields } from "../../../_components/GcsExtFields";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> };

async function load(raw: string) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return null;
  return services().db.forum.findUnique({ where: { id }, include: { prefixes: { select: { prefixId: true } }, page: true, _count: { select: { topics: true } } } });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const forum = await load((await params).id);
  return forum ? { title: (await getTranslations("acp.forums"))("form.title", { name: forum.name }) } : {};
}

type Translate = Awaited<ReturnType<typeof getTranslations>>;
const label = (t: Translate, key: string) => (t.has(key as never) ? t(key as never) : key);

/**
 * Editarea unui forum (Forum v2: pe taburi, ca în macheta ForumAspectAcp): Detalii (numele, tipul, iconița, prefixele,
 * ștergerea), Opțiuni (topicurile proprii, parola, regulile, sortarea, sondajele, tag-urile, pragurile, nota), Pagină
 * (doar nodurile „Pagină / Anunț”) și taburile contribuite de aplicații și pluginuri (ex. „Aspect”, „Server”).
 */
export default async function AcpForumPage({ params, searchParams }: Props) {
  const panel = await requireAcpSection(FORUMS_ACP_SECTION);
  const forum = await load((await params).id);
  if (!forum) notFound();
  const sp = await searchParams;
  const t = await getTranslations("acp.forums");
  const tAll = await getTranslations();
  const { db, prefixes, forumSlots } = services();
  const plugins = !(await safeModeActive());
  const extTabs = await forumSlots.editTabs({ id: forum.id, type: forum.type }, { plugins });
  const isCategory = forum.type === "CATEGORY";
  const hostsTopics = forum.type === "FORUM" || forum.type === "QA" || forum.type === "PAGE";

  const tabs: { key: string; label: string; icon: string; plugin?: boolean }[] = [
    { key: "details", label: t("tabs.details"), icon: "fa-solid fa-circle-info" },
    ...(forum.type !== "LINK" && !isCategory ? [{ key: "options", label: t("tabs.options"), icon: "fa-solid fa-sliders" }] : []),
    ...(forum.type === "PAGE" ? [{ key: "page", label: t("tabs.page"), icon: "fa-solid fa-bullhorn" }] : []),
    ...extTabs.map((x) => ({ key: `x:${x.extension}:${x.tab.key}`, label: label(tAll, x.tab.labelKey), icon: isGcsIcon(x.tab.icon) ? x.tab.icon : "fa-solid fa-puzzle-piece", plugin: x.plugin !== null })),
  ];
  const tab = tabs.some((x) => x.key === sp.tab) ? sp.tab! : "details";
  const tabHref = (key: string) => (key === "details" ? `/admin/community/forums/${forum.id}` : `/admin/community/forums/${forum.id}?tab=${encodeURIComponent(key)}`);

  return (
    <>
      <GcsAcpTitle icon={isGcsIcon(forum.icon) ? forum.icon : "fa-solid fa-comments"}>{t("form.title", { name: forum.name })}</GcsAcpTitle>
      <p style={{ margin: 0, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link href="/admin/community/forums" className="gcs-acpBack">
          <GcsIcon name="fa-solid fa-arrow-left" />
          {t("title")}
        </Link>
        <Link href={`/admin/permissions/forum/${forum.id}`} className="gcs-acpBack">
          <GcsIcon name="fa-solid fa-key" />
          {t("permissions")}
        </Link>
        <Link href={`/forum/${forum.id}-${forum.slug}`} className="gcs-acpBack">
          <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
          {t("view")}
        </Link>
      </p>

      <nav className="gcs-tabs gcs-forumTabs" aria-label={t("tabs.label")} data-testid="gcs-forum-tabs">
        {tabs.map((x) => (
          <Link key={x.key} href={tabHref(x.key)} className={`gcs-tab${tab === x.key ? " gcs-tab--active" : ""}`} aria-current={tab === x.key ? "page" : undefined} data-testid={`gcs-forum-tab-${x.key}`}>
            <GcsIcon name={x.icon} className="gcs-tab__icon" /> {x.label}
            {x.plugin && <span className="gcs-forumTabs__plugin">{t("tabs.plugin")}</span>}
          </Link>
        ))}
      </nav>

      <div className="gcs-forumTabPanel" key={tab} data-tab={tab}>
        {tab === "details" && <Details />}
        {tab === "options" && <Options />}
        {tab === "page" && <PageTab />}
        {tab.startsWith("x:") && <Extension view={extTabs.find((x) => `x:${x.extension}:${x.tab.key}` === tab)!} />}
      </div>
    </>
  );

  // ─── Taburile ───────────────────────────────────────────────────────────────────────────────────────────

  async function Details() {
    const [allPrefixes, targets] = await Promise.all([
      prefixes.list(),
      db.forum.findMany({ where: { type: { in: ["FORUM", "QA", "PAGE"] }, id: { not: forum!.id } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    const f = forum!;
    const allowed = new Set(f.prefixes.map((p) => p.prefixId));
    return (
      <>
        <GcsCard as="section" aria-label={t("form.title", { name: f.name })} style={{ padding: 16, maxWidth: 640 }}>
          <GcsActionForm action={updateForum.bind(null, f.id)} submitLabel={t("form.save")} submitKind="save">
            <label className="gcs-field">
              {t("form.name")}
              <input className="gcs-input" name="name" defaultValue={f.name} required maxLength={100} />
            </label>
            <label className="gcs-field">
              {t("form.description")}
              <textarea className="gcs-input" name="description" defaultValue={f.description} maxLength={500} rows={3} />
            </label>
            {!isCategory && (
              <div className="gcs-field">
                <label htmlFor="gcs-acp-type">{t("form.type")}</label>
                <select id="gcs-acp-type" className="gcs-input" name="type" defaultValue={f.type}>
                  {(["FORUM", "QA", "LINK", "PAGE"] as const).map((type) => (
                    <option key={type} value={type}>
                      {t(`types.${type}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="gcs-field" role="group" aria-label={t("form.icon")}>
              <span>{t("form.icon")}</span>
              <GcsIconInput name="icon" value={f.icon} testId="gcs-forum-icon" />
            </div>
            {!isCategory && (
              <div className="gcs-field">
                <label htmlFor="gcs-acp-subcols">{t("form.subforumColumns")}</label>
                <select id="gcs-acp-subcols" className="gcs-input" name="subforumColumns" defaultValue={String(f.subforumColumns)}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label className="gcs-field">
              {t("form.color")}
              <input className="gcs-input" name="color" defaultValue={f.color ?? ""} placeholder="#D62839" pattern="#[0-9A-Fa-f]{6}" />
            </label>
            {!isCategory && (
              <label className="gcs-field">
                {t("form.linkUrl")}
                <input className="gcs-input" name="linkUrl" type="url" defaultValue={f.linkUrl ?? ""} />
              </label>
            )}
            {hostsTopics && (
              <label className="gcs-check">
                <input type="checkbox" name="requireApproval" defaultChecked={f.requireApproval} />
                {t("form.requireApproval")}
              </label>
            )}
            {/* Cardurile din grilă: imaginea de previzualizare (categoriile nu sunt carduri). */}
            {!isCategory && <PreviewField />}
          </GcsActionForm>
        </GcsCard>

        {hostsTopics && allPrefixes.length > 0 && (
          <GcsCard as="section" aria-label={t("form.prefixes")} style={{ padding: 16, maxWidth: 640 }}>
            <GcsActionForm action={setForumPrefixes.bind(null, f.id)} submitLabel={t("form.savePrefixes")} submitKind="save">
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <legend style={{ marginBottom: 8 }}>{t("form.prefixes")}</legend>
                {allPrefixes.map((p) => (
                  <label key={p.id} className="gcs-check">
                    <input type="checkbox" name="prefixId" value={p.id} defaultChecked={allowed.has(p.id)} />
                    <span style={{ color: p.color, fontWeight: 700 }}>{p.name}</span>
                  </label>
                ))}
              </fieldset>
            </GcsActionForm>
          </GcsCard>
        )}

        <GcsCard as="section" aria-label={t("form.delete")} style={{ padding: 16, maxWidth: 640 }}>
          <p className="gcs-muted" style={{ marginTop: 0 }}>
            {t("form.deleteHelp")}
          </p>
          <GcsActionForm action={deleteForum.bind(null, f.id)} submitLabel={t("form.delete")} submitKind="delete" variant="ghost" redirectTo="/admin/community/forums" confirm={t("form.confirmDelete")}>
            {f._count.topics > 0 ? (
              <div className="gcs-field">
                <label htmlFor="gcs-acp-moveContentTo">{t("form.moveContentTo")}</label>
                <select id="gcs-acp-moveContentTo" className="gcs-input" name="moveContentTo" required>
                  {targets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <span className="gcs-muted">{t("form.noMove")}</span>
            )}
          </GcsActionForm>
        </GcsCard>
      </>
    );
  }

  async function PreviewField() {
    const tp = await getTranslations("acp.forums.form.preview");
    const preview = forumPreviewOf(forum!);
    const modes = Object.fromEntries(GCS_FORUM_PREVIEW_MODES.map((m) => [m, { label: tp(`modes.${m}.label`), help: tp(`modes.${m}.help`) }])) as GcsForumPreviewLabels["modes"];
    return (
      <GcsForumPreviewField
        forumId={forum!.id}
        initial={preview}
        labels={{
          legend: tp("legend"),
          hint: tp("hint"),
          modes,
          uploadTitle: tp("uploadTitle"),
          current: tp("current"),
          empty: tp("empty"),
          crop: tp("crop"),
          cropHint: tp("cropHint"),
          result: tp("result"),
          autoNote: tp("autoNote"),
        }}
      />
    );
  }

  async function Options() {
    const f = forum!;
    const to = await getTranslations("acp.forums.options");
    const blocks = await allowedBlocks(services(), panel.actor);
    return (
      <>
        <GcsCard as="section" aria-label={to("title")} style={{ padding: 16, maxWidth: 760 }} data-testid="gcs-forum-options">
          <GcsActionForm action={saveForumOptions.bind(null, f.id)} submitLabel={t("form.save")} submitKind="save">
            <fieldset className="gcs-acpFieldset">
              <legend>{to("access")}</legend>
              <label className="gcs-check">
                <input type="checkbox" name="ownTopicsOnly" defaultChecked={f.ownTopicsOnly} />
                {to("ownTopicsOnly")}
              </label>
              <p className="gcs-muted gcs-acpHint">{to("ownTopicsOnlyHint")}</p>
              <label className="gcs-field">
                {f.passwordHash ? to("passwordChange") : to("password")}
                <input className="gcs-input" name="password" type="password" autoComplete="new-password" maxLength={100} minLength={4} />
              </label>
              {f.passwordHash && (
                <label className="gcs-check">
                  <input type="checkbox" name="removePassword" />
                  {to("removePassword")}
                </label>
              )}
              <label className="gcs-field">
                {to("minPosts")}
                <input className="gcs-input" name="minPosts" type="number" min={0} max={1000000} defaultValue={f.minPosts} />
              </label>
            </fieldset>

            <fieldset className="gcs-acpFieldset">
              <legend>{to("rules")}</legend>
              <div className="gcs-field">
                <label htmlFor="gcs-forum-rules-mode">{to("rulesMode")}</label>
                <select id="gcs-forum-rules-mode" className="gcs-input" name="rulesMode" defaultValue={f.rulesMode}>
                  {(["off", "show", "accept"] as const).map((m) => (
                    <option key={m} value={m}>
                      {to(`rulesModes.${m}`)}
                    </option>
                  ))}
                </select>
              </div>
              <span className="gcs-field__label" id="gcs-forum-rules-label">
                {to("rulesText")}
              </span>
              <GcsAcpDocInput name="rules" id="gcs-forum-rules-editor" labelledBy="gcs-forum-rules-label" initial={(f.rulesJson as JSONContent | null) ?? null} blocks={blocks} />
            </fieldset>

            <fieldset className="gcs-acpFieldset">
              <legend>{to("topics")}</legend>
              <div className="gcs-field">
                <label htmlFor="gcs-forum-sort">{to("defaultSort")}</label>
                <select id="gcs-forum-sort" className="gcs-input" name="defaultSort" defaultValue={f.defaultSort}>
                  {GCS_TOPIC_SORTS.map((s) => (
                    <option key={s} value={s}>
                      {tAll(`forum.sorts.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="gcs-check">
                <input type="checkbox" name="pollsEnabled" defaultChecked={f.pollsEnabled} />
                {to("pollsEnabled")}
              </label>
              <label className="gcs-check">
                <input type="checkbox" name="tagsEnabled" defaultChecked={f.tagsEnabled} />
                {to("tagsEnabled")}
              </label>
              <label className="gcs-check">
                <input type="checkbox" name="countPosts" defaultChecked={f.countPosts} />
                {to("countPosts")}
              </label>
              <label className="gcs-field">
                {to("autoCloseDays")}
                <input className="gcs-input" name="autoCloseDays" type="number" min={0} max={3650} defaultValue={f.autoCloseDays} />
              </label>
            </fieldset>

            <fieldset className="gcs-acpFieldset">
              <legend>{to("rating")}</legend>
              <label className="gcs-check">
                <input type="checkbox" name="ratingEnabled" defaultChecked={f.ratingEnabled} data-testid="gcs-forum-rating-enabled" />
                {to("ratingEnabled")}
              </label>
              <p className="gcs-muted gcs-acpHint">
                {to.rich("ratingHint", {
                  perms: (c) => <Link href={`/admin/permissions/forum/${f.id}`}>{c}</Link>,
                  settings: (c) => <Link href="/admin/settings/posting">{c}</Link>,
                })}
              </p>
            </fieldset>
          </GcsActionForm>
        </GcsCard>
        {f.ratingEnabled && (
          <GcsCard as="section" aria-label={to("resetRatings")} style={{ padding: 16, maxWidth: 760 }}>
            <p className="gcs-muted" style={{ marginTop: 0 }}>
              {to("resetRatingsHint")}
            </p>
            <GcsActionForm action={resetForumRatings.bind(null, f.id)} submitLabel={to("resetRatings")} submitKind="reset" variant="ghost" confirm={to("resetRatingsConfirm")} />
          </GcsCard>
        )}
      </>
    );
  }

  async function PageTab() {
    const f = forum!;
    const tp = await getTranslations("acp.forums.page");
    const [groups, blocks] = await Promise.all([db.group.findMany({ where: { key: { notIn: ["banned"] } }, orderBy: { position: "asc" }, select: { id: true, name: true } }), allowedBlocks(services(), panel.actor)]);
    const audience = new Set(jsonInts(f.page?.audienceGroupIds));
    return (
      <GcsCard as="section" aria-label={tp("title")} style={{ padding: 16 }} data-testid="gcs-forum-page-form">
        <GcsActionForm action={saveForumPage.bind(null, f.id)} submitLabel={t("form.save")} submitKind="save">
          <span className="gcs-field__label" id="gcs-forum-page-label">
            {tp("content")}
          </span>
          <p className="gcs-muted gcs-acpHint">{tp("contentHint")}</p>
          <GcsAcpDocInput name="content" id="gcs-forum-page-editor" labelledBy="gcs-forum-page-label" initial={(f.page?.contentJson as JSONContent | null) ?? null} blocks={blocks} />
          <fieldset className="gcs-acpFieldset">
            <legend>{tp("cta")}</legend>
            <label className="gcs-field">
              {tp("ctaLabel")}
              <input className="gcs-input" name="ctaLabel" maxLength={60} defaultValue={f.page?.ctaLabel ?? ""} />
            </label>
            <label className="gcs-field">
              {tp("ctaUrl")}
              <input className="gcs-input" name="ctaUrl" maxLength={500} defaultValue={f.page?.ctaUrl ?? ""} placeholder="/register" />
            </label>
            <div className="gcs-field" role="group" aria-label={tp("ctaIcon")}>
              <span>{tp("ctaIcon")}</span>
              <GcsIconInput name="ctaIcon" value={f.page?.ctaIcon ?? null} testId="gcs-forum-cta-icon" />
            </div>
          </fieldset>
          <label className="gcs-check">
            <input type="checkbox" name="allowTopics" defaultChecked={f.page?.allowTopics ?? false} />
            {tp("allowTopics")}
          </label>
          <fieldset className="gcs-acpFieldset">
            <legend>{tp("audience")}</legend>
            <p className="gcs-muted gcs-acpHint">{tp("audienceHint")}</p>
            <div className="gcs-forumAudience">
              {groups.map((g) => (
                <label key={g.id} className="gcs-check">
                  <input type="checkbox" name="audience" value={g.id} defaultChecked={audience.has(g.id)} />
                  {g.name}
                </label>
              ))}
            </div>
          </fieldset>
        </GcsActionForm>
      </GcsCard>
    );
  }

  async function Extension({ view }: { view: GcsForumTabView }) {
    const f = forum!;
    const fields = view.tab.fields ?? [];
    const Component = view.tab.component ? FORUM_TAB_COMPONENTS[view.tab.component] : undefined;
    let pluginHtml: { html: string; styles: string[] } | null = null;
    if (view.plugin && view.tab.pluginHook) {
      const host = await pluginHost();
      pluginHtml = await host.renderForumEditTab(view.plugin, view.tab.key, { forumId: f.id, data: view.values, actor: panel.actor, locale: await getLocale() });
    }
    const options = await forumExtOptions(fields);
    const ta = await getTranslations("acp.aspect");
    return (
      <GcsCard as="section" aria-label={label(tAll, view.tab.labelKey)} style={{ padding: 16, maxWidth: 760 }} data-testid={`gcs-forum-ext-${view.extension}-${view.tab.key}`} data-aspect-card="">
        {view.tab.descriptionKey && <p className="gcs-muted" style={{ marginTop: 0 }}>{label(tAll, view.tab.descriptionKey)}</p>}
        {fields.length > 0 && (
          <GcsActionForm action={saveForumExtensionTab.bind(null, f.id, view.extension, view.tab.key)} submitLabel={t("form.save")} submitKind="save">
            <GcsExtFields fields={fields} values={view.values} options={options} upload={{ scope: "forum", id: f.id, extension: view.extension, tab: view.tab.key }} />
          </GcsActionForm>
        )}
        {/* Aspect forumuri: previzualizarea live cu valorile încă nesalvate (câmpuri care schimbă stilul rândului). */}
        {fields.some((x) => ("style" in x && x.style) || ((x.type === "text" || x.type === "textarea") && x.slot)) && (
          <GcsAspectPreview
            base={`/aspect-preview?scope=forum&id=${f.id}&ext=${encodeURIComponent(view.extension)}&tab=${encodeURIComponent(view.tab.key)}`}
            themes={{ dark: DEFAULT_THEME_TOGGLE.dark, light: DEFAULT_THEME_TOGGLE.light }}
            labels={{ title: ta("preview.title"), dark: ta("preview.dark"), light: ta("preview.light"), unread: ta("preview.unread"), hint: ta("preview.hint") }}
            unreadToggle={forum!.type !== "CATEGORY"}
          />
        )}
        {Component && <Component forumId={f.id} extension={view.extension} tab={view.tab.key} values={view.values} />}
        {pluginHtml && (
          <>
            {pluginHtml.styles.map((href) => (
              <link key={href} rel="stylesheet" href={href} precedence="gcs-plugins" />
            ))}
            {/* HTML-ul pluginului, sanitizat și închis în containerul lui de gazda pluginurilor. */}
            <div className="gcs-pluginHook" data-hook="forum.edit" dangerouslySetInnerHTML={{ __html: pluginHtml.html }} />
          </>
        )}
      </GcsCard>
    );
  }
}
