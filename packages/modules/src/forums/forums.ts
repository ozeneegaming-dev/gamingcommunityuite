import {
  GcsConflict,
  GcsNotFound,
  GcsValidationError,
  hashPassword,
  isSafeSlotHref,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsEventBus,
  type GcsModuleRegistry,
  type GcsPermissionService,
  type GcsRendered,
} from "@gcs/core";
import { Prisma, type Forum, type ForumType, type PrismaClient } from "@gcs/db";
import { isTopicSort } from "./queries";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { GcsForumCounters } from "./counters";
import { slugify } from "./slug";

/** Secțiunea ACP care dă dreptul de a administra structura forumului. */
export const FORUMS_ACP_SECTION = "community.forums";
const CONTAINER = "forum";
const COLOR = /^#[0-9A-Fa-f]{6}$/;

export type GcsForumInput = {
  parentId: number | null;
  type: ForumType;
  name: string;
  description?: string;
  icon?: string | null;
  color?: string | null;
  linkUrl?: string | null;
  requireApproval?: boolean;
  /** Pe câte coloane apar subforumurile în listă (1–5). */
  subforumColumns?: number;
};
export type GcsForumPatch = Partial<Omit<GcsForumInput, "parentId">>;

/** Forum v2: conținutul unui nod „Pagină / Anunț”. `content`: documentul editorului (cu blocuri) sau `null` (gol). */
export type GcsForumPageInput = {
  content: unknown;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  ctaIcon?: string | null;
  allowTopics?: boolean;
  audienceGroupIds?: number[];
};

/**
 * Forum v2: opțiunile unui forum. `password`: `undefined` = neschimbată, `""` = scoasă, altfel parola nouă.
 * `rules`: documentul editorului (regulile forumului) sau `null` (fără reguli).
 */
export type GcsForumOptionsInput = {
  ownTopicsOnly?: boolean;
  password?: string;
  rulesMode?: "off" | "show" | "accept";
  rules?: unknown;
  defaultSort?: string;
  pollsEnabled?: boolean;
  tagsEnabled?: boolean;
  minPosts?: number;
  countPosts?: boolean;
  autoCloseDays?: number;
  ratingEnabled?: boolean;
};

/** Randarea conținutului de către staff (Forum v2: pagina și regulile, cu blocuri), dată de servicii. */
export type GcsForumContentRender = (content: unknown, actor: GcsActor) => Promise<GcsRendered>;
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
  // Iconițele sunt din Font Awesome Free (ex. `fa-solid fa-gamepad`), alese din selectorul ACP.
  if (input.icon && !isGcsIcon(input.icon)) errors.icon = "invalid_choice";
  if (input.subforumColumns !== undefined && (!Number.isInteger(input.subforumColumns) || input.subforumColumns < 1 || input.subforumColumns > 5)) {
    errors.subforumColumns = "invalid_range";
  }
  if (type === "LINK") {
    const url = input.linkUrl ?? "";
    if (!URL.canParse(url) || !["http:", "https:"].includes(new URL(url).protocol)) errors.linkUrl = "invalid_url";
  }
  return errors;
}

/** Regula structurii: categoriile stau la rădăcină; forumurile și paginile, sub o categorie, un forum sau o pagină (nu sub un link). */
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
      /** Forum v2: randarea paginilor și a regulilor (editorul cu blocuri); lipsă = conținutul nu se poate salva. */
      render?: GcsForumContentRender;
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
          ...(input.subforumColumns !== undefined ? { subforumColumns: input.subforumColumns } : {}),
          position: last ? last.position + 1 : 0,
        },
      });
      // Forum v2: o pagină nouă pornește goală (conținutul se scrie în tabul „Pagină”).
      if (input.type === "PAGE") await tx.forumPage.create({ data: { forumId: row.id } });
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
    if (patch.subforumColumns !== undefined) data.subforumColumns = patch.subforumColumns;
    data.linkUrl = type === "LINK" ? (patch.linkUrl ?? before.linkUrl) : null;

    const forum = await db.$transaction(async (tx) => {
      const row = await tx.forum.update({ where: { id }, data });
      if (type === "PAGE") await tx.forumPage.upsert({ where: { forumId: id }, create: { forumId: id }, update: {} });
      await writeAudit(tx, { actorId: actor.userId, action: "forum.update", targetType: "forum", targetId: String(id), before, after: row, ip: actor.ip });
      return row;
    });
    await this.changed([id], false);
    return forum;
  }

  /**
   * Forum v2: pagina unui nod „Pagină / Anunț”: conținutul (editorul cu blocuri, randat și sanitizat), butonul CTA
   * (text + link intern sau https), topicurile de dedesubt și grupurile care o văd (gol = toți cei care văd forumul).
   */
  async savePage(actor: GcsActor, id: number, input: GcsForumPageInput): Promise<void> {
    const { db, acp, render } = this.deps;
    await acp.assert(actor, FORUMS_ACP_SECTION, "edit");
    const forum = await db.forum.findUnique({ where: { id }, select: { id: true, type: true } });
    if (!forum) throw new GcsNotFound();
    if (forum.type !== "PAGE") throw new GcsValidationError({ type: "invalid_type" });
    const errors: Record<string, string> = {};
    const label = input.ctaLabel?.trim() ?? "";
    const url = input.ctaUrl?.trim() ?? "";
    if (label.length > 60) errors.ctaLabel = "too_long";
    if (url !== "" && !isSafeSlotHref(url)) errors.ctaUrl = "invalid_url";
    if ((label === "") !== (url === "")) errors[label === "" ? "ctaLabel" : "ctaUrl"] = "required";
    if (input.ctaIcon && !isGcsIcon(input.ctaIcon)) errors.ctaIcon = "invalid_choice";
    const audience = [...new Set(input.audienceGroupIds ?? [])];
    if (audience.length > 0 && (await db.group.count({ where: { id: { in: audience } } })) !== audience.length) errors.audienceGroupIds = "invalid_choice";
    let rendered: GcsRendered | null = null;
    if (input.content !== null && input.content !== undefined) {
      if (!render) throw new GcsValidationError({ content: "invalid" });
      try {
        rendered = await render(input.content, actor);
      } catch (error) {
        if (error instanceof GcsValidationError) Object.assign(errors, error.fields);
        else throw error;
      }
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = {
      contentJson: rendered ? (rendered.json as Prisma.InputJsonValue) : Prisma.DbNull,
      contentHtml: rendered?.html ?? "",
      ctaLabel: label || null,
      ctaUrl: url || null,
      ctaIcon: input.ctaIcon || null,
      allowTopics: input.allowTopics ?? false,
      audienceGroupIds: audience,
      updatedById: actor.userId,
    };
    await db.$transaction(async (tx) => {
      const before = await tx.forumPage.findUnique({ where: { forumId: id }, select: { ctaLabel: true, ctaUrl: true, allowTopics: true, audienceGroupIds: true } });
      await tx.forumPage.upsert({ where: { forumId: id }, create: { forumId: id, ...data }, update: data });
      await writeAudit(tx, { actorId: actor.userId, action: "forum.page.update", targetType: "forum", targetId: String(id), before, after: { ctaLabel: data.ctaLabel, ctaUrl: data.ctaUrl, allowTopics: data.allowTopics, audienceGroupIds: audience }, ip: actor.ip });
    });
    await this.changed([id], false);
  }

  /** Forum v2: resetează notele tuturor topicurilor din forum (ACP → Forumuri → Editează → Opțiuni). */
  async resetRatings(actor: GcsActor, id: number): Promise<number> {
    const { db, acp } = this.deps;
    await acp.assert(actor, FORUMS_ACP_SECTION, "delete");
    const forum = await db.forum.findUnique({ where: { id }, select: { id: true } });
    if (!forum) throw new GcsNotFound();
    const topics = (await db.topic.findMany({ where: { forumId: id, ratingCount: { gt: 0 } }, select: { id: true } })).map((t) => String(t.id));
    const removed = await db.$transaction(async (tx) => {
      const r = await tx.contentRating.deleteMany({ where: { contentType: "forums.topic", contentId: { in: topics } } });
      await tx.contentRatingSummary.deleteMany({ where: { contentType: "forums.topic", contentId: { in: topics } } });
      await tx.topic.updateMany({ where: { forumId: id }, data: { ratingAvg: 0, ratingCount: 0 } });
      await writeAudit(tx, { actorId: actor.userId, action: "rating.reset_forum", targetType: "forum", targetId: String(id), after: { topics: topics.length, votes: r.count }, ip: actor.ip });
      return r.count;
    });
    await this.deps.bus.emit({ name: "rating.changed", payload: { forumId: id }, tags: [`forum:${id}`, "forums-ratings", ...topics.slice(0, 500).map((t) => `topic:${t}`)] });
    return removed;
  }

  /** Forum v2: opțiunile forumului (topicuri proprii, parolă, reguli, sortare, sondaje, tag-uri, praguri, notă). */
  async saveOptions(actor: GcsActor, id: number, input: GcsForumOptionsInput): Promise<void> {
    const { db, acp, render } = this.deps;
    await acp.assert(actor, FORUMS_ACP_SECTION, "edit");
    const before = await db.forum.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    const errors: Record<string, string> = {};
    const data: Prisma.ForumUpdateInput = {};
    if (input.ownTopicsOnly !== undefined) data.ownTopicsOnly = input.ownTopicsOnly;
    if (input.pollsEnabled !== undefined) data.pollsEnabled = input.pollsEnabled;
    if (input.tagsEnabled !== undefined) data.tagsEnabled = input.tagsEnabled;
    if (input.countPosts !== undefined) data.countPosts = input.countPosts;
    if (input.ratingEnabled !== undefined) data.ratingEnabled = input.ratingEnabled;
    if (input.defaultSort !== undefined) {
      if (!isTopicSort(input.defaultSort)) errors.defaultSort = "invalid_choice";
      else data.defaultSort = input.defaultSort;
    }
    if (input.minPosts !== undefined) {
      if (!Number.isInteger(input.minPosts) || input.minPosts < 0 || input.minPosts > 1_000_000) errors.minPosts = "invalid_range";
      else data.minPosts = input.minPosts;
    }
    if (input.autoCloseDays !== undefined) {
      if (!Number.isInteger(input.autoCloseDays) || input.autoCloseDays < 0 || input.autoCloseDays > 3650) errors.autoCloseDays = "invalid_range";
      else data.autoCloseDays = input.autoCloseDays;
    }
    if (input.password !== undefined) {
      if (input.password === "") data.passwordHash = null;
      else if (input.password.length < 4 || input.password.length > 100) errors.password = "invalid_length";
      else data.passwordHash = await hashPassword(input.password);
    }
    if (input.rulesMode !== undefined) {
      if (!["off", "show", "accept"].includes(input.rulesMode)) errors.rulesMode = "invalid_choice";
      else data.rulesMode = input.rulesMode;
    }
    if (input.rules !== undefined) {
      if (input.rules === null) {
        data.rulesJson = Prisma.DbNull;
        data.rulesHtml = "";
      } else if (!render) errors.rules = "invalid";
      else {
        try {
          const r = await render(input.rules, actor);
          data.rulesJson = r.json as Prisma.InputJsonValue;
          data.rulesHtml = r.html;
        } catch (error) {
          if (error instanceof GcsValidationError) errors.rules = Object.values(error.fields)[0] ?? "invalid";
          else throw error;
        }
      }
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    await db.$transaction(async (tx) => {
      const row = await tx.forum.update({ where: { id }, data });
      // Regulile acceptate se cer din nou după o schimbare a textului lor.
      if (input.rules !== undefined) await tx.forumRulesAcceptance.deleteMany({ where: { forumId: id } });
      const { passwordHash: _a, rulesJson: _b, ...afterSafe } = row;
      const { passwordHash: _c, rulesJson: _d, ...beforeSafe } = before;
      await writeAudit(tx, { actorId: actor.userId, action: "forum.options.update", targetType: "forum", targetId: String(id), before: { ...beforeSafe, hasPassword: before.passwordHash !== null }, after: { ...afterSafe, hasPassword: row.passwordHash !== null }, ip: actor.ip });
    });
    await this.changed([id], false);
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
      if (!dest || dest.id === id || (dest.type !== "FORUM" && dest.type !== "QA" && dest.type !== "PAGE")) throw new GcsValidationError({ moveContentTo: "invalid_choice" });
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
