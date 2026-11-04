import "server-only";
import { escapeHtml, safeHtml, type GcsActor } from "@gcs/core";
import type { GcsForumRow, GcsMemberCard, GcsPostAuthor, GcsTopicRow } from "@gcs/modules";
import { templateIconSvg } from "@gcs/modules";
import { getTranslations } from "next-intl/server";
import { services } from "./services";
import { forumRowVars, hoverCardVars, memberCardVars, postbitVars, recordCardVars, topicRowVars, widgetCardVars } from "./template-data";

/**
 * Datele reale pe care se previzualizează un șablon în ACP (primul forum vizibil, un topic, o postare recentă,
 * un membru, propriul hover card…), plus contextul de markup din jurul lui (aceleași clase ca pe site, ca stilurile
 * temei să se aplice) și conținutul de exemplu al sloturilor. Fără date (site gol), exemple fixe.
 */
export type GcsTemplateSample = { data: Record<string, unknown>; slots: Record<string, string>; before: string; after: string };

const NOW = () => new Date().toISOString();
const sampleUser = (actorName: string) => ({ id: "preview", name: actorName, image: null, groupKey: "member", nameKey: "member", frameKey: null });

/** Conținutul unui slot în previzualizare: o casetă punctată cu numele lui (partea React nu există aici). */
function slotBox(name: string, label: string, body = ""): string {
  return `<div class="gcs-tplSlot" data-slot="${escapeHtml(name)}"><span class="gcs-tplSlot__label">${templateIconSvg("fa-solid fa-puzzle-piece")}${escapeHtml(label)}</span>${body}</div>`;
}

async function firstForum(actor: GcsActor): Promise<{ forum: GcsForumRow; accent: string | null } | null> {
  const index = await services().forumQueries.index(actor);
  for (const c of index) if (c.forums[0]) return { forum: c.forums[0], accent: c.color };
  return null;
}

async function firstTopic(actor: GcsActor): Promise<GcsTopicRow | null> {
  const { forumQueries } = services();
  const index = await forumQueries.index(actor);
  for (const c of index) {
    for (const f of c.forums) {
      if (f.type === "LINK" || f.topicsCount === 0) continue;
      const page = await forumQueries.forum(actor, f.id, { page: 1 }).catch(() => null);
      if (page?.topics[0]) return page.topics[0];
    }
  }
  return null;
}

async function recentAuthor(actor: GcsActor): Promise<{ author: GcsPostAuthor; post: { id: number; number: number } } | null> {
  const { db, forumQueries } = services();
  const rows = await db.post.findMany({
    where: { visibility: "VISIBLE", authorId: { not: null }, topic: { visibility: "VISIBLE" } },
    orderBy: { id: "desc" },
    take: 5,
    select: { topicId: true },
  });
  for (const r of rows) {
    const page = await forumQueries.topic(actor, r.topicId, { page: 1 }).catch(() => null);
    const post = page?.posts.find((p) => p.author);
    if (post?.author) return { author: post.author, post: { id: post.id, number: post.number } };
  }
  return null;
}

export async function templateSample(key: string, actor: GcsActor): Promise<GcsTemplateSample> {
  const t = await getTranslations("acp.templatesEditor.sample");
  const { forumQueries, postbit, memberList, profileQueries, db } = services();
  const me = actor.userId ? await db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }) : null;
  const name = me?.name ?? "Admin";
  const none = { data: {}, slots: {}, before: "", after: "" };

  switch (key) {
    case "forum.row": {
      const found = await firstForum(actor);
      const forum: GcsForumRow = found?.forum ?? {
        id: 1,
        type: "FORUM",
        name: t("forumName"),
        slug: "general",
        description: t("forumDescription"),
        icon: "fa-solid fa-comments",
        color: null,
        linkUrl: null,
        topicsCount: 12,
        postsCount: 87,
        subforums: [],
        subforumColumns: 2,
        last: { postId: 1, topicId: 1, topicTitle: t("topicTitle"), topicSlug: "salut", at: NOW(), user: sampleUser(name) },
        unread: true,
        pageTopics: false,
      };
      return {
        data: forumRowVars(forum, found?.accent ?? null),
        slots: {},
        before: '<div class="gcs-forumIndex"><section class="gcs-card gcs-category">',
        after: "</section></div>",
      };
    }
    case "forum.topic_row": {
      const topic: GcsTopicRow = (await firstTopic(actor)) ?? {
        id: 1,
        title: t("topicTitle"),
        slug: "salut",
        visibility: "VISIBLE",
        pinned: true,
        locked: false,
        featured: false,
        solved: false,
        prefix: null,
        tags: [],
        author: sampleUser(name),
        createdAt: NOW(),
        repliesCount: 3,
        viewsCount: 42,
        last: { at: NOW(), user: sampleUser(name) },
        unread: false,
      };
      return {
        data: topicRowVars(topic),
        slots: { select: slotBox("select", t("slot", { name: "select" }), '<input type="checkbox" class="gcs-modCheck" disabled>') },
        before: '<section class="gcs-card gcs-topicList">',
        after: "</section>",
      };
    }
    case "postbit.author":
    case "postbit.fields": {
      const found = await recentAuthor(actor);
      if (!found) return { ...none, data: { author: { name, handle: name.toLowerCase(), url: "#", nameKey: "member", hasData: false, fields: [], badges: { recent: [] }, group: { label: "" } } } };
      const data = (await postbit.forAuthors(actor, [found.author.id])).get(found.author.id) ?? null;
      return {
        data: postbitVars(found.author, data, found.post),
        slots: {},
        before: `<article class="gcs-card gcs-post" data-post-number="${found.post.number}"><div class="gcs-post__author gcs-postbit">`,
        after: `</div><div class="gcs-post__content"><div class="gcs-postBody"><p>${escapeHtml(t("postBody"))}</p></div></div></article>`,
      };
    }
    case "members.card": {
      const list = await memberList.list(actor, { page: 1 }).catch(() => null);
      const member: GcsMemberCard | undefined = list?.members[0];
      if (!member) return none;
      return { data: memberCardVars(member), slots: {}, before: '<div class="gcs-memberGrid" style="max-width:260px">', after: "</div>" };
    }
    case "members.hover_card": {
      const card = actor.userId ? await profileQueries.card(actor, actor.userId) : null;
      if (!card) return none;
      return {
        data: hoverCardVars({ ...card, viewer: { ...card.viewer, canFollow: true, canMessage: true } }),
        slots: { actions: slotBox("actions", t("slot", { name: "actions" })) },
        before: '<div class="gcs-tplPreview__hover">',
        after: "</div>",
      };
    }
    case "layout.footer":
      return {
        data: { year: new Date().getFullYear() },
        slots: {
          columns: slotBox("columns", t("slot", { name: "columns" })),
          social: slotBox("social", t("slot", { name: "social" })),
          links: slotBox("links", t("slot", { name: "links" })),
          language_menu: slotBox("language_menu", t("slot", { name: "language_menu" })),
          language: slotBox("language", t("slot", { name: "language" })),
          scheme: slotBox("scheme", t("slot", { name: "scheme" })),
          powered: '<p class="gcs-siteFooter__powered">Powered by <a href="https://gamingcommunitysuite.com">GamingCommunitySuite</a></p>',
        },
        before: "",
        after: "",
      };
    case "widgets.card": {
      const stats = await forumQueries.stats().catch(() => null);
      const body = `<ul class="gcs-widgetList"><li>${escapeHtml(t("stats", { topics: stats?.topics ?? 0, posts: stats?.posts ?? 0, members: stats?.members ?? 0 }))}</li></ul>`;
      return {
        data: widgetCardVars({ id: "preview", type: "forums.stats", title: t("widgetTitle"), icon: "fa-solid fa-chart-simple", hasExtra: false }),
        slots: { content: slotBox("content", t("slot", { name: "content" }), body), extra: slotBox("extra", t("slot", { name: "extra" })) },
        before: '<aside class="gcs-forumSidebar" style="max-width:340px">',
        after: "</aside>",
      };
    }
    case "pages.record_card": {
      // O înregistrare reală, dacă există; altfel una de exemplu.
      const { pagesAccess, pagesQueries } = services();
      const db = (await pagesAccess.visibleDatabases(actor)).find((d) => d.recordsCount > 0);
      const real = db ? (await pagesQueries.latest(actor, db.id, { limit: 1, sort: "newest" }))?.records[0] : undefined;
      const record = real ?? {
        id: 1,
        title: t("recordTitle"),
        slug: "ghid",
        href: "/pages",
        excerpt: t("recordExcerpt"),
        image: null,
        author: sampleUser(name),
        category: null,
        status: "PUBLISHED" as const,
        featured: true,
        pinned: false,
        isNew: true,
        publishedAt: NOW(),
        updatedAt: NOW(),
        views: 120,
        comments: 4,
        rating: { avg: 4.5, count: 8 },
        fields: [],
      };
      return {
        data: recordCardVars(record, db ?? { name: t("recordDatabase"), key: "ghiduri", icon: "fa-solid fa-book-open" }, true, { yes: "✓", no: "✗" }),
        slots: {},
        before: '<div class="gcs-pgGrid" style="max-width:340px">',
        after: "</div>",
      };
    }
    case "email.layout": {
      const site = await services().settings.get<string>("site.name");
      const content = `<p>${escapeHtml(t("emailHello", { name }))}</p><ul><li><a href="/">${escapeHtml(t("emailItem"))}</a></li></ul><p style="color:#777">${escapeHtml(t("emailFooter"))}</p>`;
      return {
        data: { subject: t("emailSubject", { site }), content: safeHtml(content), year: new Date().getFullYear() },
        slots: {},
        before: '<div class="gcs-tplPreview__email">',
        after: "</div>",
      };
    }
    default:
      return none;
  }
}
