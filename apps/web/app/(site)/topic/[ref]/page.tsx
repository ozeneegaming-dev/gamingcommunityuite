import { allowedBlocks, parseRef, savedActionsForForum, TOPIC_RATING_TYPE } from "@gcs/modules";
import { GcsBadge, GcsButton, GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { topicOpenPlan } from "@/lib/topic-open";
import { GcsScrollToPost } from "../../_components/topic/GcsScrollToPost";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumQuery, moveTargets, pageParam } from "@/lib/forum-page";
import { forumHref, memberHref, newTopicHref, tagHref, tint, topicHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { excerpt, firstImage, guestActor } from "@/lib/seo";
import { GcsGuestCta } from "../../_components/GcsGuestCta";
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
import { GcsDeletedMember } from "../../_components/GcsDeletedMember";
import { namesHtml } from "@/lib/member-names";
import { forumLocked } from "@/lib/forum-access";
import { GcsSlot, GcsSlotStyles, topicBarSlots } from "@/lib/forum-slots";
import { GcsForumPasswordForm } from "../../_components/forum/GcsForumGates";
import { GcsShareMenu } from "../../_components/topic/GcsShareMenu";
import { GcsTopicRating } from "../../_components/topic/GcsTopicRating";
import { GcsMultiQuoteBar } from "../../_components/topic/GcsMultiQuote";
import { GcsArchivedBanner, GcsTimeGap, GcsTopicNotices, GcsTopicSummaryBlock } from "../../_components/topic/GcsTopicV2";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Titlu, descriere (primul paragraf), prima imagine și `canonical`; un topic invizibil vizitatorilor nu se indexează. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const ref = parseRef((await params).ref);
  if (!ref) return {};
  const { db, permissions } = services();
  const topic = await db.topic.findUnique({
    where: { id: ref.id },
    select: { id: true, title: true, slug: true, visibility: true, forumId: true, forum: { select: { passwordHash: true, ownTopicsOnly: true } }, posts: { orderBy: { id: "asc" }, take: 1, select: { contentHtml: true } } },
  });
  if (!topic || topic.visibility !== "VISIBLE") return {};
  // Forum v2: un forum cu parolă sau „doar topicurile mele” nu-și dă conținutul în metadate.
  const closed = topic.forum.passwordHash !== null || topic.forum.ownTopicsOnly;
  const page = pageParam((await searchParams).page);
  const html = closed ? "" : (topic.posts[0]?.contentHtml ?? "");
  const image = firstImage(html);
  const description = excerpt(html);
  const publicRead = !closed && (await permissions.can(await guestActor(), "forums.read", { type: "forum", id: String(topic.forumId) }));
  return {
    title: topic.title,
    description,
    alternates: { canonical: topicHref(topic, page) },
    openGraph: { title: topic.title, description, type: "article", url: topicHref(topic, page), ...(image ? { images: [image] } : {}) },
    ...(publicRead ? {} : { robots: { index: false } }),
  };
}

const has = (powers: string[], power: string) => powers.includes("*") || powers.includes(power);

/**
 * Pagina unui topic (macheta Topic): antetul, sondajul, postările, paginarea și caseta de răspuns. Forum v2: bara
 * extensiilor (`topic.bar`), nota cu stele, mesajele moderatorilor, răspunsul recomandat, separatorii de timp, rezumatul,
 * distribuirea, „Topic nou”, arhivarea și parola forumului.
 */
export default async function TopicPage({ params, searchParams }: Props) {
  const ref = parseRef((await params).ref);
  if (!ref) notFound();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const actor = await currentActor();
  const { forumQueries, readMarkers, permissions, social, settings, ratings, moderation, topicTools } = services();
  // Setări → Vizualizarea conținutului: deschis din altă pagină, topicul sare la prima necitită / ultima postare.
  const openPlan = await topicOpenPlan(actor, ref.id, { hasPage: sp.page !== undefined });
  if (openPlan.kind === "redirect") redirect(openPlan.href);
  // Setări → Semnătură: „arată semnăturile celorlalți” (implicit da).
  const showSignatures = actor.userId ? (await services().memberPrefs.get(actor.userId)).showSignatures : true;
  const t = await getTranslations("topic");
  const tf = await getTranslations("forum");
  const format = await getFormatter();
  const locale = await getLocale();

  const data = await forumQuery(() => forumQueries.topic(actor, ref.id, { page, locale }));
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
  // Forum v2: forumul cu parolă (deblocată în acest browser; moderatorii intră direct).
  if (forum.options.hasPassword && (await forumLocked(actor, forum.id))) {
    return (
      <GcsWidgetPage page="topic">
        <GcsBreadcrumb crumbs={data.breadcrumb} />
        <GcsForumPasswordForm forumId={forum.id} name={forum.name} />
      </GcsWidgetPage>
    );
  }
  // Mențiunile din conținutul salvat: stilul numelui de acum (grupul afișat, efectul VIP pe litere).
  const all = data.recommended ? [...data.posts, data.recommended] : data.posts;
  const postHtml = await namesHtml(all.map((p) => p.html));
  all.forEach((p, i) => (p.html = postHtml[i]!));

  const visibleIds = data.posts.filter((p) => p.visibility === "VISIBLE").map((p) => p.id);
  const ignored = new Set(await social.ignoredIds(actor.userId, "posts"));
  const isMod = data.modPowers.length > 0;
  const authorIds = all.flatMap((p) => (p.author ? [p.author.id] : []));
  const archived = topic.archivedAt !== null;
  const [maxUploadMb, , targets, , readers, tl, translate, postbits, clanTags, slots, rating, distribution, savedActions, canCreate, blocks, summaryOn, summaryMin, summaryPos, summaryDevices, modNames] = await Promise.all([
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
    // Forum v2: bara extensiilor (Servere, Recrutare…), nota cu stele și uneltele moderatorilor.
    topicBarSlots({ id: forum.id, type: forum.type, parentId: null, name: forum.name, slug: forum.slug }, { id: topic.id, title: topic.title, authorId: topic.author?.id ?? null }),
    topic.rating ? ratings.view(actor, TOPIC_RATING_TYPE, String(topic.id)) : Promise.resolve(null),
    topic.rating && topic.rating.count > 0 ? ratings.distribution(TOPIC_RATING_TYPE, String(topic.id)) : Promise.resolve([]),
    isMod ? moderation.listActions() : Promise.resolve([]),
    actor.userId && !archived ? permissions.can(actor, "forums.create", { type: "forum", id: String(forum.id) }) : Promise.resolve(false),
    actor.userId ? allowedBlocks(services(), actor) : Promise.resolve([]),
    settings.get<boolean>("forums.summary_enabled"),
    settings.get<number>("forums.summary_min_replies"),
    settings.get<string>("forums.summary_position"),
    settings.get<string>("forums.summary_devices"),
    topicTools.modNamesPublic(),
  ]);
  const summary = summaryOn && topic.repliesCount >= summaryMin ? await forumQueries.topicSummary(topic.id) : null;
  const summaryBlock = summary ? <GcsTopicSummaryBlock topicId={topic.id} summary={summary} devices={summaryDevices === "desktop" ? "desktop" : "all"} /> : null;
  const isTopicAuthor = actor.userId !== null && actor.userId === topic.author?.id;
  const canSolve = forum.type === "QA" && (isTopicAuthor || has(data.modPowers, "edit"));
  const canRecommend = has(data.modPowers, "feature") && !archived;
  const hostsTopics = forum.type === "FORUM" || forum.type === "QA" || forum.type === "PAGE";

  const postView = (post: (typeof data.posts)[number], recommended = false) => (
    <GcsPost
      key={`${recommended ? "rec-" : ""}${post.id}`}
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
      showSignature={showSignatures || (post.author !== null && post.author.id === actor.userId)}
      isTopicAuthor={post.author !== null && post.author.id === topic.author?.id && post.id !== topic.firstPostId}
      recommended={topic.recommendedPostId === post.id}
      canRecommend={canRecommend && post.id !== topic.firstPostId}
      blocks={blocks}
      can={{
        react: actor.userId !== null && post.visibility === "VISIBLE" && !archived,
        quote: data.canReply,
        report: actor.userId !== null && post.visibility === "VISIBLE",
        restore: has(data.modPowers, "hide"),
        delete: has(data.modPowers, "delete"),
        solve: canSolve && post.id !== topic.firstPostId && post.visibility === "VISIBLE" && !archived,
        approve: has(data.modPowers, "approve"),
        split: has(data.modPowers, "split"),
      }}
    />
  );

  return (
    <GcsWidgetPage page="topic">
      <GcsSlotStyles plugins={slots.plugins} />
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
            {archived && <GcsBadge tone="neutral" icon={<GcsIcon name="fa-solid fa-box-archive" />}>{tf("archived")}</GcsBadge>}
            {topic.visibility === "PENDING" && <GcsBadge tone="warn" icon={<GcsIcon name="fa-solid fa-hourglass-half" />}>{tf("pending")}</GcsBadge>}
            {topic.visibility === "HIDDEN" && <GcsBadge tone="neutral" icon={<GcsIcon name="fa-solid fa-eye-slash" />}>{tf("hidden")}</GcsBadge>}
          </div>
          <h1 className="gcs-display gcs-pageHeader__title">{topic.title}</h1>
          <div className="gcs-topicMeta">
            <span>
              {t("startedBy")}{" "}
              {topic.author ? <GcsMemberName userId={topic.author.id} name={topic.author.name} nameKey={topic.author.nameKey} href={memberHref(topic.author)} /> : <GcsDeletedMember />} ·{" "}
              {format.dateTime(new Date(topic.createdAt), { dateStyle: "medium" })}
            </span>
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
          {rating && (
            <GcsTopicRating
              topicId={topic.id}
              avg={rating.avg}
              count={rating.count}
              mine={rating.mine}
              canRate={rating.canRate}
              reason={rating.reason}
              canChange={rating.canChange}
              distribution={distribution}
              loginHref="/login"
            />
          )}
        </div>
        <div className="gcs-pageHeader__actions">
          {actor.userId && <GcsFollowButton contentType="topic" contentId={topic.id} following={data.follow.following} count={data.follow.count} />}
          <GcsShareMenu path={topicHref(topic)} title={topic.title} />
          {canCreate && hostsTopics && (
            <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-plus" />}>
              <Link href={newTopicHref(forum)} data-testid="gcs-topic-new">
                {tf("newTopic")}
              </Link>
            </GcsButton>
          )}
          {data.canReply && (
            <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-reply" />}>
              <a href="#reply">{t("reply")}</a>
            </GcsButton>
          )}
        </div>
      </section>

      <GcsSlot slot="topic.bar" items={slots.items} className="gcs-topicBar" />
      {archived && <GcsArchivedBanner at={topic.archivedAt!} />}
      <GcsTopicNotices notices={data.notices} showNames={modNames || isMod} canDelete={has(data.modPowers, "edit")} />

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
            savedActions={savedActionsForForum(savedActions, forum.id)}
            requireApproval={topic.requireApproval}
            archived={archived}
            rating={topic.rating ? { count: topic.rating.count } : null}
            botNotes={await services().communityBot.enabled("moderation_notes")}
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
      {summaryPos !== "bottom" && summaryBlock}

      <GcsTopicLive
        topicId={topic.id}
        viewerId={actor.userId}
        initialReaders={readers}
        unreadHref={`${topicHref(topic)}/unread`}
        labels={Object.fromEntries(["readers", "guests", "typing", "typingMany", "newPosts", "newPost", "show"].map((k) => [k, tl.raw(k) as string])) as Parameters<typeof GcsTopicLive>[0]["labels"]}
      />
      <GcsPagination pagination={data.pagination} href={(p) => topicHref(topic, p)} />
      {openPlan.kind === "focus" && <GcsScrollToPost postId={openPlan.postId} />}
      {data.recommended && (
        // Răspunsul recomandat de staff, sus pe prima pagină (rămâne și la locul lui în topic).
        <section className="gcs-recommended" aria-label={t("recommendedTitle")} data-testid="gcs-recommended">
          <h2 className="gcs-display gcs-recommended__title">
            <GcsIcon name="fa-solid fa-award" className="gcs-hIcon" />
            {t("recommendedTitle")}
          </h2>
          {postView(data.recommended, true)}
        </section>
      )}
      <div className="gcs-postList" data-gcs-gallery="topic">
        {data.posts.map((post, i) => {
          const prev = i > 0 ? data.posts[i - 1] : undefined;
          return [prev ? <GcsTimeGap key={`gap-${post.id}`} from={prev.createdAt} to={post.createdAt} /> : null, postView(post)];
        })}
      </div>
      <GcsPagination pagination={data.pagination} href={(p) => topicHref(topic, p)} />
      {summaryPos === "bottom" && summaryBlock}

      {data.canReply ? (
        <>
          <GcsMultiQuoteBar topicId={topic.id} />
          <GcsReplyBox
            topicId={topic.id}
            forumId={forum.id}
            maxUploadMb={typeof maxUploadMb === "number" ? maxUploadMb : 0}
            maxLength={await services().settings.get<number>("forums.post_max_chars")}
            blocks={blocks}
          />
        </>
      ) : !actor.userId && !topic.locked && !archived ? (
        // Vizitatorii: blocul cu înregistrarea, autentificarea și conectarea dintr-un click (macheta GuestCta).
        <GcsGuestCta variant="reply" returnTo={topicHref(topic)} headingId="gcs-guest-cta-reply" />
      ) : (
        <GcsCard style={{ padding: 18, color: "var(--gcs-muted)" }} data-testid="gcs-no-reply">
          {archived ? (
            <>
              <GcsIcon name="fa-solid fa-box-archive" className="gcs-emptyIcon" />
              {t("archivedReply")}
            </>
          ) : topic.locked ? (
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
