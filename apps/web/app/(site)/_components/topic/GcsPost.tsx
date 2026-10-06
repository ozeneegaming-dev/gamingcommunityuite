import type { GcsReactionView } from "@gcs/core";
import type { GcsPostView } from "@gcs/modules";
import { GcsAvatar, GcsBadge, GcsUserLink } from "@gcs/ui";
import { getFormatter, getTranslations } from "next-intl/server";
import { memberHref, postHref, tint } from "@/lib/forum-urls";
import { GcsTranslateButton, type GcsTranslateLabels } from "../GcsTranslateButton";
import { GcsPostContent, type GcsPostContentProps } from "./GcsPostContent";

type Props = {
  topicId: number;
  forumId: number;
  post: GcsPostView;
  isSolved: boolean;
  reactionList: GcsReactionView[];
  can: Omit<GcsPostContentProps["can"], "edit" | "hide">;
  actorId: string | null;
  /** Autorul e ignorat de viewer: postarea apare pliată, cu „arată” (specul etapei 3, §8). */
  ignored?: boolean;
  /** Etichetele butonului „Traduce” (etapa 5), dacă viewer-ul îl are. */
  translate?: GcsTranslateLabels | null;
};

/** O postare (macheta Topic): coloana autorului (server) și conținutul cu acțiunile (client). */
export async function GcsPost({ topicId, forumId, post, isSolved, reactionList, can, actorId, ignored = false, translate = null }: Props) {
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

  const article = (
    <article
      id={`post-${post.id}`}
      className={`gcs-card gcs-post${isSolved ? " gcs-post--solved" : ""}${post.visibility !== "VISIBLE" ? " gcs-post--muted" : ""}`}
      data-testid="gcs-post"
      data-post-id={post.id}
    >
      <div className="gcs-post__author">
        {author ? (
          <>
            <GcsAvatar name={author.name} size="l" {...(author.image ? { src: author.image } : {})} {...(author.frameKey ? { frame: author.frameKey } : {})} />
            <span className="gcs-post__authorName">
              <GcsUserLink userId={author.id} name={author.name} nameKey={author.nameKey} href={memberHref(author)} />
            </span>
            {author.groupColor ? (
              <span className="gcs-badge" style={{ background: tint(author.groupColor, 0.16), color: author.groupColor }}>
                {author.groupTitle ?? author.groupName}
              </span>
            ) : (
              <GcsBadge tone="neutral">{author.groupTitle ?? author.groupName}</GcsBadge>
            )}
            {author.rank && (
              <span className="gcs-post__rank" data-testid="gcs-post-rank">
                {author.rank.icon && <span aria-hidden="true">{author.rank.icon} </span>}
                {author.rank.name}
              </span>
            )}
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
          attachments: post.attachments,
        }}
        isSolved={isSolved}
        reactions={post.reactions}
        myReaction={post.myReaction}
        reactionList={reactionList}
        permalink={postHref(topicId, post.id)}
        can={{ ...can, react: can.react && !own, report: can.report && !own, edit: post.canEdit, hide: post.canHide }}
      />
      {translate && post.visibility === "VISIBLE" && !own && <GcsTranslateButton contentType="forums.post" contentId={post.id} labels={translate} />}
    </article>
  );
  if (!ignored || !author) return article;
  return (
    <details className="gcs-post--ignored" data-testid="gcs-post-ignored">
      <summary className="gcs-card gcs-post--ignoredSummary">{t("ignored", { name: author.name })}</summary>
      {article}
    </details>
  );
}
