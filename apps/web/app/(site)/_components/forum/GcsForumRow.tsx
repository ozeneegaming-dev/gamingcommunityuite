import type { GcsForumRow as Row } from "@gcs/modules";
import { GcsAvatar, GcsUserLink } from "@gcs/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { forumHref, memberHref, tint, topicHref } from "@/lib/forum-urls";
import { GcsForumIcon } from "./GcsForumIcon";
import { GcsRelTime } from "./GcsRelTime";

/** Un forum în listă (macheta Main): icon, nume, descriere, subforumuri, contoare și ultimul mesaj. */
export async function GcsForumRow({ forum, accent }: { forum: Row; accent: string | null }) {
  const t = await getTranslations("forum");
  const color = forum.color ?? accent ?? "#FF6B74";
  const href = forum.type === "LINK" ? (forum.linkUrl ?? "#") : forumHref(forum);
  const external = forum.type === "LINK";

  return (
    <div className="gcs-forumRow" data-testid="gcs-forum-row">
      <span className="gcs-forumRow__icon" style={{ background: tint(color) }}>
        <GcsForumIcon icon={external ? "link" : forum.icon} color={color} />
      </span>
      <div className="gcs-forumRow__main">
        <span className="gcs-forumRow__title">
          {external ? (
            <a href={href} rel="noopener nofollow" target="_blank">
              {forum.name}
              <span className="gcs-srOnly"> ({t("external")})</span>
            </a>
          ) : (
            <Link href={href}>{forum.name}</Link>
          )}
          {forum.unread && <span className="gcs-dot gcs-dot--unread" role="img" aria-label={t("unread")} data-testid="gcs-unread-dot" />}
        </span>
        {forum.description && <span className="gcs-forumRow__desc">{forum.description}</span>}
        {forum.subforums.length > 0 && (
          <span className="gcs-forumRow__subs">
            {t("subforums")}{" "}
            {forum.subforums.map((s, i) => (
              <span key={s.id}>
                {i > 0 && " · "}
                <Link href={forumHref(s)}>{s.name}</Link>
              </span>
            ))}
          </span>
        )}
      </div>
      {!external && (
        <div className="gcs-forumRow__stats">
          <div>
            <strong>{forum.topicsCount}</strong>
            {t("topics")}
          </div>
          <div>
            <strong>{forum.postsCount}</strong>
            {t("posts")}
          </div>
        </div>
      )}
      {!external && (
        <div className="gcs-forumRow__last">
          {forum.last ? (
            <>
              {forum.last.user ? (
                <GcsAvatar name={forum.last.user.name} size="s" {...(forum.last.user.image ? { src: forum.last.user.image } : {})} {...(forum.last.user.frameKey ? { frame: forum.last.user.frameKey } : {})} />
              ) : null}
              <div className="gcs-forumRow__lastText">
                <Link href={topicHref({ id: forum.last.topicId, slug: forum.last.topicSlug })} className="gcs-forumRow__lastTitle">
                  {forum.last.topicTitle}
                </Link>
                <span>
                  {forum.last.user && (
                    <>
                      {t("byWord")}{" "}
                      <GcsUserLink
                        userId={forum.last.user.id}
                        name={forum.last.user.name}
                        nameKey={forum.last.user.nameKey}
                        href={memberHref(forum.last.user)}
                      />{" "}
                      ·{" "}
                    </>
                  )}
                  <GcsRelTime at={forum.last.at} />
                </span>
              </div>
            </>
          ) : (
            <span className="gcs-muted">{t("noPosts")}</span>
          )}
        </div>
      )}
    </div>
  );
}
