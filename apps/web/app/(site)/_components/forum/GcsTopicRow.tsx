import type { GcsTopicRow as Row } from "@gcs/modules";
import { GcsAvatar, GcsBadge, GcsUserLink } from "@gcs/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { memberHref, tagHref, tint, topicHref, unreadHref } from "@/lib/forum-urls";
import { GcsRelTime } from "./GcsRelTime";

/** Un topic în listă: prefix, titlu, stări, tag-uri, autor, contoare și ultimul mesaj. */
export async function GcsTopicRow({ topic, select }: { topic: Row; select?: React.ReactNode }) {
  const t = await getTranslations("forum");
  return (
    <div className="gcs-topicRow" data-testid="gcs-topic-row" data-topic-id={topic.id}>
      {select}
      <span className="gcs-topicRow__avatar">
        {topic.author && <GcsAvatar name={topic.author.name} size="s" {...(topic.author.image ? { src: topic.author.image } : {})} />}
      </span>
      <div className="gcs-topicRow__main">
        <div className="gcs-topicRow__badges">
          {topic.pinned && <GcsBadge tone="accent">{t("pinned")}</GcsBadge>}
          {topic.featured && <GcsBadge tone="warn">{t("featured")}</GcsBadge>}
          {topic.solved && <GcsBadge tone="ok">{t("solved")}</GcsBadge>}
          {topic.locked && <GcsBadge tone="neutral">{t("locked")}</GcsBadge>}
          {topic.visibility === "PENDING" && <GcsBadge tone="warn">{t("pending")}</GcsBadge>}
          {topic.visibility === "HIDDEN" && <GcsBadge tone="neutral">{t("hidden")}</GcsBadge>}
          {topic.prefix && (
            <span className="gcs-badge" style={{ background: tint(topic.prefix.color, 0.16), color: topic.prefix.color }}>
              {topic.prefix.name}
            </span>
          )}
        </div>
        <span className="gcs-topicRow__title">
          <Link href={topicHref(topic)}>{topic.title}</Link>
          {topic.unread && (
            <Link href={unreadHref(topic.id)} className="gcs-topicRow__unread" data-testid="gcs-unread-link">
              <span className="gcs-dot gcs-dot--unread" aria-hidden="true" />
              {t("firstUnread")}
            </Link>
          )}
        </span>
        <span className="gcs-topicRow__meta">
          {topic.author && (
            <>
              {t("byWord")}{" "}
              <GcsUserLink userId={topic.author.id} name={topic.author.name} groupKey={topic.author.groupKey} href={memberHref(topic.author.id)} />
              {" · "}
            </>
          )}
          <GcsRelTime at={topic.createdAt} />
          {topic.tags.map((tag) => (
            <Link key={tag.slug} href={tagHref(tag.slug)} className="gcs-tag">
              #{tag.name}
            </Link>
          ))}
        </span>
      </div>
      <div className="gcs-topicRow__stats">
        <span>{t("replies", { count: topic.repliesCount })}</span>
        <span>{t("views", { count: topic.viewsCount })}</span>
      </div>
      <div className="gcs-topicRow__last">
        {topic.last.user && (
          <GcsUserLink userId={topic.last.user.id} name={topic.last.user.name} groupKey={topic.last.user.groupKey} href={memberHref(topic.last.user.id)} />
        )}
        <GcsRelTime at={topic.last.at} />
      </div>
    </div>
  );
}
