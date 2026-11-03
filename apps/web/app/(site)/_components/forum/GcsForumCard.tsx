import type { GcsForumCardMedia, GcsForumSlotBundle, GcsForumRow as Row } from "@gcs/modules";
import { GcsAvatar, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
import { forumHref, memberHref, topicHref } from "@/lib/forum-urls";
import { GcsSlot, slotRootProps } from "@/lib/forum-slots";
import { GcsForumIcon } from "./GcsForumIcon";
import { GcsRelTime } from "./GcsRelTime";

/**
 * Un forum în vederea în grilă (macheta „Carduri de forum”): sus zona de imagine (imaginea din ACP, prima poză a ultimei
 * postări, previzualizarea generată din ea sau gradientul cu iconița), apoi iconița, titlul cu contoarele pe același
 * bloc, descrierea, subforumurile (dosarul plin = mesaje noi) și, jos, ultimul mesaj. Tot cardul duce în forum (linkul
 * titlului se întinde peste card, `.gcs-forumRow__link::after`); subforumurile și ultimul mesaj își păstrează linkurile.
 * Clasa `gcs-forumRow` rămâne pe rădăcină: stilul extensiilor (Forum v2) și comportamentul rândurilor merg și aici.
 */
export async function GcsForumCard({
  forum,
  accent,
  slots,
  icon,
  titleSlot,
  metaSlot,
}: {
  forum: Row;
  accent: string | null;
  slots?: GcsForumSlotBundle | undefined;
  icon: string | null;
  titleSlot: ReactNode;
  metaSlot: ReactNode;
}) {
  const t = await getTranslations("forum");
  const external = forum.type === "LINK";
  const page = forum.type === "PAGE";
  const counts = !external && (!page || forum.pageTopics);
  const href = external ? (forum.linkUrl ?? "#") : forumHref(forum);
  const color = forum.color ?? accent;
  const base = color ? ({ "--gcs-forum-color": color } as CSSProperties) : undefined;
  const media: GcsForumCardMedia = forum.media ?? { kind: "empty" };
  const last = forum.last;
  const by = last?.user ?? null;

  return (
    <div
      {...slotRootProps(slots?.style, { className: "gcs-forumRow gcs-forumCard", style: base })}
      data-testid="gcs-forum-row"
      data-forum-type={forum.type}
      data-forum-id={forum.id}
      {...(forum.unread ? { "data-unread": "" } : {})}
    >
      {/* Decorativă: titlul și autorul din previzualizare sunt și în ultimul mesaj, cu linkurile lor. */}
      <div className="gcs-forumCard__media" aria-hidden="true" data-testid="gcs-forum-card-media" data-kind={media.kind} {...(media.kind === "image" ? { "data-source": media.source } : {})}>
        <CardMedia media={media} icon={icon} />
      </div>
      <div className="gcs-forumCard__body">
        <div className="gcs-forumCard__head">
          <span className="gcs-forumCard__icon" aria-hidden="true">
            <GcsForumIcon icon={icon} color="currentColor" size={17} />
          </span>
          <div className="gcs-forumCard__heading">
            <h3 className="gcs-forumRow__title gcs-forumCard__title">
              {external ? (
                <a href={href} rel="noopener nofollow" target="_blank" className="gcs-forumRow__link">
                  {forum.name}
                  <span className="gcs-srOnly"> ({t("external")})</span>
                </a>
              ) : (
                <Link href={href} className="gcs-forumRow__link">
                  {forum.name}
                </Link>
              )}
              {forum.unread && <span className="gcs-dot gcs-dot--unread" role="img" aria-label={t("unread")} data-testid="gcs-unread-dot" />}
              {titleSlot}
            </h3>
            {counts && (
              <span className="gcs-forumCard__stats" data-testid="gcs-forum-card-stats">
                {t.rich("cardStats", { topics: forum.topicsCount, posts: forum.postsCount, b: (c) => <b>{c}</b> })}
              </span>
            )}
          </div>
        </div>
        {forum.description && <p className="gcs-forumCard__desc">{forum.description}</p>}
        {metaSlot}
        {forum.subforums.length > 0 && (
          <ul className="gcs-forumCard__subs" aria-label={t("subforums")} data-testid="gcs-subforums">
            {forum.subforums.map((s) => (
              <li key={s.id} {...(s.unread ? { "data-unread": "" } : {})}>
                <Link href={forumHref(s)} className="gcs-forumCard__sub">
                  {/* Dosarul plin, în accent: subforumul are mesaje noi pentru vizitator; conturul: nimic nou. */}
                  <GcsIcon name={s.unread ? "fa-solid fa-folder" : "fa-regular fa-folder"} className="gcs-forumCard__folder" />
                  <span className="gcs-forumCard__subName">{s.name}</span>
                  {s.unread && <span className="gcs-srOnly"> ({t("unread")})</span>}
                </Link>
                <GcsSlot slot="forum.row.sub" items={slots?.subs[s.id]} as="span" />
              </li>
            ))}
          </ul>
        )}
      </div>
      {(counts || page) && (
        <div className="gcs-forumCard__last" data-testid="gcs-forum-card-last">
          {last ? (
            <>
              {by && <GcsAvatar name={by.name} size="s" userId={by.id} {...(by.image ? { src: by.image } : {})} {...(by.frameKey ? { frame: by.frameKey } : {})} />}
              <div className="gcs-forumCard__lastText">
                <Link href={topicHref({ id: last.topicId, slug: last.topicSlug })} className="gcs-forumCard__lastTitle">
                  {last.topicTitle}
                </Link>
                <span className="gcs-forumCard__lastBy">
                  {by ? (
                    t.rich("cardLastBy", {
                      name: () => <GcsMemberName userId={by.id} name={by.name} nameKey={by.nameKey} href={memberHref(by)} />,
                      when: () => <GcsRelTime at={last.at} />,
                    })
                  ) : (
                    <GcsRelTime at={last.at} />
                  )}
                </span>
              </div>
            </>
          ) : counts ? (
            <span className="gcs-forumCard__none">{t("noPosts")}</span>
          ) : (
            <span className="gcs-forumRow__pageHint" data-testid="gcs-forum-page-hint">
              <GcsIcon name="fa-regular fa-file-lines" />
              {t("pageHint")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Zona de imagine a cardului, după starea calculată de `cardMedia` (`@gcs/modules`). */
function CardMedia({ media, icon }: { media: GcsForumCardMedia; icon: string | null }) {
  if (media.kind === "image") {
    // Pozele externe din postare se cer fără referrer (ca în chat).
    return <img className="gcs-forumCard__img" src={media.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={media.position ? { objectPosition: media.position } : undefined} />;
  }
  if (media.kind === "generated") {
    return (
      <div className="gcs-forumCard__gen" data-testid="gcs-forum-card-generated">
        <span className="gcs-forumCard__quote" />
        <p className="gcs-forumCard__genTitle">{media.title}</p>
        {media.text && <p className="gcs-forumCard__genText">{media.text}</p>}
        {media.user && (
          <span className="gcs-forumCard__genBy">
            <GcsAvatar name={media.user.name} size="xs" userId={media.user.id} {...(media.user.image ? { src: media.user.image } : {})} {...(media.user.frameKey ? { frame: media.user.frameKey } : {})} />
            <GcsMemberName userId={media.user.id} name={media.user.name} nameKey={media.user.nameKey} />
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="gcs-forumCard__empty" data-testid="gcs-forum-card-empty">
      <GcsForumIcon icon={icon} color="currentColor" size={64} />
    </div>
  );
}
