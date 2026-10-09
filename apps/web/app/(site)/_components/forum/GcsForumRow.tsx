import type { GcsForumRow as Row } from "@gcs/modules";
import { GcsAvatar, GcsMemberName } from "@gcs/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { forumHref, memberHref, tint, topicHref } from "@/lib/forum-urls";
import { forumRowVars } from "@/lib/template-data";
import { siteTemplate } from "@/lib/templates";
import { GcsForumIcon } from "./GcsForumIcon";
import { GcsRelTime } from "./GcsRelTime";

/**
 * Un forum în listă (macheta Main): icon, nume, descriere, subforumuri, contoare și ultimul mesaj. Dacă tema a
 * modificat șablonul `forum.row` (ACP → Aspect → Șabloane), markup-ul vine din el.
 */
export async function GcsForumRow({ forum, accent }: { forum: Row; accent: string | null }) {
  const custom = await siteTemplate("forum.row", forumRowVars(forum, accent));
  if (custom) return custom;
  const t = await getTranslations("forum");
  const color = forum.color ?? accent ?? "#FF6B74";
  const href = forum.type === "LINK" ? (forum.linkUrl ?? "#") : forumHref(forum);
  const external = forum.type === "LINK";

  return (
    <div className="gcs-forumRow" data-testid="gcs-forum-row">
      <span className="gcs-forumRow__icon" style={{ background: tint(color) }}>
        <GcsForumIcon icon={external ? "fa-solid fa-link" : forum.icon} color={color} />
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
          // Subforumurile pe coloane (setarea forumului din ACP), fiecare cu iconița lui.
          <ul className="gcs-forumRow__subs" aria-label={t("subforums")} style={{ gridTemplateColumns: `repeat(${forum.subforumColumns}, minmax(0, 1fr))` }} data-columns={forum.subforumColumns} data-testid="gcs-subforums">
            {forum.subforums.map((s) => (
              <li key={s.id}>
                <GcsForumIcon icon={s.icon ?? "fa-regular fa-comment"} color="var(--gcs-muted)" size={12} />
                <Link href={forumHref(s)}>{s.name}</Link>
                <span className="gcs-forumRow__subCount" title={t("topicsCount", { count: s.topicsCount })}>
                  {s.topicsCount}
                </span>
              </li>
            ))}
          </ul>
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
                <GcsAvatar name={forum.last.user.name} size="s" userId={forum.last.user.id} {...(forum.last.user.image ? { src: forum.last.user.image } : {})} {...(forum.last.user.frameKey ? { frame: forum.last.user.frameKey } : {})} />
              ) : null}
              <div className="gcs-forumRow__lastText">
                <Link href={topicHref({ id: forum.last.topicId, slug: forum.last.topicSlug })} className="gcs-forumRow__lastTitle">
                  {forum.last.topicTitle}
                </Link>
                <span>
                  {forum.last.user && (
                    <>
                      {t("byWord")}{" "}
                      <GcsMemberName
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
