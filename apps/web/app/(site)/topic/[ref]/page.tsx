import { parseRef } from "@gcs/modules";
import { GcsBadge, GcsButton, GcsCard, GcsUserLink } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumQuery, pageParam } from "@/lib/forum-page";
import { memberHref, tagHref, tint, topicHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { registerTopicView } from "@/lib/topic-views";
import { GcsBreadcrumb } from "../../_components/forum/GcsBreadcrumb";
import { GcsFollowButton } from "../../_components/forum/GcsForumButtons";
import { GcsPagination } from "../../_components/forum/GcsPagination";
import { GcsPollCard } from "../../_components/topic/GcsPollCard";
import { GcsPost } from "../../_components/topic/GcsPost";
import { GcsReplyBox } from "../../_components/topic/GcsReplyBox";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ref = parseRef((await params).ref);
  const topic = ref ? await services().db.topic.findUnique({ where: { id: ref.id }, select: { title: true, visibility: true } }) : null;
  return topic && topic.visibility === "VISIBLE" ? { title: topic.title } : {};
}

const has = (powers: string[], power: string) => powers.includes("*") || powers.includes(power);

/** Pagina unui topic (macheta Topic): antetul, sondajul, postările, paginarea și caseta de răspuns. */
export default async function TopicPage({ params, searchParams }: Props) {
  const ref = parseRef((await params).ref);
  if (!ref) notFound();
  const page = pageParam((await searchParams).page);
  const actor = await currentActor();
  const { forumQueries, readMarkers, permissions } = services();
  const t = await getTranslations("topic");
  const tf = await getTranslations("forum");
  const format = await getFormatter();

  const data = await forumQuery(() => forumQueries.topic(actor, ref.id, { page }));
  if (data === "forbidden") {
    return (
      <GcsCard style={{ padding: 24 }} role="alert">
        {tf("forbidden")}
      </GcsCard>
    );
  }
  const { topic, forum } = data;
  if (ref.slug !== topic.slug) permanentRedirect(topicHref(topic, page));

  const visibleIds = data.posts.filter((p) => p.visibility === "VISIBLE").map((p) => p.id);
  const [maxUploadMb] = await Promise.all([
    actor.userId ? permissions.groupValue<number | boolean>(actor, "upload.max_mb") : Promise.resolve(0),
    registerTopicView(actor, topic.id),
    actor.userId && visibleIds.length > 0 ? readMarkers.markRead(actor.userId, topic.id, Math.max(...visibleIds)) : Promise.resolve(),
  ]);
  const isTopicAuthor = actor.userId !== null && actor.userId === topic.author?.id;
  const canSolve = forum.type === "QA" && (isTopicAuthor || has(data.modPowers, "edit"));

  return (
    <>
      <GcsBreadcrumb crumbs={data.breadcrumb} />
      <section className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <div className="gcs-topicRow__badges">
            {topic.prefix && (
              <span className="gcs-badge" style={{ background: tint(topic.prefix.color, 0.16), color: topic.prefix.color }}>
                {topic.prefix.name}
              </span>
            )}
            {topic.solvedPostId !== null && <GcsBadge tone="ok">{tf("solved")}</GcsBadge>}
            {topic.pinned && <GcsBadge tone="accent">{tf("pinned")}</GcsBadge>}
            {topic.locked && <GcsBadge tone="neutral">{tf("locked")}</GcsBadge>}
            {topic.visibility === "PENDING" && <GcsBadge tone="warn">{tf("pending")}</GcsBadge>}
            {topic.visibility === "HIDDEN" && <GcsBadge tone="neutral">{tf("hidden")}</GcsBadge>}
          </div>
          <h1 className="gcs-display gcs-pageHeader__title">{topic.title}</h1>
          <div className="gcs-topicMeta">
            {topic.author && (
              <span>
                {t("startedBy")}{" "}
                <GcsUserLink userId={topic.author.id} name={topic.author.name} groupKey={topic.author.groupKey} href={memberHref(topic.author.id)} /> ·{" "}
                {format.dateTime(new Date(topic.createdAt), { dateStyle: "medium" })}
              </span>
            )}
            <span>{tf("replies", { count: topic.repliesCount })}</span>
            <span>{tf("views", { count: topic.viewsCount })}</span>
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
            <GcsButton variant="primary" asChild>
              <a href="#reply">{t("reply")}</a>
            </GcsButton>
          )}
        </div>
      </section>

      {data.poll && (
        <GcsPollCard
          poll={data.poll}
          loggedIn={actor.userId !== null}
          closesLabel={data.poll.closesAt ? format.dateTime(new Date(data.poll.closesAt), { dateStyle: "medium", timeStyle: "short" }) : null}
        />
      )}

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
            can={{
              react: actor.userId !== null && post.visibility === "VISIBLE",
              quote: data.canReply,
              report: actor.userId !== null && post.visibility === "VISIBLE",
              restore: has(data.modPowers, "hide"),
              delete: has(data.modPowers, "delete"),
              solve: canSolve && post.id !== topic.firstPostId && post.visibility === "VISIBLE",
            }}
          />
        ))}
      </div>
      <GcsPagination pagination={data.pagination} href={(p) => topicHref(topic, p)} />

      {data.canReply ? (
        <GcsReplyBox topicId={topic.id} forumId={forum.id} maxUploadMb={typeof maxUploadMb === "number" ? maxUploadMb : 0} />
      ) : (
        <GcsCard style={{ padding: 18, color: "var(--gcs-muted)" }} data-testid="gcs-no-reply">
          {topic.locked ? (
            t("lockedNotice")
          ) : !actor.userId ? (
            <>
              {t("loginToReply")}{" "}
              <Link href="/login">{t("login")}</Link>
            </>
          ) : null}
        </GcsCard>
      )}
    </>
  );
}
