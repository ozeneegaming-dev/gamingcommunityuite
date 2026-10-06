import { parseRef } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumQuery, moveTargets, pageParam } from "@/lib/forum-page";
import { forumHref, newTopicHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsBreadcrumb } from "../../_components/forum/GcsBreadcrumb";
import { GcsFollowButton, GcsMarkReadButton } from "../../_components/forum/GcsForumButtons";
import { GcsForumRow } from "../../_components/forum/GcsForumRow";
import { GcsModBar } from "../../_components/forum/GcsModBar";
import { GcsPagination } from "../../_components/forum/GcsPagination";
import { GcsTopicRow } from "../../_components/forum/GcsTopicRow";
import { GcsWidgetPage } from "../../_components/widgets/GcsWidgetPage";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const ref = parseRef((await params).ref);
  const forum = ref ? await services().db.forum.findUnique({ where: { id: ref.id }, select: { id: true, name: true, slug: true, description: true } }) : null;
  if (!forum) return {};
  const canonical = forumHref(forum, pageParam((await searchParams).page));
  return {
    title: forum.name,
    ...(forum.description ? { description: forum.description } : {}),
    alternates: { canonical },
    openGraph: { title: forum.name, url: canonical },
  };
}

/** Pagina unui forum: subforumurile, topicurile (fixate primele), paginarea și acțiunile (spec §7). */
export default async function ForumPage({ params, searchParams }: Props) {
  const ref = parseRef((await params).ref);
  if (!ref) notFound();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const prefixId = pageParam(sp.prefix);
  const actor = await currentActor();
  const { forumQueries, follows, prefixes, moderation } = services();
  const t = await getTranslations("forum");

  const data = await forumQuery(() => forumQueries.forum(actor, ref.id, { page, ...(sp.prefix ? { prefixId } : {}) }));
  if (data === "forbidden") {
    return (
      <GcsCard style={{ padding: 24 }} role="alert">
        {t("forbidden")}
      </GcsCard>
    );
  }
  const { forum } = data;
  if (forum.type === "LINK" && forum.linkUrl) redirect(forum.linkUrl);
  if (ref.slug !== forum.slug) permanentRedirect(forumHref(forum, page));

  const isMod = data.modPowers.length > 0;
  const [following, followers, allowedPrefixes, targets, savedActions] = await Promise.all([
    follows.isFollowing(actor.userId, "forum", String(forum.id)),
    follows.count("forum", String(forum.id)),
    forum.type === "FORUM" || forum.type === "QA" ? prefixes.allowedFor(forum.id) : Promise.resolve([]),
    isMod ? moveTargets(actor) : Promise.resolve([]),
    isMod ? moderation.listActions() : Promise.resolve([]),
  ]);
  const tm = await getTranslations("mod");

  return (
    <GcsWidgetPage page="forum">
      <GcsBreadcrumb crumbs={data.breadcrumb.slice(0, -1)} />
      <section className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">{forum.name}</h1>
          {forum.description && <p className="gcs-pageHeader__desc">{forum.description}</p>}
        </div>
        <div className="gcs-pageHeader__actions">
          {actor.userId && <GcsFollowButton contentType="forum" contentId={forum.id} following={following} count={followers} />}
          {actor.userId && <GcsMarkReadButton forumId={forum.id} />}
          {data.canCreate && (
            <GcsButton variant="primary" asChild>
              <Link href={newTopicHref(forum)}>{t("newTopic")}</Link>
            </GcsButton>
          )}
        </div>
      </section>

      {data.subforums.length > 0 && (
        <section className="gcs-card gcs-category" aria-label={t("subforums")}>
          {data.subforums.map((f) => (
            <GcsForumRow key={f.id} forum={f} accent={null} />
          ))}
        </section>
      )}

      {(forum.type === "FORUM" || forum.type === "QA") && (
        <section className="gcs-card gcs-topicList" aria-labelledby="gcs-topics-title">
          <header className="gcs-topicList__header">
            <h2 id="gcs-topics-title" className="gcs-display gcs-category__title">
              {t("topicsTitle")}
            </h2>
            {allowedPrefixes.length > 0 && (
              <form className="gcs-topicList__filter" method="get">
                <label htmlFor="gcs-prefix-filter">{t("prefixFilter")}</label>
                <select id="gcs-prefix-filter" name="prefix" className="gcs-input" defaultValue={sp.prefix ? String(prefixId) : ""}>
                  <option value="">{t("allPrefixes")}</option>
                  {allowedPrefixes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <GcsButton type="submit" variant="ghost" size="sm">
                  {t("filter")}
                </GcsButton>
              </form>
            )}
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
            <p className="gcs-topicList__empty">{t("empty")}</p>
          ) : (
            data.topics.map((topic) => (
              <GcsTopicRow
                key={topic.id}
                topic={topic}
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

      <GcsPagination
        pagination={data.pagination}
        href={(p) => `${forumHref(forum, p)}${sp.prefix ? `${p > 1 ? "&" : "?"}prefix=${prefixId}` : ""}`}
      />
    </GcsWidgetPage>
  );
}
