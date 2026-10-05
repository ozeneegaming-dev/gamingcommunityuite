import { parseRef } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumQuery } from "@/lib/forum-page";
import { forumHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsBreadcrumb } from "../../../_components/forum/GcsBreadcrumb";
import { GcsNewTopicForm } from "../../../_components/forum/GcsNewTopicForm";

type Props = { params: Promise<{ ref: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("forum"))("newTopic"), robots: { index: false } };
}

/** Pagina „Topic nou” a unui forum. Fără drept de a deschide topicuri: vizitatorii merg la login, ceilalți primesc 404. */
export default async function NewTopicPage({ params }: Props) {
  const ref = parseRef((await params).ref);
  if (!ref) notFound();
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const { forumQueries, prefixes, permissions } = services();
  const t = await getTranslations();

  const data = await forumQuery(() => forumQueries.forum(actor, ref.id, { page: 1 }));
  if (data === "forbidden" || !data.canCreate) notFound();
  const [allowed, tagsMax, canPoll] = await Promise.all([
    prefixes.allowedFor(data.forum.id),
    permissions.groupValue<number | boolean>(actor, "forums.tags_max"),
    permissions.groupValue<boolean>(actor, "forums.poll_create"),
  ]);

  return (
    <>
      <GcsBreadcrumb crumbs={data.breadcrumb} />
      <h1 className="gcs-display gcs-pageHeader__title">{t("newTopic.title", { forum: data.forum.name })}</h1>
      {data.forum.type === "FORUM" || data.forum.type === "QA" ? (
        <GcsNewTopicForm
          forum={{ id: data.forum.id, href: forumHref(data.forum) }}
          prefixes={allowed.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
          tagsMax={tagsMax === -1 ? 20 : typeof tagsMax === "number" ? tagsMax : 0}
          canPoll={canPoll === true}
        />
      ) : (
        <GcsCard style={{ padding: 24 }}>{t("forum.empty")}</GcsCard>
      )}
    </>
  );
}
