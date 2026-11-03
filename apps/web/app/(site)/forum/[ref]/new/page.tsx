import { allowedBlocks, loadTagsConfig, parseRef } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumQuery } from "@/lib/forum-page";
import { forumHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { forumLocked } from "@/lib/forum-access";
import { GcsForumRulesBox } from "../../../_components/forum/GcsForumRulesBox";
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
  // Forum v2: forumul cu parolă trebuie deblocat întâi (pe pagina forumului).
  if (data.options.hasPassword && (await forumLocked(actor, data.forum.id))) redirect(forumHref(data.forum));
  const [allowed, tagsMax, canPoll, blocks, tagsConfig] = await Promise.all([
    prefixes.allowedFor(data.forum.id),
    permissions.groupValue<number | boolean>(actor, "forums.tags_max"),
    permissions.groupValue<boolean>(actor, "forums.poll_create"),
    allowedBlocks(services(), actor),
    loadTagsConfig(services().settings),
  ]);

  return (
    <>
      <header className="gcs-pageHeader">
        <GcsBreadcrumb crumbs={data.breadcrumb} />
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-pen-to-square" className="gcs-hIcon" />
          {t("newTopic.title", { forum: data.forum.name })}
        </h1>
      </header>
      {data.rulesHtml && data.options.rulesMode !== "off" && <GcsForumRulesBox forumId={data.forum.id} html={data.rulesHtml} mode={data.options.rulesMode} userId={actor.userId} />}
      {data.forum.type === "FORUM" || data.forum.type === "QA" || (data.forum.type === "PAGE" && data.page?.allowTopics) ? (
        <GcsNewTopicForm
          forum={{ id: data.forum.id, href: forumHref(data.forum) }}
          prefixes={allowed.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
          tagsMax={!data.options.tagsEnabled || !tagsConfig.enabled ? 0 : tagsMax === -1 ? 20 : typeof tagsMax === "number" ? tagsMax : 0}
          blocks={blocks}
          canPoll={canPoll === true && data.options.pollsEnabled}
          maxLength={await services().settings.get<number>("forums.post_max_chars")}
        />
      ) : (
        <GcsCard style={{ padding: 24 }}>
          <GcsIcon name="fa-regular fa-comments" className="gcs-emptyIcon" />
          {t("forum.empty")}
        </GcsCard>
      )}
    </>
  );
}
