import { parseRef } from "@gcs/modules";
import { GcsBadge, GcsButton, GcsCard, GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumQuery, moveTargets, pageParam } from "@/lib/forum-page";
import { forumHref, memberHref, tagHref, tint, topicHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { excerpt, firstImage, guestActor } from "@/lib/seo";
import { registerTopicView } from "@/lib/topic-views";
import { GcsBreadcrumb } from "../../_components/forum/GcsBreadcrumb";
import { GcsFollowButton } from "../../_components/forum/GcsForumButtons";
import { GcsPagination } from "../../_components/forum/GcsPagination";
import { GcsPollCard } from "../../_components/topic/GcsPollCard";
import { GcsPost } from "../../_components/topic/GcsPost";
import { GcsReplyBox } from "../../_components/topic/GcsReplyBox";
import { GcsTopicLive } from "../../_components/topic/GcsTopicLive";
import { topicReadersView } from "@/lib/online";
import { translateLabels } from "@/lib/translate";
import { GcsTopicModMenu, SPLIT_FORM_ID } from "../../_components/topic/GcsTopicModMenu";
import { GcsWidgetPage } from "../../_components/widgets/GcsWidgetPage";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Titlu, descriere (primul paragraf), prima imagine și `canonical`; un topic invizibil vizitatorilor nu se indexează. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const ref = parseRef((await params).ref);
  if (!ref) return {};
  const { db, permissions } = services();
  const topic = await db.topic.findUnique({
    where: { id: ref.id },
    select: { id: true, title: true, slug: true, visibility: true, forumId: true, posts: { orderBy: { id: "asc" }, take: 1, select: { contentHtml: true } } },
  });
  if (!topic || topic.visibility !== "VISIBLE") return {};
  const page = pageParam((await searchParams).page);
  const html = topic.posts[0]?.contentHtml ?? "";
  const image = firstImage(html);
  const description = excerpt(html);
  const publicRead = await permissions.can(await guestActor(), "forums.read", { type: "forum", id: String(topic.forumId) });
  return {
    title: topic.title,
    description,
    alternates: { canonical: topicHref(topic, page) },
    openGraph: { title: topic.title, description, type: "article", url: topicHref(topic, page), ...(image ? { images: [image] } : {}) },
    ...(publicRead ? {} : { robots: { index: false } }),
  };
}

const has = (powers: string[], power: string) => powers.includes("*") || powers.includes(power);

/** Pagina unui topic (macheta Topic): antetul, sondajul, postările, paginarea și caseta de răspuns. */
export default async function TopicPage({ params, searchParams }: Props) {
  const ref = parseRef((await params).ref);
  if (!ref) notFound();
  const page = pageParam((await searchParams).page);
  const actor = await currentActor();
  const { forumQueries, readMarkers, permissions, social } = services();
  const t = await getTranslations("topic");
  const tf = await getTranslations("forum");
  const format = await getFormatter();

  const data = await forumQuery(() => forumQueries.topic(actor, ref.id, { page }));
  if (data === "forbidden") {
    return (
      <GcsCard style={{ padding: 24 }} role="alert">
        <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
        {tf("forbidden")}
      </GcsCard>
    );
  }
  const { topic, forum } = data;
  if (ref.slug !== topic.slug) permanentRedirect(topicHref(topic, page));

  const visibleIds = data.posts.filter((p) => p.visibility === "VISIBLE").map((p) => p.id);
  const ignored = new Set(await social.ignoredIds(actor.userId, "posts"));
  const isMod = data.modPowers.length > 0;
  const authorIds = data.posts.flatMap((p) => (p.author ? [p.author.id] : []));
  const [maxUploadMb, , targets, , readers, tl, translate, postbits, clanTags] = await Promise.all([
    actor.userId ? permissions.groupValue<number | boolean>(actor, "upload.max_mb") : Promise.resolve(0),
    registerTopicView(actor, topic.id),
    isMod ? moveTargets(actor) : Promise.resolve([]),
    actor.userId && visibleIds.length > 0 ? readMarkers.markRead(actor.userId, topic.id, Math.max(...visibleIds)) : Promise.resolve(),
    topicReadersView(topic.id),
    getTranslations("topic.live"),
    translateLabels(actor),
    // Cardul autorilor (etapa 5): o singură rundă de interogări pentru toată pagina.
    services().postbit.forAuthors(actor, authorIds),
    // Tagurile clanurilor autorilor (aplicația Clanuri, dacă opțiunile le arată în postbit).
    services().clanQueries.tagsFor(authorIds, "postbit"),
  ]);
  const isTopicAuthor = actor.userId !== null && actor.userId === topic.author?.id;
  const canSolve = forum.type === "QA" && (isTopicAuthor || has(data.modPowers, "edit"));

  return (
    <GcsWidgetPage page="topic">
      <section className="gcs-pageHeader">
        <GcsBreadcrumb crumbs={data.breadcrumb} />
        <div className="gcs-pageHeader__text">
          <div className="gcs-topicRow__badges">
            {topic.prefix && (
              <span className="gcs-badge" style={{ background: tint(topic.prefix.color, 0.16), color: topic.prefix.color }}>
                {topic.prefix.name}
              </span>
            )}
            {topic.solvedPostId !== null && <GcsBadge tone="ok" icon={<GcsIcon name="fa-solid fa-circle-check" />}>{tf("solved")}</GcsBadge>}
            {topic.pinned && <GcsBadge tone="accent" icon={<GcsIcon name="fa-solid fa-thumbtack" />}>{tf("pinned")}</GcsBadge>}
            {topic.locked && <GcsBadge tone="neutral" icon={<GcsIcon name="fa-solid fa-lock" />}>{tf("locked")}</GcsBadge>}
            {topic.visibility === "PENDING" && <GcsBadge tone="warn" icon={<GcsIcon name="fa-solid fa-hourglass-half" />}>{tf("pending")}</GcsBadge>}
            {topic.visibility === "HIDDEN" && <GcsBadge tone="neutral" icon={<GcsIcon name="fa-solid fa-eye-slash" />}>{tf("hidden")}</GcsBadge>}
          </div>
          <h1 className="gcs-display gcs-pageHeader__title">{topic.title}</h1>
          <div className="gcs-topicMeta">
            {topic.author && (
              <span>
                {t("startedBy")}{" "}
                <GcsUserLink userId={topic.author.id} name={topic.author.name} nameKey={topic.author.nameKey} href={memberHref(topic.author)} /> ·{" "}
                {format.dateTime(new Date(topic.createdAt), { dateStyle: "medium" })}
              </span>
            )}
            <span>
              <GcsIcon name="fa-regular fa-comment" className="gcs-metaIcon" />
              {tf("replies", { count: topic.repliesCount })}
            </span>
            <span>
              <GcsIcon name="fa-regular fa-eye" className="gcs-metaIcon" />
              {tf("views", { count: topic.viewsCount })}
            </span>
            {topic.tags.length > 0 && (
              <span className="gcs-topicMeta__tags">
                {topic.tags.map((tag) => (
                  <Link key={tag.slug} href={tagHref(tag.slug)} className="gcs-tag">
                    #{tag.name}
                  </Link>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="gcs-pageHeader__actions">
          {actor.userId && <GcsFollowButton contentType="topic" contentId={topic.id} following={data.follow.following} count={data.follow.count} />}
          {data.canReply && (
            <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-reply" />}>
              <a href="#reply">{t("reply")}</a>
            </GcsButton>
          )}
        </div>
      </section>

      {isMod && (
        <>
          <form id={SPLIT_FORM_ID} />
          <GcsTopicModMenu
            topicId={topic.id}
            forumId={forum.id}
            forumHref={forumHref(forum)}
            powers={data.modPowers}
            flags={{ pinned: topic.pinned, locked: topic.locked, featured: topic.featured, hidden: topic.visibility === "HIDDEN" }}
            forums={targets}
          />
        </>
      )}

      {data.poll && (
        <GcsPollCard
          poll={data.poll}
          loggedIn={actor.userId !== null}
          closesLabel={data.poll.closesAt ? format.dateTime(new Date(data.poll.closesAt), { dateStyle: "medium", timeStyle: "short" }) : null}
        />
      )}

      <GcsTopicLive
        topicId={topic.id}
        viewerId={actor.userId}
        initialReaders={readers}
        unreadHref={`${topicHref(topic)}/unread`}
        labels={Object.fromEntries(["readers", "guests", "typing", "typingMany", "newPosts", "newPost", "show"].map((k) => [k, tl.raw(k) as string])) as Parameters<typeof GcsTopicLive>[0]["labels"]}
      />
      <GcsPagination pagination={data.pagination} href={(p) => topicHref(topic, p)} />
      <div className="gcs-postList">
        {data.posts.map((post) => (
          <GcsPost
            key={post.id}
            topicId={topic.id}
            forumId={forum.id}
            post={post}
            isSolved={topic.solvedPostId === post.id}
            reactionList={data.reactions}
            actorId={actor.userId}
            ignored={post.author !== null && ignored.has(post.author.id)}
            translate={translate}
            postbit={post.author ? (postbits.get(post.author.id) ?? null) : null}
            clan={post.author ? (clanTags.get(post.author.id) ?? null) : null}
            can={{
              react: actor.userId !== null && post.visibility === "VISIBLE",
              quote: data.canReply,
              report: actor.userId !== null && post.visibility === "VISIBLE",
              restore: has(data.modPowers, "hide"),
              delete: has(data.modPowers, "delete"),
              solve: canSolve && post.id !== topic.firstPostId && post.visibility === "VISIBLE",
              approve: has(data.modPowers, "approve"),
              split: has(data.modPowers, "split"),
            }}
          />
        ))}
      </div>
      <GcsPagination pagination={data.pagination} href={(p) => topicHref(topic, p)} />

      {data.canReply ? (
        <GcsReplyBox
          topicId={topic.id}
          forumId={forum.id}
          maxUploadMb={typeof maxUploadMb === "number" ? maxUploadMb : 0}
          maxLength={await services().settings.get<number>("forums.post_max_chars")}
        />
      ) : (
        <GcsCard style={{ padding: 18, color: "var(--gcs-muted)" }} data-testid="gcs-no-reply">
          {topic.locked ? (
            <>
              <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
              {t("lockedNotice")}
            </>
          ) : !actor.userId ? (
            <>
              <GcsIcon name="fa-solid fa-right-to-bracket" className="gcs-emptyIcon" />
              {t("loginToReply")}{" "}
              <Link href="/login">{t("login")}</Link>
            </>
          ) : null}
        </GcsCard>
      )}
    </GcsWidgetPage>
  );
}
