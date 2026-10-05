import { GcsNotFound, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEventBus } from "@gcs/core";
import type { PrismaClient, TopicPrefix } from "@gcs/db";
import { FORUMS_ACP_SECTION } from "./forums";

export const PREFIXES_ACP_SECTION = "community.prefixes";
export type GcsPrefixInput = { name: string; color: string };

function validate(input: GcsPrefixInput): void {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) errors.name = "required";
  else if (name.length > 30) errors.name = "too_long";
  if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) errors.color = "invalid_color";
  if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
}

/** Prefixele colorate ale topicurilor (spec §7), definite în ACP și restricționabile pe forum. */
export class GcsPrefixService {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService }) {}

  list(): Promise<TopicPrefix[]> {
    return this.deps.db.topicPrefix.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  }

  /** Prefixele permise pe un forum: cele legate de el, sau toate dacă nu are nicio restricție. */
  async allowedFor(forumId: number): Promise<TopicPrefix[]> {
    const links = await this.deps.db.forumPrefix.findMany({ where: { forumId }, select: { prefixId: true } });
    const all = await this.list();
    if (links.length === 0) return all;
    const allowed = new Set(links.map((l) => l.prefixId));
    return all.filter((p) => allowed.has(p.id));
  }

  async create(actor: GcsActor, input: GcsPrefixInput): Promise<TopicPrefix> {
    await this.deps.acp.assert(actor, PREFIXES_ACP_SECTION, "edit");
    validate(input);
    const last = await this.deps.db.topicPrefix.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const row = await this.deps.db.topicPrefix.create({
      data: { name: input.name.trim(), color: input.color, position: (last?.position ?? -1) + 1 },
    });
    await this.audit(actor, "prefix.create", row.id, null, row);
    return row;
  }

  async update(actor: GcsActor, id: number, input: GcsPrefixInput): Promise<TopicPrefix> {
    await this.deps.acp.assert(actor, PREFIXES_ACP_SECTION, "edit");
    validate(input);
    const before = await this.deps.db.topicPrefix.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    const row = await this.deps.db.topicPrefix.update({ where: { id }, data: { name: input.name.trim(), color: input.color } });
    await this.audit(actor, "prefix.update", id, before, row);
    return row;
  }

  async delete(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, PREFIXES_ACP_SECTION, "delete");
    const before = await this.deps.db.topicPrefix.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await this.deps.db.topicPrefix.delete({ where: { id } });
    await this.audit(actor, "prefix.delete", id, before, null);
  }

  async reorder(actor: GcsActor, ids: number[]): Promise<void> {
    await this.deps.acp.assert(actor, PREFIXES_ACP_SECTION, "edit");
    const { db } = this.deps;
    await db.$transaction(ids.map((id, position) => db.topicPrefix.update({ where: { id }, data: { position } })));
    await this.changed();
  }

  /** Restrânge prefixele unui forum (lista goală = toate permise). Face parte din editarea forumului. */
  async setForumPrefixes(actor: GcsActor, forumId: number, prefixIds: number[]): Promise<void> {
    await this.deps.acp.assert(actor, FORUMS_ACP_SECTION, "edit");
    const { db } = this.deps;
    await db.$transaction([
      db.forumPrefix.deleteMany({ where: { forumId } }),
      db.forumPrefix.createMany({ data: [...new Set(prefixIds)].map((prefixId) => ({ forumId, prefixId })) }),
    ]);
    await this.changed();
  }

  private async audit(actor: GcsActor, action: string, id: number, before: unknown, after: unknown): Promise<void> {
    await writeAudit(this.deps.db, { actorId: actor.userId, action, targetType: "prefix", targetId: String(id), before, after, ip: actor.ip });
    await this.changed();
  }

  private async changed(): Promise<void> {
    await this.deps.bus.emit({ name: "prefix.updated", payload: {}, tags: ["prefixes"] });
  }
}
