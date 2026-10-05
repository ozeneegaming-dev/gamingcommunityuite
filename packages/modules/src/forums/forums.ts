import {
  GcsConflict,
  GcsNotFound,
  GcsValidationError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsEventBus,
  type GcsModuleRegistry,
  type GcsPermissionService,
} from "@gcs/core";
import type { Forum, ForumType, Prisma, PrismaClient } from "@gcs/db";
import { GcsForumCounters } from "./counters";
import { slugify } from "./slug";

/** Secțiunea ACP care dă dreptul de a administra structura forumului. */
export const FORUMS_ACP_SECTION = "community.forums";
const CONTAINER = "forum";
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const ICON = /^[a-z0-9-]{1,40}$/;

export type GcsForumInput = {
  parentId: number | null;
  type: ForumType;
  name: string;
  description?: string;
  icon?: string | null;
  color?: string | null;
  linkUrl?: string | null;
  requireApproval?: boolean;
};
export type GcsForumPatch = Partial<Omit<GcsForumInput, "parentId">>;
export type GcsForumOrderItem = { id: number; parentId: number | null; position: number };

type Tx = Prisma.TransactionClient;
type ForumNode = Pick<Forum, "id" | "parentId" | "type">;

/** Câmpurile editabile, validate. Erorile sunt chei de traducere pe câmp. */
function validateFields(input: GcsForumPatch, type: ForumType): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) errors.name = "required";
    else if (name.length > 100) errors.name = "too_long";
  }
  if (input.description !== undefined && input.description.length > 500) errors.description = "too_long";
  if (input.color && !COLOR.test(input.color)) errors.color = "invalid_color";
  if (input.icon && !ICON.test(input.icon)) errors.icon = "invalid_choice";
  if (type === "LINK") {
    const url = input.linkUrl ?? "";
    if (!URL.canParse(url) || !["http:", "https:"].includes(new URL(url).protocol)) errors.linkUrl = "invalid_url";
  }
  return errors;
}

/** Regula structurii: categoriile stau la rădăcină; forumurile, sub o categorie sau un forum (nu sub un link). */
function parentError(type: ForumType, parent: ForumNode | null | undefined): string | null {
  if (parent === undefined) return "invalid_parent";
  if (type === "CATEGORY") return parent === null ? null : "invalid_parent";
  if (parent === null || parent.type === "LINK") return "invalid_parent";
  return null;
}

/**
 * Structura forumului (specul etapei 2, §5): categorii, forumuri și subforumuri, cu permisiuni moștenite.
 * Toate operațiile cer dreptul ACP `community.forums`.
 */
export class GcsForumService {
  private readonly counters = new GcsForumCounters();

  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      permissions: GcsPermissionService;
      acp: GcsAcpRoleService;
      registry: GcsModuleRegistry;
    },
  ) {}

  async create(input: GcsForumInput, actor: GcsActor): Promise<Forum> {
    const { db, acp } = this.deps;
    await acp.assert(actor, FORUMS_ACP_SECTION, "edit");

    const errors = validateFields(input, input.type);
    const parent = input.parentId === null ? null : ((await db.forum.findUnique({ where: { id: input.parentId } })) ?? undefined);
    const pError = parentError(input.type, parent);
    if (pError) errors.parentId = pError;
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    const forum = await db.$transaction(async (tx) => {
      const last = await tx.forum.findFirst({ where: { parentId: input.parentId }, orderBy: { position: "desc" }, select: { position: true } });
      const name = input.name.trim();
      const row = await tx.forum.create({
        data: {
          parentId: input.parentId,
          type: input.type,
          name,
          slug: slugify(name),
          description: input.description?.trim() ?? "",
          icon: input.icon ?? null,
          color: input.color ?? null,
          linkUrl: input.type === "LINK" ? input.linkUrl! : null,
          requireApproval: input.requireApproval ?? false,
          position: last ? last.position + 1 : 0,
        },
      });
      if (input.parentId !== null) {
        await tx.containerInherit.create({
          data: { containerType: CONTAINER, containerId: String(row.id), parentId: String(input.parentId), inherits: true },
        });
      } else {
        await this.applyDefaultPermissions(tx, row.id);
      }
      await writeAudit(tx, { actorId: actor.userId, action: "forum.create", targetType: "forum", targetId: String(row.id), after: row, ip: actor.ip });
      return row;
    });

    await this.changed([forum.id], true);
    return forum;
  }

  async update(id: number, patch: GcsForumPatch, actor: GcsActor): Promise<Forum> {
    const { db, acp } = this.deps;
    await acp.assert(actor, FORUMS_ACP_SECTION, "edit");
    const before = await db.forum.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();

    const type = patch.type ?? before.type;
    const errors = validateFields({ ...patch, linkUrl: patch.linkUrl ?? before.linkUrl }, type);
    // Tipul se poate schimba între forum, Q&A și link; o categorie rămâne categorie.
    if ((type === "CATEGORY") !== (before.type === "CATEGORY")) errors.type = "invalid_type";
    if (type === "LINK" && before.type !== "LINK" && (await db.forum.count({ where: { parentId: id } })) > 0) errors.type = "invalid_type";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    const data: Prisma.ForumUpdateInput = { type };
    if (patch.name !== undefined) {
      data.name = patch.name.trim();
      data.slug = slugify(patch.name);
    }
    if (patch.description !== undefined) data.description = patch.description.trim();
    if (patch.icon !== undefined) data.icon = patch.icon;
    if (patch.color !== undefined) data.color = patch.color;
    if (patch.requireApproval !== undefined) data.requireApproval = patch.requireApproval;
    data.linkUrl = type === "LINK" ? (patch.linkUrl ?? before.linkUrl) : null;

    const forum = await db.$transaction(async (tx) => {
      const row = await tx.forum.update({ where: { id }, data });
      await writeAudit(tx, { actorId: actor.userId, action: "forum.update", targetType: "forum", targetId: String(id), before, after: row, ip: actor.ip });
      return row;
    });
    await this.changed([id], false);
    return forum;
  }

  /** Ordinea și părinții (drag & drop din ACP). Refuză ciclurile și încălcările structurii. */
  async reorder(items: GcsForumOrderItem[], actor: GcsActor): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, FORUMS_ACP_SECTION, "edit");

    const all = await db.forum.findMany({ select: { id: true, parentId: true, type: true } });
    const nodes = new Map(all.map((f) => [f.id, { ...f }]));
    const moved: number[] = [];
    for (const item of items) {
      const node = nodes.get(item.id);
      if (!node || !Number.isInteger(item.position) || item.position < 0) throw new GcsValidationError({ order: "invalid_order" });
      const parent = item.parentId === null ? null : nodes.get(item.parentId);
      if (parentError(node.type, parent) !== null) throw new GcsValidationError({ order: "invalid_parent" });
      if (node.parentId !== item.parentId) moved.push(item.id);
      node.parentId = item.parentId;
    }
    for (const node of nodes.values()) {
      const seen = new Set<number>();
      for (let cur: ForumNode | undefined = node; cur?.parentId != null; cur = nodes.get(cur.parentId)) {
        if (seen.has(cur.id)) throw new GcsValidationError({ order: "cycle" });
        seen.add(cur.id);
      }
    }

    await db.$transaction(async (tx) => {
      for (const item of items) {
        await tx.forum.update({ where: { id: item.id }, data: { parentId: item.parentId, position: item.position } });
      }
      for (const id of moved) {
        const parentId = nodes.get(id)!.parentId;
        await tx.containerInherit.upsert({
          where: { containerType_containerId: { containerType: CONTAINER, containerId: String(id) } },
          update: { parentId: parentId === null ? null : String(parentId) },
          create: { containerType: CONTAINER, containerId: String(id), parentId: parentId === null ? null : String(parentId), inherits: true },
        });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "forum.reorder", targetType: "forum", targetId: "tree", after: items, ip: actor.ip });
    });
    await this.changed(items.map((i) => i.id), moved.length > 0);
  }

  /**
   * Șterge un forum. Topicurile lui se mută în `moveContentTo` (obligatoriu dacă are topicuri), iar subforumurile
   * urcă la părintele lui. O categorie care mai are forumuri nu se poate șterge.
   */
  async delete(id: number, opts: { moveContentTo?: number }, actor: GcsActor): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, FORUMS_ACP_SECTION, "delete");
    const forum = await db.forum.findUnique({ where: { id } });
    if (!forum) throw new GcsNotFound();

    const children = await db.forum.findMany({ where: { parentId: id }, select: { id: true } });
    if (forum.type === "CATEGORY" && children.length > 0) throw new GcsConflict({ reason: "has_children" });

    const topics = await db.topic.count({ where: { forumId: id } });
    let target: number | null = null;
    if (topics > 0) {
      if (opts.moveContentTo === undefined) throw new GcsConflict({ reason: "has_content" });
      const dest = await db.forum.findUnique({ where: { id: opts.moveContentTo } });
      if (!dest || dest.id === id || (dest.type !== "FORUM" && dest.type !== "QA")) throw new GcsValidationError({ moveContentTo: "invalid_choice" });
      target = dest.id;
    }

    await db.$transaction(async (tx) => {
      if (target !== null) {
        await tx.topic.updateMany({ where: { forumId: id }, data: { forumId: target } });
        await this.counters.recountForum(tx, target);
      }
      if (children.length > 0) {
        await tx.forum.updateMany({ where: { parentId: id }, data: { parentId: forum.parentId } });
        await tx.containerInherit.updateMany({
          where: { containerType: CONTAINER, parentId: String(id) },
          data: { parentId: forum.parentId === null ? null : String(forum.parentId) },
        });
      }
      const ref = { containerType: CONTAINER, containerId: String(id) };
      await tx.containerPermission.deleteMany({ where: ref });
      await tx.containerInherit.deleteMany({ where: ref });
      await tx.moderator.deleteMany({ where: ref });
      await tx.follow.deleteMany({ where: { contentType: CONTAINER, contentId: String(id) } });
      await tx.forumReadMark.deleteMany({ where: { forumId: id } });
      await tx.forum.delete({ where: { id } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "forum.delete",
        targetType: "forum",
        targetId: String(id),
        before: forum,
        after: { movedTo: target },
        ip: actor.ip,
      });
    });
    await this.changed([id, ...(target === null ? [] : [target])], true);
  }

  /** Permisiunile unui container nou de la rădăcină: `default` al permisiunilor pe container ale modulelor. */
  private async applyDefaultPermissions(tx: Tx, forumId: number): Promise<void> {
    const groups = await tx.group.findMany({ select: { id: true, key: true } });
    const rows: Prisma.ContainerPermissionCreateManyInput[] = [];
    for (const def of this.deps.registry.permissionDefs()) {
      if (def.scope !== "container" || def.containerType !== CONTAINER) continue;
      for (const g of groups) {
        if (def.default[g.key] === true) rows.push({ containerType: CONTAINER, containerId: String(forumId), groupId: g.id, action: def.key });
      }
    }
    await tx.containerPermission.createMany({ data: rows, skipDuplicates: true });
  }

  private async changed(forumIds: number[], permissionsChanged: boolean): Promise<void> {
    if (permissionsChanged) await this.deps.permissions.bumpVersion();
    await this.deps.bus.emit({
      name: "forum.updated",
      payload: { forumIds },
      tags: ["forums-tree", ...forumIds.map((id) => `forum:${id}`)],
    });
  }
}
