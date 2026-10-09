import { GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumHref, memberHref, topicHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.following") };
}

const SHOWN = 100;

/**
 * „Ce urmăresc” (meniul contului, specul 2026-10-10-hero-cockpit §3): membrii, topicurile și forumurile urmărite, cele
 * noi primele. Topicurile și forumurile apar doar dacă viewer-ul încă le poate citi.
 */
export default async function FollowingSettingsPage() {
  const actor = await currentActor();
  const [t, format] = await Promise.all([getTranslations("settings.following"), getFormatter()]);
  const { db, permissions, profileQueries } = services();
  const rows = await db.follow.findMany({ where: { userId: actor.userId!, contentType: { in: ["user", "topic", "forum"] } }, orderBy: { createdAt: "desc" }, take: SHOWN * 3 });
  const ids = (type: string) => rows.filter((r) => r.contentType === type).map((r) => r.contentId);
  const topicIds = ids("topic").map(Number).filter(Number.isInteger);
  const forumIds = ids("forum").map(Number).filter(Number.isInteger);
  const [users, topics, forums] = await Promise.all([
    profileQueries.userDisplays(ids("user")),
    db.topic.findMany({ where: { id: { in: topicIds }, visibility: "VISIBLE" }, select: { id: true, title: true, slug: true, forumId: true } }),
    db.forum.findMany({ where: { id: { in: forumIds } }, select: { id: true, name: true, slug: true } }),
  ]);
  const readable = await permissions.filterContainers(
    actor,
    "forums.view",
    [...new Set([...topics.map((x) => x.forumId), ...forums.map((f) => f.id)])].map((id) => ({ type: "forum", id: String(id) })),
  );
  const byId = <T extends { id: number }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
  const topicMap = byId(topics.filter((x) => readable.has(String(x.forumId))));
  const forumMap = byId(forums.filter((f) => readable.has(String(f.id))));

  const members = rows.flatMap((r) => (r.contentType === "user" && users.get(r.contentId) ? [{ at: r.createdAt, user: users.get(r.contentId)! }] : [])).slice(0, SHOWN);
  const followedTopics = rows.flatMap((r) => (r.contentType === "topic" && topicMap.get(Number(r.contentId)) ? [{ at: r.createdAt, topic: topicMap.get(Number(r.contentId))! }] : [])).slice(0, SHOWN);
  const followedForums = rows.flatMap((r) => (r.contentType === "forum" && forumMap.get(Number(r.contentId)) ? [{ at: r.createdAt, forum: forumMap.get(Number(r.contentId))! }] : [])).slice(0, SHOWN);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="gcs-settings-following">
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.following} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("intro")}
      </p>
      {members.length + followedTopics.length + followedForums.length === 0 && <p className="gcs-emptyState">{t("empty")}</p>}
      {members.length > 0 && (
        <section aria-labelledby="gcs-following-members">
          <h3 id="gcs-following-members">{t("members", { count: members.length })}</h3>
          <ul className="gcs-plainList">
            {members.map((m) => (
              <li key={m.user.id}>
                <GcsUserLink userId={m.user.id} name={m.user.name} nameKey={m.user.nameKey} href={memberHref(m.user)} /> <span className="gcs-muted">· {date(m.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {followedTopics.length > 0 && (
        <section aria-labelledby="gcs-following-topics">
          <h3 id="gcs-following-topics">{t("topics", { count: followedTopics.length })}</h3>
          <ul className="gcs-plainList">
            {followedTopics.map((x) => (
              <li key={x.topic.id}>
                <Link href={topicHref(x.topic)}>{x.topic.title}</Link> <span className="gcs-muted">· {date(x.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {followedForums.length > 0 && (
        <section aria-labelledby="gcs-following-forums">
          <h3 id="gcs-following-forums">{t("forums", { count: followedForums.length })}</h3>
          <ul className="gcs-plainList">
            {followedForums.map((x) => (
              <li key={x.forum.id}>
                <Link href={forumHref(x.forum)}>{x.forum.name}</Link> <span className="gcs-muted">· {date(x.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
