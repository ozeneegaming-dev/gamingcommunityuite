import type { GcsForumSlotBundle, GcsForumRow as Row } from "@gcs/modules";
import { GcsAvatar, GcsMemberName } from "@gcs/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { forumHref, memberHref, tint, topicHref } from "@/lib/forum-urls";
import { GcsSlot, slotRootProps } from "@/lib/forum-slots";
import { forumRowVars } from "@/lib/template-data";
import { siteTemplate } from "@/lib/templates";
import { GcsIcon } from "@gcs/ui/icons";
import type { CSSProperties } from "react";
import { GcsForumIcon } from "./GcsForumIcon";
import { GcsForumStatsButton } from "./GcsForumStatsButton";
import { GcsRelTime } from "./GcsRelTime";

/** Iconița implicită a unei pagini („Pagină / Anunț”) fără iconiță aleasă. */
export const PAGE_ICON = "fa-solid fa-bullhorn";

/**
 * Un forum în listă (macheta Main): icon, nume, descriere, subforumuri, contoare și ultimul mesaj. Dacă tema a
 * modificat șablonul `forum.row` (ACP → Aspect → Șabloane), markup-ul vine din el.
 *
 * Forum v2: sloturile extensiilor (`forum.row.title` lângă titlu, `forum.row.meta` sub descriere) și stilul lor pe
 * rădăcina rândului (clase + variabile CSS, peste `--gcs-forum-color`). O pagină („Pagină / Anunț”) apare ca un forum,
 * cu iconița ei (implicit un megafon); contoarele și ultimul mesaj doar dacă pagina are topicuri dedesubt.
 */
export async function GcsForumRow({ forum, accent, slots }: { forum: Row; accent: string | null; slots?: GcsForumSlotBundle | undefined }) {
  const titleSlot = <GcsSlot slot="forum.row.title" items={slots?.title} as="span" />;
  const metaSlot = <GcsSlot slot="forum.row.meta" items={slots?.meta} />;
  const custom = await siteTemplate("forum.row", forumRowVars(forum, accent, slots?.style), { title_extra: titleSlot, meta: metaSlot });
  if (custom) return custom;
  const t = await getTranslations("forum");
  const color = forum.color ?? accent ?? "#FF6B74";
  const href = forum.type === "LINK" ? (forum.linkUrl ?? "#") : forumHref(forum);
  const external = forum.type === "LINK";
  const page = forum.type === "PAGE";
  const counts = !external && (!page || forum.pageTopics);
  const base = forum.color || accent ? ({ "--gcs-forum-color": forum.color ?? accent } as CSSProperties) : undefined;

  return (
    // `--gcs-forum-color`: bara mică din stânga, în aspectul „Carduri separate”.
    <div {...slotRootProps(slots?.style, { className: "gcs-forumRow", style: base })} data-testid="gcs-forum-row" data-forum-type={forum.type} data-forum-id={forum.id} {...(forum.unread ? { "data-unread": "" } : {})}>
      <span className="gcs-forumRow__icon" style={{ background: tint(color) }}>
        <GcsForumIcon icon={external ? "fa-solid fa-link" : page ? (forum.icon ?? PAGE_ICON) : forum.icon} color={color} />
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
          {titleSlot}
        </span>
        {forum.description && <span className="gcs-forumRow__desc">{forum.description}</span>}
        {metaSlot}
        {forum.subforums.length > 0 && (
          // Subforumurile pe coloane (setarea forumului din ACP), fiecare cu iconița lui.
          <ul className="gcs-forumRow__subs" aria-label={t("subforums")} style={{ gridTemplateColumns: `repeat(${forum.subforumColumns}, minmax(0, 1fr))` }} data-columns={forum.subforumColumns} data-testid="gcs-subforums">
            {forum.subforums.map((s) => (
              <li key={s.id}>
                <GcsForumIcon icon={s.icon ?? "fa-regular fa-comment"} color="var(--gcs-muted)" size={12} />
                <Link href={forumHref(s)}>{s.name}</Link>
                <GcsSlot slot="forum.row.sub" items={slots?.subs[s.id]} as="span" />
                <span className="gcs-forumRow__subCount" title={t("topicsCount", { count: s.topicsCount })}>
                  {s.topicsCount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {counts && (
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
      {counts && (
        // Butonul pătrat și bula statisticilor (carduri separate; „Statistici forum: La hover”).
        <span className="gcs-forumRow__statsTool">
          <GcsForumStatsButton label={t("statsOf", { name: forum.name })} bubbleId={`gcs-forum-stats-${forum.id}`} />
          <span className="gcs-forumRow__bubble" id={`gcs-forum-stats-${forum.id}`} role="note" data-testid="gcs-forum-bubble">
            <span>{t.rich("statsTopics", { count: forum.topicsCount, b: (c) => <b>{c}</b> })}</span>
            <span>{t.rich("statsPosts", { count: forum.postsCount, b: (c) => <b>{c}</b> })}</span>
          </span>
        </span>
      )}
      {counts && (
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
                  <span className="gcs-forumRow__when">
                    <GcsIcon name="fa-regular fa-clock" />
                    <GcsRelTime at={forum.last.at} />
                  </span>
                </span>
              </div>
            </>
          ) : (
            <span className="gcs-muted">{t("noPosts")}</span>
          )}
        </div>
      )}
      {page && !counts && (
        <span className="gcs-forumRow__pageHint" data-testid="gcs-forum-page-hint">
          <GcsIcon name="fa-regular fa-file-lines" />
          {t("pageHint")}
        </span>
      )}
    </div>
  );
}
