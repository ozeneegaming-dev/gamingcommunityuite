import { normalizeTag } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import { slugify } from "../../../forums/slug";
import { GCS_FORUM_ACTIONS, type GcsForumAction, type SrcForum } from "../../types";
import type { GcsStepContext } from "../context";

type Tx = Prisma.TransactionClient;
const WRAPPER = "__wrapper";
const CONTAINER = "forum";

/** Grupurile GCS fără corespondent în sursă preiau drepturile rolului lor (Membru nou și VIP ca Membru). */
const LIKE_MEMBER = ["new_member", "vip_bronze", "vip_silver", "vip_gold", "vip_legend"];
const STAFF = ["root_admin", "admin", "super_moderator", "moderator"];

/** Categoria „Importate”, pentru forumurile care în sursă nu au categorie. */
async function wrapperCategory(s: GcsStepContext, tx: Tx): Promise<number> {
  const existing = await s.map.one("forum", WRAPPER);
  if (existing) return Number(existing);
  const last = await tx.forum.findFirst({ where: { parentId: null }, orderBy: { position: "desc" }, select: { position: true } });
  const row = await tx.forum.create({ data: { type: "CATEGORY", name: "Importate", slug: "importate", position: (last?.position ?? 0) + 1 } });
  await defaultPermissions(s, tx, row.id);
  await s.map.set(tx, "forum", WRAPPER, row.id);
  return row.id;
}

/** Permisiunile implicite ale unui container nou de la rădăcină (ca la crearea din ACP). */
async function defaultPermissions(s: GcsStepContext, tx: Tx, forumId: number): Promise<void> {
  const groups = await tx.group.findMany({ select: { id: true, key: true } });
  const rows: Prisma.ContainerPermissionCreateManyInput[] = [];
  for (const def of s.deps.registry.permissionDefs()) {
    if (def.scope !== "container" || def.containerType !== CONTAINER) continue;
    for (const g of groups) if (def.default[g.key] === true) rows.push({ containerType: CONTAINER, containerId: String(forumId), groupId: g.id, action: def.key });
  }
  await tx.containerPermission.createMany({ data: rows, skipDuplicates: true });
}

/** Părinții înaintea copiilor (ordinea sursei e păstrată între frați). */
function topological(forums: SrcForum[]): SrcForum[] {
  const byParent = new Map<string | null, SrcForum[]>();
  for (const f of forums) byParent.set(f.parentId, [...(byParent.get(f.parentId) ?? []), f]);
  const out: SrcForum[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null) => {
    for (const f of (byParent.get(parent) ?? []).sort((a, b) => a.position - b.position)) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
      visit(f.id);
    }
  };
  visit(null);
  // Forumurile rămase (ciclu sau părinte lipsă) intră la final, sub categoria „Importate”.
  for (const f of forums) if (!seen.has(f.id)) out.push({ ...f, parentId: null, type: f.type === "CATEGORY" ? "FORUM" : f.type });
  return out;
}

/**
 * Pasul 4: categoriile, forumurile, subforumurile și linkurile, cu ordinea și descrierile. Permisiunile sursei se
 * traduc în matricea GCS pe fiecare forum; fără permisiuni proprii în sursă, forumul moștenește părintele.
 */
export async function importForums(s: GcsStepContext): Promise<void> {
  const { db, permissions } = s.deps;
  const source = topological(await s.adapter.forums());
  s.state.total = source.length;
  const [mapped, groupMap, perms, groups] = await Promise.all([
    s.map.all("forum"),
    s.map.all("group"),
    s.adapter.forumPermissions(),
    db.group.findMany({ select: { id: true, key: true } }),
  ]);
  const keyOf = new Map(groups.map((g) => [g.id, g.key]));
  const mappedGroupIds = new Set([...groupMap.values()].map(Number));
  /** Matricea tradusă: forum vechi → grup GCS → acțiuni. */
  const matrix = new Map<string, Map<number, Set<GcsForumAction>>>();
  for (const p of perms) {
    const groupId = Number(groupMap.get(p.groupId));
    if (!Number.isInteger(groupId)) continue;
    const forGroup = matrix.get(p.forumId) ?? new Map<number, Set<GcsForumAction>>();
    forGroup.set(groupId, new Set([...(forGroup.get(groupId) ?? []), ...p.actions]));
    matrix.set(p.forumId, forGroup);
  }
  const memberId = groups.find((g) => g.key === "member")?.id;

  for (const f of source) {
    s.state.done++;
    if (mapped.has(f.id)) {
      s.state.skipped++;
      continue;
    }
    try {
      await db.$transaction(async (tx) => {
        let parentId: number | null = f.parentId ? Number((await s.map.one("forum", f.parentId)) ?? NaN) : null;
        if (parentId !== null && !Number.isInteger(parentId)) parentId = null;
        let type = f.type;
        let linkUrl = f.linkUrl;
        if (type === "LINK" && !(linkUrl && URL.canParse(linkUrl) && ["http:", "https:"].includes(new URL(linkUrl).protocol))) {
          await s.log("warn", "link cu adresă invalidă, importat ca forum", f.id);
          type = "FORUM";
          linkUrl = null;
        }
        // În GCS, categoriile stau la rădăcină, iar forumurile și linkurile au un părinte.
        if (type === "CATEGORY" && parentId !== null) type = "FORUM";
        if (type !== "CATEGORY" && parentId === null) parentId = await wrapperCategory(s, tx);
        const row = await tx.forum.create({
          data: { parentId, type, name: f.name, slug: slugify(f.name), description: f.description, position: f.position, linkUrl: type === "LINK" ? linkUrl : null },
        });
        const own = matrix.get(f.id);
        if (own && own.size > 0) {
          const rows: Prisma.ContainerPermissionCreateManyInput[] = [];
          const rightsOf = (groupId: number): Set<GcsForumAction> => {
            if (own.has(groupId)) return own.get(groupId)!;
            const key = keyOf.get(groupId) ?? "";
            if (key === "root_admin") return new Set(GCS_FORUM_ACTIONS);
            if (mappedGroupIds.has(groupId)) return new Set();
            if (STAFF.includes(key)) return new Set(GCS_FORUM_ACTIONS);
            if ((LIKE_MEMBER.includes(key) || key.startsWith("custom_")) && memberId !== undefined) return own.get(memberId) ?? new Set();
            return new Set();
          };
          for (const g of groups) {
            for (const action of rightsOf(g.id)) rows.push({ containerType: CONTAINER, containerId: String(row.id), groupId: g.id, action: `forums.${action}` });
          }
          await tx.containerPermission.createMany({ data: rows, skipDuplicates: true });
          await tx.containerInherit.create({ data: { containerType: CONTAINER, containerId: String(row.id), parentId: parentId === null ? null : String(parentId), inherits: false } });
        } else if (parentId !== null) {
          await tx.containerInherit.create({ data: { containerType: CONTAINER, containerId: String(row.id), parentId: String(parentId), inherits: true } });
        } else {
          await defaultPermissions(s, tx, row.id);
        }
        await s.map.set(tx, "forum", f.id, row.id);
      });
      s.state.imported++;
    } catch (error) {
      s.state.errors++;
      await s.log("error", `forum: ${(error as Error).message.slice(0, 200)}`, f.id);
    }
  }
  await permissions.bumpVersion();
}

/** Pasul 5: prefixele (tag-urile se creează odată cu topicurile). */
export async function importPrefixes(s: GcsStepContext): Promise<void> {
  const { db } = s.deps;
  const source = await s.adapter.prefixes();
  s.state.total = source.length;
  const mapped = await s.map.all("prefix");
  const last = await db.topicPrefix.aggregate({ _max: { position: true } });
  let position = (last._max.position ?? 0) + 1;
  for (const p of source) {
    s.state.done++;
    if (mapped.has(p.id)) {
      s.state.skipped++;
      continue;
    }
    await db.$transaction(async (tx) => {
      // Un prefix cu același nume există deja în GCS: se refolosește.
      const same = await tx.topicPrefix.findFirst({ where: { name: { equals: p.name, mode: "insensitive" } }, select: { id: true } });
      const id = same?.id ?? (await tx.topicPrefix.create({ data: { name: p.name, color: p.color ?? "#5EA2FF", position: position++ } })).id;
      await s.map.set(tx, "prefix", p.id, id);
    });
    s.state.imported++;
  }
}

/**
 * Pasul 6: topicurile (fixat, închis, ascuns, vizualizări, prefix, tag-uri, sondaj cu voturi). Topicurile „mutate”
 * (doar un link spre noua locație) se sar. Postările vin la pasul 8; contoarele se recalculează la final.
 */
export async function importTopics(s: GcsStepContext): Promise<void> {
  const [forums, prefixes] = await Promise.all([s.map.all("forum"), s.map.all("prefix")]);
  await s.batches(
    (c, l) => s.adapter.topics(c, l),
    300,
    async (rows) => {
      const existing = await s.map.get("topic", rows.map((r) => r.id));
      const members = await s.map.get("member", rows.flatMap((r) => [r.authorId ?? "", ...(r.poll?.votes.map((v) => v.memberId) ?? [])]));
      await s.rows(
        rows,
        (r) => r.id,
        async (tx, t) => {
          if (existing.has(t.id) || t.isRedirect) return "skipped";
          const forumId = Number(forums.get(t.forumId));
          if (!Number.isInteger(forumId)) {
            await s.log("warn", "forumul topicului nu a fost importat", t.id);
            return "skipped";
          }
          const title = t.title.replace(/\s+/g, " ").trim().slice(0, 150) || "Fără titlu";
          const authorId = t.authorId ? (members.get(t.authorId) ?? null) : null;
          const prefixId = t.prefixId ? Number(prefixes.get(t.prefixId)) : NaN;
          const topic = await tx.topic.create({
            data: {
              forumId,
              title,
              slug: slugify(title),
              authorId,
              prefixId: Number.isInteger(prefixId) ? prefixId : null,
              visibility: t.visibility,
              pinned: t.pinned,
              locked: t.locked,
              viewsCount: t.views,
              createdAt: t.createdAt,
              lastPostAt: t.createdAt,
              lastPosterId: authorId,
            },
          });
          const slugs = [...new Set(t.tags.map(normalizeTag).filter((x): x is string => x !== null))].slice(0, 20);
          if (slugs.length > 0) {
            await tx.tag.createMany({ data: slugs.map((slug) => ({ name: slug, slug })), skipDuplicates: true });
            const tags = await tx.tag.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
            await tx.topicTag.createMany({ data: tags.map((tag) => ({ topicId: topic.id, tagId: tag.id })), skipDuplicates: true });
          }
          if (t.poll && t.poll.options.length >= 2) {
            const poll = await tx.poll.create({ data: { topicId: topic.id, question: (t.poll.question || title).slice(0, 200), multiple: t.poll.multiple, closesAt: t.poll.closesAt } });
            const optionIds = new Map<string, number>();
            for (const [position, o] of t.poll.options.slice(0, 20).entries()) {
              const votes = t.poll.votes.filter((v) => v.optionId === o.id && members.has(v.memberId)).length;
              const row = await tx.pollOption.create({ data: { pollId: poll.id, text: o.text.slice(0, 200), position, votesCount: votes } });
              optionIds.set(o.id, row.id);
            }
            const votes = t.poll.votes.flatMap((v) => {
              const optionId = optionIds.get(v.optionId);
              const userId = members.get(v.memberId);
              return optionId && userId ? [{ pollId: poll.id, optionId, userId }] : [];
            });
            if (votes.length > 0) await tx.pollVote.createMany({ data: votes, skipDuplicates: true });
          }
          await tx.$executeRaw`UPDATE topics SET "searchVector" = setweight(to_tsvector('gcs_ro', title), 'A') WHERE id = ${topic.id}`;
          await s.map.set(tx, "topic", t.id, topic.id);
          return "imported";
        },
      );
    },
  );
}
