import type { GcsReactionView } from "@gcs/core";
import type { GcsPostView } from "@gcs/modules";
import { GcsAvatar, GcsBadge, GcsUserLink } from "@gcs/ui";
import { getFormatter, getTranslations } from "next-intl/server";
import { memberHref, postHref } from "@/lib/forum-urls";
import { GcsPostContent, type GcsPostContentProps } from "./GcsPostContent";

type Props = {
  topicId: number;
  forumId: number;
  post: GcsPostView;
  isSolved: boolean;
  reactionList: GcsReactionView[];
  can: Omit<GcsPostContentProps["can"], "edit" | "hide">;
  actorId: string | null;
};

/** O postare (macheta Topic): coloana autorului (server) și conținutul cu acțiunile (client). */
export async function GcsPost({ topicId, forumId, post, isSolved, reactionList, can, actorId }: Props) {
  const t = await getTranslations("topic");
  const format = await getFormatter();
  const author = post.author;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const edited = post.editedAt
    ? post.editedBy && post.editedBy.id !== author?.id
      ? t("editedBy", { name: post.editedBy.name, when: date(post.editedAt) })
      : t("edited", { when: date(post.editedAt) })
    : null;
  const own = actorId !== null && actorId === author?.id;

  return (
    <article
      id={`post-${post.id}`}
      className={`gcs-card gcs-post${isSolved ? " gcs-post--solved" : ""}${post.visibility !== "VISIBLE" ? " gcs-post--muted" : ""}`}
      data-testid="gcs-post"
      data-post-id={post.id}
    >
      <div className="gcs-post__author">
        {author ? (
          <>
            <GcsAvatar name={author.name} size="l" {...(author.image ? { src: author.image } : {})} />
            <span className="gcs-post__authorName">
              <GcsUserLink userId={author.id} name={author.name} groupKey={author.groupKey} href={memberHref(author.id)} />
            </span>
            <GcsBadge tone="neutral">{author.groupTitle ?? author.groupName}</GcsBadge>
            <div className="gcs-post__authorStats">
              <div>
                <strong>{format.number(author.postsCount)}</strong>
                {t("author.posts")}
              </div>
              <div>
                <strong className={author.reputation >= 0 ? "gcs-rep--pos" : "gcs-rep--neg"}>
                  {author.reputation > 0 ? `+${format.number(author.reputation)}` : format.number(author.reputation)}
                </strong>
                {t("author.reputation")}
              </div>
            </div>
          </>
        ) : (
          <span className="gcs-muted">—</span>
        )}
      </div>
      <GcsPostContent
        topicId={topicId}
        forumId={forumId}
        post={{
          id: post.id,
          number: post.number,
          html: post.html,
          visibility: post.visibility,
          date: date(post.createdAt),
          dateIso: post.createdAt,
          edited,
          hiddenReason: post.hiddenReason,
          authorId: author?.id ?? null,
          authorName: author?.name ?? "",
        }}
        isSolved={isSolved}
        reactions={post.reactions}
        myReaction={post.myReaction}
        reactionList={reactionList}
        permalink={postHref(topicId, post.id)}
        can={{ ...can, react: can.react && !own, report: can.report && !own, edit: post.canEdit, hide: post.canHide }}
      />
    </article>
  );
}
