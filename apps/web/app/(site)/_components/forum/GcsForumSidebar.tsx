import type { GcsUserRef } from "@gcs/modules";
import { GcsUserLink } from "@gcs/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { memberHref, topicHref } from "@/lib/forum-urls";
import { GcsRelTime } from "./GcsRelTime";

type Props = {
  stats: { topics: number; posts: number; members: number; newestMember: GcsUserRef | null };
  recent: { id: number; title: string; slug: string; lastPostAt: string; user: GcsUserRef | null }[];
  /** Shoutbox-ul (doar pentru cine are acces la canal) și „Cine e online” (etapa 4). */
  shoutbox?: ReactNode;
  online?: ReactNode;
};

/** Coloana din dreapta a paginii principale: shoutbox-ul, statisticile, „Cine e online” și topicurile recente. */
export async function GcsForumSidebar({ stats, recent, shoutbox, online }: Props) {
  const t = await getTranslations("forum.sidebar");
  const format = await getFormatter();
  const n = (v: number) => format.number(v);
  return (
    <aside className="gcs-forumSidebar">
      {shoutbox}
      <section className="gcs-card gcs-sideCard" aria-labelledby="gcs-side-stats">
        <h2 id="gcs-side-stats" className="gcs-display gcs-sideCard__title">
          {t("stats")}
        </h2>
        <dl className="gcs-statGrid">
          <div>
            <dt>{t("topics")}</dt>
            <dd>{n(stats.topics)}</dd>
          </div>
          <div>
            <dt>{t("posts")}</dt>
            <dd>{n(stats.posts)}</dd>
          </div>
          <div>
            <dt>{t("members")}</dt>
            <dd>{n(stats.members)}</dd>
          </div>
        </dl>
        {stats.newestMember && (
          <p className="gcs-sideCard__line">
            {t("newest")}:{" "}
            <GcsUserLink
              userId={stats.newestMember.id}
              name={stats.newestMember.name}
              nameKey={stats.newestMember.nameKey}
              href={memberHref(stats.newestMember)}
            />
          </p>
        )}
      </section>
      {online}
      <section className="gcs-card gcs-sideCard" aria-labelledby="gcs-side-recent">
        <h2 id="gcs-side-recent" className="gcs-display gcs-sideCard__title">
          {t("recent")}
        </h2>
        {recent.length === 0 ? (
          <p className="gcs-sideCard__line">{t("noRecent")}</p>
        ) : (
          <ul className="gcs-recentList">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={topicHref(r)}>{r.title}</Link>
                <span>
                  {r.user && (
                    <>
                      <GcsUserLink userId={r.user.id} name={r.user.name} nameKey={r.user.nameKey} href={memberHref(r.user)} />
                      {" · "}
                    </>
                  )}
                  <GcsRelTime at={r.lastPostAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
