import {
  GcsAcpRoleService,
  GcsContentRenderer,
  GcsPermissionService,
  GcsSearchIndex,
  type GcsActor,
  type GcsDemoContext,
  type GcsSeedContext,
} from "@gcs/core";
import type { ForumType, Prisma } from "@gcs/db";
import { GcsForumCounters } from "./counters";
import { GcsForumService } from "./forums";
import { RENDER_LABELS } from "./labels";
import { slugify } from "./slug";

/** Reacțiile implicite (specul etapei 2, §2). Greutatea se adună la reputația autorului. */
export const DEFAULT_REACTIONS = [
  { key: "like", label: "Like", symbol: "▲", color: "#FF6B74", weight: 1 },
  { key: "gg", label: "GG", symbol: "GG", color: "#F4B740", weight: 1 },
  { key: "thanks", label: "Mulțumesc", symbol: "♥", color: "#FF7AC6", weight: 1 },
  { key: "haha", label: "Haha", symbol: "😂", color: "#F4B740", weight: 0 },
  { key: "disagree", label: "Dezacord", symbol: "👎", color: "#A1A7B4", weight: -1 },
] as const;

/** Datele implicite ale forumului. Idempotent: nu suprascrie modificările din ACP. */
export async function seedForums({ tx }: GcsSeedContext): Promise<void> {
  await tx.reaction.createMany({
    data: DEFAULT_REACTIONS.map((r, position) => ({ ...r, position })),
    skipDuplicates: true,
  });
}

type DemoForum = { name: string; type?: ForumType; description?: string; icon?: string; children?: DemoForum[] };
type DemoCategory = { name: string; color: string; forums: DemoForum[] };

/** Structura din macheta Main (pagina principală). */
const DEMO: DemoCategory[] = [
  {
    name: "RED-LINE",
    color: "#D62839",
    forums: [
      { name: "Anunțuri", icon: "megaphone", description: "Noutăți oficiale despre comunitate și servere." },
      { name: "Regulament", icon: "shield", description: "Regulile forumului și ale serverelor." },
      {
        name: "Cereri & reclamații",
        icon: "chat",
        description: "Cereri unban, reclamații jucători sau admini.",
        children: [{ name: "Cereri unban" }, { name: "Reclamații" }, { name: "Cereri admin" }],
      },
    ],
  },
  {
    name: "Servere de joc",
    color: "#F4B740",
    forums: [
      {
        name: "Counter-Strike 2",
        icon: "gamepad",
        description: "Discuții, configuri, highlight-uri.",
        children: [{ name: "Configuri" }, { name: "Highlights" }, { name: "Turnee" }],
      },
      {
        name: "FiveM RolePlay",
        icon: "gamepad",
        description: "Facțiuni, joburi, povești RP.",
        children: [{ name: "Facțiuni" }, { name: "Joburi" }],
      },
      { name: "Minecraft", icon: "gamepad", description: "Survival, construcții, evenimente." },
      { name: "Ajutor tehnic", type: "QA", icon: "help", description: "Întrebări cu răspuns: marchează cel mai bun răspuns." },
    ],
  },
  {
    name: "Comunitate",
    color: "#5EA2FF",
    forums: [
      { name: "Recrutări clan", icon: "users", description: "Caută-ți echipa sau recrutează jucători." },
      { name: "Off-topic", icon: "chat", description: "Orice altceva: muzică, filme, hardware." },
    ],
  },
];

const EMPTY: DemoCategory[] = [{ name: "General", color: "#D62839", forums: [{ name: "Discuții", icon: "chat" }] }];

const DEMO_PREFIXES = [
  { name: "Anunț", color: "#D62839" },
  { name: "Ajutor", color: "#5EA2FF" },
  { name: "Rezolvat", color: "#3DDC97" },
];

/**
 * Conținutul de pornire ales în wizard (specul etapei 2, Task 20): structura din macheta Main, prefixele și un topic
 * de bun venit al Root Admin-ului; sau, pentru „fără date”, doar „General → Discuții”. Nu face nimic dacă există forumuri.
 */
export async function seedForumDemo(ctx: GcsDemoContext): Promise<void> {
  const { db, cache, bus, registry } = ctx;
  if ((await db.forum.count()) > 0) return;

  const admin = await db.user.findUnique({ where: { email: ctx.adminEmail.toLowerCase() }, include: { groups: true } });
  const rootGroup = await db.group.findUniqueOrThrow({ where: { key: "root_admin" } });
  const actor: GcsActor = {
    userId: admin?.id ?? null,
    groupIds: admin ? [admin.primaryGroupId, ...admin.groups.map((g) => g.groupId)] : [rootGroup.id],
    primaryGroupId: admin?.primaryGroupId ?? rootGroup.id,
    isBanned: false,
    ip: "install",
  };
  const permissions = new GcsPermissionService({ db, cache, bus, registry });
  const forums = new GcsForumService({ db, bus, permissions, acp: new GcsAcpRoleService({ db, registry }), registry });

  const created = new Map<string, number>();
  const createForum = async (f: DemoForum, parentId: number) => {
    const row = await forums.create(
      { parentId, type: f.type ?? "FORUM", name: f.name, ...(f.description ? { description: f.description } : {}), ...(f.icon ? { icon: f.icon } : {}) },
      actor,
    );
    created.set(f.name, row.id);
    for (const child of f.children ?? []) await createForum(child, row.id);
  };
  for (const cat of ctx.variant === "demo" ? DEMO : EMPTY) {
    const category = await forums.create({ parentId: null, type: "CATEGORY", name: cat.name, color: cat.color }, actor);
    for (const f of cat.forums) await createForum(f, category.id);
  }
  if (ctx.variant !== "demo") return;

  if ((await db.topicPrefix.count()) === 0) {
    await db.topicPrefix.createMany({ data: DEMO_PREFIXES.map((p, position) => ({ ...p, position })) });
  }
  const announcements = created.get("Anunțuri");
  if (admin && announcements !== undefined) await welcomeTopic(db, admin.id, announcements);
}

/** Topicul de bun venit, scris direct (instalarea nu are Redis pentru flood control), cu contoare și index de căutare. */
async function welcomeTopic(db: GcsDemoContext["db"], authorId: string, forumId: number): Promise<void> {
  const siteName = await db.setting.findUnique({ where: { key: "site.name" } });
  const name = typeof siteName?.value === "string" ? siteName.value : "RED-LINE";
  const title = `Bun venit pe ${name}!`;
  const rendered = new GcsContentRenderer().render(
    {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: `Salut și bine ai venit pe ${name}!` }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Acesta e primul topic al comunității. Citește regulamentul, prezintă-te în Off-topic și spune-ne pe ce servere joci." }],
        },
      ],
    },
    { embeds: [], siteHost: "localhost", labels: RENDER_LABELS.ro! },
  );
  const counters = new GcsForumCounters();
  const search = new GcsSearchIndex();
  await db.$transaction(async (tx) => {
    const topic = await tx.topic.create({ data: { forumId, title, slug: slugify(title), authorId, lastPosterId: authorId, pinned: true } });
    const post = await tx.post.create({
      data: { topicId: topic.id, authorId, contentJson: rendered.json as Prisma.InputJsonValue, contentHtml: rendered.html, ip: "install" },
    });
    await tx.topic.update({ where: { id: topic.id }, data: { firstPostId: post.id, lastPostId: post.id, lastPostAt: post.createdAt } });
    await search.indexTopic(tx, topic.id);
    await search.indexPost(tx, post.id, rendered.text);
    await tx.follow.createMany({ data: [{ userId: authorId, contentType: "topic", contentId: String(topic.id) }], skipDuplicates: true });
    await counters.onTopicCreated(tx, { postId: post.id, topicId: topic.id, forumId, authorId, createdAt: post.createdAt });
  });
}
