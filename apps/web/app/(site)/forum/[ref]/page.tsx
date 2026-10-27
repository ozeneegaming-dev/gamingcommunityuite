import { GCS_TOPIC_SORTS, parseRef, type GcsForumRow as Row } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { GcsIcon, isGcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { viewerTheme } from "@/lib/appearance";
import { forumLocked } from "@/lib/forum-access";
import { forumQuery, moveTargets, pageParam } from "@/lib/forum-page";
import { forumListSlots, forumPageSlots, GcsSlot, GcsSlotStyles } from "@/lib/forum-slots";
import { forumHref, newTopicHref } from "@/lib/forum-urls";
import { GcsNamedHtml } from "@/lib/member-names";
import { services } from "@/lib/services";
import { TOPIC_VIEW_COOKIE, TOPIC_VIEWS } from "@/lib/view-cookies";
import { GcsBreadcrumb } from "../../_components/forum/GcsBreadcrumb";
import { GcsFollowButton, GcsMarkReadButton } from "../../_components/forum/GcsForumButtons";
import { GcsForumPasswordForm } from "../../_components/forum/GcsForumGates";
import { GcsForumIcon } from "../../_components/forum/GcsForumIcon";
import { GcsForumRow, PAGE_ICON } from "../../_components/forum/GcsForumRow";
import { GcsForumRulesBox } from "../../_components/forum/GcsForumRulesBox";
import { GcsModBar } from "../../_components/forum/GcsModBar";
import { GcsPagination } from "../../_components/forum/GcsPagination";
import { GcsTopicRow } from "../../_components/forum/GcsTopicRow";
import { GcsViewToggle } from "../../_components/forum/GcsViewToggle";
import { GcsWidgetPage } from "../../_components/widgets/GcsWidgetPage";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const ref = parseRef((await params).ref);
  const forum = ref ? await services().db.forum.findUnique({ where: { id: ref.id }, select: { id: true, name: true, slug: true, description: true } }) : null;
  if (!forum) return {};
  const canonical = forumHref(forum, pageParam((await searchParams).page));
  const rss = (await services().settings.get<boolean>("forums.rss_enabled")) ? { types: { "application/rss+xml": `/forum/${forum.id}/rss.xml` } } : {};
  return {
    title: forum.name,
    ...(forum.description ? { description: forum.description } : {}),
    alternates: { canonical, ...rss },
    openGraph: { title: forum.name, url: canonical },
  };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Pagina unui forum: subforumurile, topicurile (fixate primele), paginarea și acțiunile (spec §7). Forum v2: pagina unui
 * nod „Pagină / Anunț” (conținutul bogat, butonul CTA, topicurile de dedesubt), cardurile extensiilor sus
 * (`forum.page.top`), regulile și parola forumului, sortarea, filtrul „4★+” și vederea listei aleasă de membru.
 */
export default async function ForumPage({ params, searchParams }: Props) {
  const ref = parseRef((await params).ref);
  if (!ref) notFound();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const prefixId = pageParam(sp.prefix);
  const sort = one(sp.sort);
  const minRating = one(sp.stars) === "4" ? 4 : undefined;
  const actor = await currentActor();
  const { forumQueries, follows, prefixes, moderation, settings } = services();
  const t = await getTranslations("forum");

  // Vederea listei: alegerea membrului (cookie), altfel cea implicită din setări; „cu fragment” arată începutul primei postări.
  const [theme, defaultView, jar] = await Promise.all([viewerTheme(), settings.get<string>("forums.topic_view"), cookies()]);
  const chosen = jar.get(TOPIC_VIEW_COOKIE)?.value;
  const view: (typeof TOPIC_VIEWS)[number] = chosen === "list" || chosen === "snippet" ? chosen : defaultView === "snippet" ? "snippet" : "list";
  // Setarea temei „Fragment în lista topicurilor” rămâne: fragmentul apare și în vederea listă.
  const snippets = theme.shown.settings.layout.topicSnippet || view === "snippet";
  const data = await forumQuery(() => forumQueries.forum(actor, ref.id, { page, snippets, ...(sp.prefix ? { prefixId } : {}), ...(sort ? { sort } : {}), ...(minRating ? { minRating } : {}) }));
  if (data === "forbidden") {
    return (
      <GcsCard style={{ padding: 24 }} role="alert">
        <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
        {t("forbidden")}
      </GcsCard>
    );
  }
  const { forum } = data;
  if (forum.type === "LINK" && forum.linkUrl) redirect(forum.linkUrl);
  if (ref.slug !== forum.slug) permanentRedirect(forumHref(forum, page));
  const node = { id: forum.id, type: forum.type, parentId: null, name: forum.name, slug: forum.slug };

  // Forum v2: forumul cu parolă (deblocată în acest browser; moderatorii intră direct).
  if (data.options.hasPassword && (await forumLocked(actor, forum.id))) {
    return (
      <GcsWidgetPage page="forum">
        <GcsBreadcrumb crumbs={data.breadcrumb.slice(0, -1)} />
        <GcsForumPasswordForm forumId={forum.id} name={forum.name} />
      </GcsWidgetPage>
    );
  }

  const isMod = data.modPowers.length > 0;
  const hostsTopics = forum.type === "FORUM" || forum.type === "QA" || (forum.type === "PAGE" && (data.page?.allowTopics ?? false));
  const [following, followers, allowedPrefixes, targets, savedActions, top, subSlots, popularThreshold] = await Promise.all([
    follows.isFollowing(actor.userId, "forum", String(forum.id)),
    follows.count("forum", String(forum.id)),
    hostsTopics ? prefixes.allowedFor(forum.id) : Promise.resolve([]),
    isMod ? moveTargets(actor) : Promise.resolve([]),
    isMod ? moderation.listActions() : Promise.resolve([]),
    forumPageSlots(node),
    forumListSlots(
      "forum",
      data.subforums.map((f: Row) => ({ id: f.id, type: f.type, parentId: forum.id, parentType: forum.type, name: f.name, slug: f.slug, children: f.subforums.map((s) => ({ id: s.id, type: "FORUM" as const, name: s.name, slug: s.slug })) })),
    ),
    settings.get<number>("forums.popular_threshold"),
  ]);
  const popular = await forumQueries.popularNow(
    data.topics.map((x) => x.id),
    popularThreshold,
  );
  const tm = await getTranslations("mod");
  const plugins = [...new Set([...top.plugins, ...[...subSlots.values()].flatMap((b) => b.plugins)])];
  const query = (over: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const cur: Record<string, string | undefined> = { prefix: sp.prefix ? String(prefixId) : undefined, sort: data.sort !== data.options.defaultSort ? data.sort : undefined, stars: data.minRating ? "4" : undefined };
    for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : "";
  };
  const pageIcon = forum.type === "PAGE" && !forum.icon ? PAGE_ICON : forum.icon;

  return (
    <GcsWidgetPage page="forum">
      <GcsSlotStyles plugins={plugins} />
      <section className="gcs-pageHeader">
        <GcsBreadcrumb crumbs={data.breadcrumb.slice(0, -1)} />
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsForumIcon icon={pageIcon} color={forum.color ?? "var(--gcs-accent)"} size={24} />
            {forum.name}
          </h1>
          {forum.description && <p className="gcs-pageHeader__desc">{forum.description}</p>}
        </div>
        <div className="gcs-pageHeader__actions">
          {actor.userId && <GcsFollowButton contentType="forum" contentId={forum.id} following={following} count={followers} />}
          {actor.userId && hostsTopics && <GcsMarkReadButton forumId={forum.id} />}
          {data.canCreate && (
            <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-plus" />}>
              <Link href={newTopicHref(forum)}>{t("newTopic")}</Link>
            </GcsButton>
          )}
        </div>
      </section>

      {top.items.length > 0 && <GcsSlot slot="forum.page.top" items={top.items} className="gcs-forumPageSlot" />}
      {data.rulesHtml && data.options.rulesMode !== "off" && <GcsForumRulesBox forumId={forum.id} html={data.rulesHtml} mode={data.options.rulesMode} userId={actor.userId} />}

      {data.page && (
        // Forum v2: pagina bogată a nodului „Pagină / Anunț” (titluri, liste, linkuri, imagini, blocuri), cu butonul CTA.
        <article className="gcs-card gcs-forumPage" data-testid="gcs-forum-page">
          {data.page.html ? <GcsNamedHtml className="gcs-postBody gcs-forumPage__body" html={data.page.html} /> : <p className="gcs-muted">{t("pageEmpty")}</p>}
          {data.page.ctaLabel && data.page.ctaUrl && (
            <p className="gcs-forumPage__cta">
              <GcsButton variant="primary" asChild icon={<GcsIcon name={data.page.ctaIcon && isGcsIcon(data.page.ctaIcon) ? data.page.ctaIcon : "fa-solid fa-arrow-right"} />}>
                {data.page.ctaUrl.startsWith("/") ? (
                  <Link href={data.page.ctaUrl} data-testid="gcs-forum-page-cta">
                    {data.page.ctaLabel}
                  </Link>
                ) : (
                  <a href={data.page.ctaUrl} rel="noopener nofollow" target="_blank" data-testid="gcs-forum-page-cta">
                    {data.page.ctaLabel}
                  </a>
                )}
              </GcsButton>
            </p>
          )}
        </article>
      )}

      {data.subforums.length > 0 && (
        <section className="gcs-card gcs-category" aria-label={t("subforums")}>
          {data.subforums.map((f) => (
            <GcsForumRow key={f.id} forum={f} accent={null} slots={subSlots.get(f.id)} />
          ))}
        </section>
      )}

      {hostsTopics && (
        <section className="gcs-card gcs-topicList" aria-labelledby="gcs-topics-title">
          <header className="gcs-topicList__header">
            <h2 id="gcs-topics-title" className="gcs-display gcs-category__title">
              <GcsIcon name="fa-solid fa-list-ul" className="gcs-hIcon" />
              {t("topicsTitle")}
            </h2>
            <form className="gcs-topicList__filter" method="get" data-testid="gcs-topic-filters">
              {allowedPrefixes.length > 0 && (
                <>
                  <label htmlFor="gcs-prefix-filter">{t("prefixFilter")}</label>
                  <select id="gcs-prefix-filter" name="prefix" className="gcs-input" defaultValue={sp.prefix ? String(prefixId) : ""}>
                    <option value="">{t("allPrefixes")}</option>
                    {allowedPrefixes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <label htmlFor="gcs-topic-sort">{t("sortLabel")}</label>
              <select id="gcs-topic-sort" name="sort" className="gcs-input" defaultValue={data.sort}>
                {GCS_TOPIC_SORTS.filter((s) => s !== "rating" || data.options.ratingEnabled).map((s) => (
                  <option key={s} value={s}>
                    {t(`sorts.${s}`)}
                  </option>
                ))}
              </select>
              {data.options.ratingEnabled && (
                <label className="gcs-check gcs-topicList__stars">
                  <input type="checkbox" name="stars" value="4" defaultChecked={data.minRating === 4} />
                  {t("fourStars")}
                </label>
              )}
              <GcsButton type="submit" variant="ghost" size="sm" icon={<GcsIcon name="fa-solid fa-filter" />}>
                {t("filter")}
              </GcsButton>
            </form>
            <GcsViewToggle cookie={TOPIC_VIEW_COOKIE} value={view} options={TOPIC_VIEWS} labels={{ list: t("listViews.list"), snippet: t("listViews.snippet") }} label={t("listViews.label")} />
          </header>
          {isMod && data.topics.length > 0 && (
            <>
              <form id="gcs-mod-topics" />
              <GcsModBar
                formId="gcs-mod-topics"
                powers={data.modPowers}
                forums={targets.filter((f) => f.id !== forum.id)}
                savedActions={savedActions
                  .filter((a) => a.forumIds.length === 0 || a.forumIds.includes(forum.id))
                  .map((a) => ({ id: a.id, name: a.name }))}
              />
            </>
          )}
          {data.topics.length === 0 ? (
            <p className="gcs-topicList__empty">
              <GcsIcon name="fa-regular fa-comments" className="gcs-emptyIcon" />
              {data.minRating ? t("emptyRated") : t("empty")}
            </p>
          ) : (
            data.topics.map((topic) => (
              <GcsTopicRow
                key={topic.id}
                topic={topic}
                popular={popular.has(topic.id)}
                {...(isMod
                  ? {
                      select: (
                        <input
                          type="checkbox"
                          form="gcs-mod-topics"
                          name="topicId"
                          value={topic.id}
                          className="gcs-modCheck"
                          aria-label={tm("select", { title: topic.title })}
                        />
                      ),
                    }
                  : {})}
              />
            ))
          )}
        </section>
      )}

      {hostsTopics && <GcsPagination pagination={data.pagination} href={(p) => `${forumHref(forum, p)}${query({}).replace(/^\?/, p > 1 ? "&" : "?")}`} />}
    </GcsWidgetPage>
  );
}
