import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumQuery, pageParam } from "@/lib/forum-page";
import { tagHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsPagination } from "../../_components/forum/GcsPagination";
import { GcsTopicRow } from "../../_components/forum/GcsTopicRow";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: (await getTranslations("tags"))("title", { tag: slug }), alternates: { canonical: tagHref(slug) } };
}

/** Topicurile cu un tag (doar cele vizibile, din forumurile citibile de actor). */
export default async function TagPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const page = pageParam((await searchParams).page);
  const t = await getTranslations("tags");
  const data = await forumQuery(async () => services().forumQueries.topicsByTag(await currentActor(), slug, { page }));
  if (data === "forbidden") return null;

  return (
    <>
      <header className="gcs-pageHeader">
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-tags" className="gcs-hIcon" />
          {t("title", { tag: data.tag.name })}
        </h1>
      </header>
      <section className="gcs-card gcs-topicList">
        {data.topics.length === 0 ? (
          <p className="gcs-topicList__empty">
            <GcsIcon name="fa-solid fa-tag" className="gcs-emptyIcon" />
            {t("empty")}
          </p>
        ) : (
          data.topics.map((topic) => <GcsTopicRow key={topic.id} topic={topic} />)
        )}
      </section>
      <GcsPagination pagination={data.pagination} href={(p) => (p > 1 ? `${tagHref(slug)}?page=${p}` : tagHref(slug))} />
    </>
  );
}
