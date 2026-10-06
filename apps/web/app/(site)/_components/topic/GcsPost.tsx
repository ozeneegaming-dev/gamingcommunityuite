import { isSafeBanner, type GcsReactionView } from "@gcs/core";
import type { GcsPostbitData, GcsPostView } from "@gcs/modules";
import { GcsAvatar, GcsBadge, GcsTooltip, GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
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
  /** Cardul autorului (etapa 5): grupul, XP-ul, insignele, câmpurile, online. */
  postbit?: GcsPostbitData | null;
};

/** O postare (macheta Topic): coloana autorului (server) și conținutul cu acțiunile (client). */
export async function GcsPost({ topicId, forumId, post, isSolved, reactionList, can, actorId, ignored = false, translate = null, postbit = null }: Props) {
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
      <div className="gcs-post__author gcs-postbit" data-testid="gcs-postbit">
        {author ? <GcsPostbit author={author} data={postbit} /> : <span className="gcs-muted">—</span>}
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

/**
 * Cardul autorului (specul etapei 5, „Postbit”): avatarul cu rama și statusul online, numele stilizat, titlul custom,
 * grupul ca banner cu iconiță, VIP, rangul cu bara de XP, insignele (numărul și ultimele 5), contoarele, data înscrierii
 * și câmpurile alese din ACP (cu iconițe; „Select cu imagini” arată imaginea).
 */
async function GcsPostbit({ author, data }: { author: NonNullable<GcsPostView["author"]>; data: GcsPostbitData | null }) {
  const t = await getTranslations("topic.author");
  const format = await getFormatter();
  const groupColor = data?.group.color ?? author.groupColor;
  const banner = data?.group.banner && isSafeBanner(data.group.banner) ? data.group.banner : groupColor ? tint(groupColor, 0.22) : undefined;
  return (
    <>
      <span className="gcs-postbit__avatar">
        <GcsAvatar name={author.name} size="l" {...(author.image ? { src: author.image } : {})} {...(author.frameKey ? { frame: author.frameKey } : {})} />
        {data?.online && <span className="gcs-postbit__online" role="img" aria-label={t("online")} title={t("online")} data-testid="gcs-postbit-online" />}
      </span>
      <span className="gcs-post__authorName">
        <GcsUserLink userId={author.id} name={author.name} nameKey={author.nameKey} href={memberHref(author)} />
      </span>
      {data?.customTitle && <span className="gcs-postbit__title">{data.customTitle}</span>}
      <span className="gcs-postbit__group" style={{ background: banner, color: groupColor ?? undefined }} data-testid="gcs-postbit-group">
        {data?.group.icon && <GcsIcon name={data.group.icon} />}
        {data?.group.name ?? author.groupTitle ?? author.groupName}
      </span>
      {data?.vip && (
        <GcsBadge tone="accent" data-testid="gcs-postbit-vip">
          <GcsIcon name="fa-solid fa-crown" /> VIP
        </GcsBadge>
      )}
      {author.rank && (
        <span className="gcs-post__rank" data-testid="gcs-post-rank">
          {author.rank.icon && <span aria-hidden="true">{author.rank.icon} </span>}
          {author.rank.name}
        </span>
      )}
      {data && (
        <div className="gcs-postbit__xp" data-testid="gcs-postbit-xp">
          <div
            className="gcs-postbit__xpBar"
            role="progressbar"
            aria-label={t("xp")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={data.xp.percent}
            aria-valuetext={data.xp.next !== null ? t("xpTo", { points: data.xp.points, next: data.xp.next, rank: data.xp.nextRank ?? "" }) : t("xpMax", { points: data.xp.points })}
          >
            <span style={{ width: `${data.xp.percent}%` }} />
          </div>
          <span className="gcs-postbit__xpText">
            {data.xp.next !== null ? `${format.number(data.xp.points)} / ${format.number(data.xp.next)} XP` : `${format.number(data.xp.points)} XP`}
          </span>
        </div>
      )}
      {data && data.badges.count > 0 && (
        <div className="gcs-postbit__badges" data-testid="gcs-postbit-badges">
          <span className="gcs-postbit__badgeCount">{t("badges", { count: data.badges.count })}</span>
          <ul>
            {data.badges.recent.map((b) => (
              <li key={b.key}>
                <GcsTooltip content={b.name}>
                  <span className="gcs-postbit__badge" style={{ background: tint(b.color, 0.2), color: b.color }} aria-label={b.name} role="img" tabIndex={0}>
                    {b.image ? <img src={b.image} alt="" /> : b.symbol?.startsWith("fa-") ? <GcsIcon name={b.symbol} /> : (b.symbol ?? b.name.charAt(0))}
                  </span>
                </GcsTooltip>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="gcs-post__authorStats">
        <div>
          <strong>{format.number(author.postsCount)}</strong>
          {t("posts")}
        </div>
        <div>
          <strong className={author.reputation >= 0 ? "gcs-rep--pos" : "gcs-rep--neg"}>
            {author.reputation > 0 ? `+${format.number(author.reputation)}` : format.number(author.reputation)}
          </strong>
          {t("reputation")}
        </div>
      </div>
      {data && data.fields.length > 0 && (
        <dl className="gcs-postbit__fields" data-testid="gcs-postbit-fields">
          {data.fields.map((f) => (
            <div key={f.key} data-field={f.key}>
              <dt>
                {f.icon && <GcsIcon name={f.icon} />}
                {f.label}
              </dt>
              <dd>
                {f.image && <img src={f.image} alt="" className="gcs-postbit__fieldImage" />}
                {f.type === "URL" ? (
                  <a href={f.value} rel="noopener nofollow ugc" target="_blank">
                    {f.value.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  f.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <span className="gcs-postbit__joined">{t("joined", { date: format.dateTime(new Date(author.joinedAt), { dateStyle: "medium" }) })}</span>
    </>
  );
}
