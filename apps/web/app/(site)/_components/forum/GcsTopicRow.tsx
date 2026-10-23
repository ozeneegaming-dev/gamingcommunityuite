import type { GcsTopicRow as Row } from "@gcs/modules";
import { GcsAvatar, GcsBadge, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { memberHref, tagHref, tint, topicHref, unreadHref } from "@/lib/forum-urls";
import { topicRowVars } from "@/lib/template-data";
import { siteTemplate } from "@/lib/templates";
import { GcsDeletedMember } from "../GcsDeletedMember";
import { GcsStarsStatic } from "../topic/GcsTopicRating";
import { GcsRelTime } from "./GcsRelTime";

/**
 * Un topic în listă: prefix, titlu, stări, tag-uri, autor, contoare și ultimul mesaj. Cu șablonul `forum.topic_row`
 * modificat de temă, markup-ul vine din el (bifa moderatorului intră în slotul `select`).
 */
export async function GcsTopicRow({ topic, select, popular = false }: { topic: Row; select?: React.ReactNode; popular?: boolean }) {
  const custom = await siteTemplate("forum.topic_row", topicRowVars(topic), { select });
  if (custom) return custom;
  const t = await getTranslations("forum");
  return (
    <div className={`gcs-topicRow${topic.archived ? " gcs-topicRow--archived" : ""}`} data-testid="gcs-topic-row" data-topic-id={topic.id}>
      {select}
      <span className="gcs-topicRow__avatar">
        {topic.author && <GcsAvatar name={topic.author.name} size="s" userId={topic.author.id} {...(topic.author.image ? { src: topic.author.image } : {})} {...(topic.author.frameKey ? { frame: topic.author.frameKey } : {})} />}
      </span>
      <div className="gcs-topicRow__main">
        <div className="gcs-topicRow__badges">
          {topic.pinned && <GcsBadge tone="accent" icon={<GcsIcon name="fa-solid fa-thumbtack" />}>{t("pinned")}</GcsBadge>}
          {topic.featured && <GcsBadge tone="warn" icon={<GcsIcon name="fa-solid fa-star" />}>{t("featured")}</GcsBadge>}
          {topic.solved && <GcsBadge tone="ok" icon={<GcsIcon name="fa-solid fa-circle-check" />}>{t("solved")}</GcsBadge>}
          {topic.locked && <GcsBadge tone="neutral" icon={<GcsIcon name="fa-solid fa-lock" />}>{t("locked")}</GcsBadge>}
          {topic.archived && <GcsBadge tone="neutral" icon={<GcsIcon name="fa-solid fa-box-archive" />}>{t("archived")}</GcsBadge>}
          {popular && (
            <GcsBadge tone="accent" icon={<GcsIcon name="fa-solid fa-fire" />} data-testid="gcs-topic-popular">
              {t("popularNow")}
            </GcsBadge>
          )}
          {topic.visibility === "PENDING" && <GcsBadge tone="warn" icon={<GcsIcon name="fa-solid fa-hourglass-half" />}>{t("pending")}</GcsBadge>}
          {topic.visibility === "HIDDEN" && <GcsBadge tone="neutral" icon={<GcsIcon name="fa-solid fa-eye-slash" />}>{t("hidden")}</GcsBadge>}
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
        {topic.snippet && (
          // Fragmentul primei postări (setarea temei; atributul `data-gcs-snippet` îl ascunde live în previzualizare).
          <p className="gcs-topicRow__snippet" data-testid="gcs-topic-snippet">
            {topic.snippet}
          </p>
        )}
        <span className="gcs-topicRow__meta">
          {t("byWord")}{" "}
          {topic.author ? <GcsMemberName userId={topic.author.id} name={topic.author.name} nameKey={topic.author.nameKey} href={memberHref(topic.author)} /> : <GcsDeletedMember />}
          {" · "}
          <GcsRelTime at={topic.createdAt} />
          {topic.tags.map((tag) => (
            <Link key={tag.slug} href={tagHref(tag.slug)} className="gcs-tag">
              #{tag.name}
            </Link>
          ))}
        </span>
      </div>
      <div className="gcs-topicRow__stats">
        {topic.rating && topic.rating.count > 0 && (
          // Forum v2: nota (stelele mici, media și numărul voturilor), pe forumurile cu nota pornită.
          <span className="gcs-topicRow__rating" data-testid="gcs-topic-rating-row">
            <GcsStarsStatic avg={topic.rating.avg} size="sm" label={t("ratingLabel", { avg: topic.rating.avg.toFixed(1), count: topic.rating.count })} />
            <strong>{topic.rating.avg.toFixed(1)}</strong>
            <span className="gcs-muted">({topic.rating.count})</span>
          </span>
        )}
        <span>
          <GcsIcon name="fa-regular fa-comment" className="gcs-metaIcon" />
          {t("replies", { count: topic.repliesCount })}
        </span>
        <span>
          <GcsIcon name="fa-regular fa-eye" className="gcs-metaIcon" />
          {t("views", { count: topic.viewsCount })}
        </span>
      </div>
      <div className="gcs-topicRow__last">
        {topic.last.user && (
          <GcsMemberName userId={topic.last.user.id} name={topic.last.user.name} nameKey={topic.last.user.nameKey} href={memberHref(topic.last.user)} />
        )}
        <GcsRelTime at={topic.last.at} />
      </div>
    </div>
  );
}
