import { Prisma, type PrismaClient, type Reaction } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import type { GcsCache } from "../cache";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsActor } from "../permissions/types";

/** Secțiunea ACP Membri → Setări membri → Reputație & Reacții. */
export const REACTIONS_ACP_SECTION = "members.reputation";
const CACHE_KEY = "reactions:list";
const CACHE_TAG = "reactions";

/** Ce trebuie să știe serviciul despre un tip de conținut: autorul, cine îl vede și tag-urile de cache. */
export type GcsReactableContent = {
  author: (contentId: string) => Promise<string | null>;
  canView: (actor: GcsActor, contentId: string) => Promise<boolean>;
  tags: (contentId: string) => string[] | Promise<string[]>;
};

export type GcsReactionView = Pick<Reaction, "id" | "key" | "label" | "symbol" | "color" | "weight">;
export type GcsReactionInput = { id?: number; key: string; label: string; symbol: string; color: string; weight: number; enabled: boolean };
export type GcsReactionCount = { reactionId: number; count: number };

function validate(input: GcsReactionInput): void {
  const errors: Record<string, string> = {};
  if (!/^[a-z0-9_]{2,20}$/.test(input.key)) errors.key = "invalid";
  if (!input.label.trim() || input.label.length > 30) errors.label = "required";
  if (!input.symbol.trim() || [...input.symbol].length > 8) errors.symbol = "required";
  if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) errors.color = "invalid_color";
  if (!Number.isInteger(input.weight) || input.weight < -10 || input.weight > 10) errors.weight = "invalid_range";
  if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
}

/**
 * Reacțiile (spec §5, §7): una per user per conținut, configurabile din ACP. Greutatea reacției se adaugă la
 * reputația autorului conținutului (schimbarea ulterioară a greutății nu recalculează reputația existentă).
 */
export class GcsReactionService {
  private readonly contents = new Map<string, GcsReactableContent>();

  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; cache: GcsCache; acp: GcsAcpRoleService }) {}

  /** Un modul își înregistrează tipul de conținut (ex. `forums.post`). */
  registerContent(contentType: string, content: GcsReactableContent): void {
    this.contents.set(contentType, content);
  }

  /** Autorul unui conținut cu reacții (`null` dacă tipul nu e înregistrat sau conținutul nu mai există). */
  async authorOf(contentType: string, contentId: string): Promise<string | null> {
    return (await this.contents.get(contentType)?.author(contentId)) ?? null;
  }

  /** Reacțiile active, în ordinea din ACP (din cache). */
  async list(): Promise<GcsReactionView[]> {
    const cached = await this.deps.cache.get<GcsReactionView[]>(CACHE_KEY);
    if (cached) return cached;
    const rows = await this.deps.db.reaction.findMany({
      where: { enabled: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, key: true, label: true, symbol: true, color: true, weight: true },
    });
    await this.deps.cache.set(CACHE_KEY, rows, { ttlSec: 3600, tags: [CACHE_TAG] });
    return rows;
  }

  /** Toate reacțiile, inclusiv cele dezactivate (ACP). */
  all(): Promise<Reaction[]> {
    return this.deps.db.reaction.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  }

  /** Pune, schimbă (`reactionId`) sau retrage (`null`) reacția actorului pe un conținut. */
  async react(actor: GcsActor, ref: { contentType: string; contentId: string; reactionId: number | null }): Promise<void> {
    const { db, bus } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const content = this.contents.get(ref.contentType);
    if (!content || !(await content.canView(actor, ref.contentId))) throw new GcsNotFound();
    const authorId = await content.author(ref.contentId);
    if (authorId === actor.userId) throw new GcsForbidden({ reason: "own_content" });

    let next: Reaction | null = null;
    if (ref.reactionId !== null) {
      next = await db.reaction.findUnique({ where: { id: ref.reactionId } });
      if (!next?.enabled) throw new GcsValidationError({ reactionId: "invalid_choice" });
    }

    const where = { contentType_contentId_userId: { contentType: ref.contentType, contentId: ref.contentId, userId: actor.userId } };
    const changed = await db
      .$transaction(async (tx) => {
        const existing = await tx.contentReaction.findUnique({ where, include: { reaction: { select: { weight: true } } } });
        if ((existing?.reactionId ?? null) === (next?.id ?? null)) return false;
        if (!next) await tx.contentReaction.delete({ where });
        else if (existing) await tx.contentReaction.update({ where, data: { reactionId: next.id } });
        else await tx.contentReaction.create({ data: { contentType: ref.contentType, contentId: ref.contentId, userId: actor.userId!, reactionId: next.id } });
        const delta = (next?.weight ?? 0) - (existing?.reaction.weight ?? 0);
        if (authorId && delta !== 0) await tx.user.update({ where: { id: authorId }, data: { reputation: { increment: delta } } });
        return true;
      })
      .catch((e: unknown) => {
        // Două reacții simultane ale aceluiași user: a doua lovește constrângerea unică.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new GcsConflict({ reason: "duplicate" });
        throw e;
      });
    if (!changed) return;

    await bus.emit({
      name: "reaction.changed",
      payload: { ...ref, userId: actor.userId, authorId },
      tags: [...(await content.tags(ref.contentId)), ...(authorId ? [`user:${authorId}`] : [])],
    });
  }

  /** Câte reacții de fiecare fel are fiecare conținut (doar cele cu reacții apar în rezultat). */
  async summary(contentType: string, contentIds: string[]): Promise<Record<string, GcsReactionCount[]>> {
    if (contentIds.length === 0) return {};
    const [rows, order] = await Promise.all([
      this.deps.db.contentReaction.groupBy({
        by: ["contentId", "reactionId"],
        where: { contentType, contentId: { in: contentIds } },
        _count: { _all: true },
      }),
      this.all(),
    ]);
    const position = new Map(order.map((r, i) => [r.id, i]));
    const out: Record<string, GcsReactionCount[]> = {};
    for (const r of rows) (out[r.contentId] ??= []).push({ reactionId: r.reactionId, count: r._count._all });
    for (const list of Object.values(out)) list.sort((a, b) => (position.get(a.reactionId) ?? 0) - (position.get(b.reactionId) ?? 0));
    return out;
  }

  /** Reacția userului pe fiecare conținut (doar unde are una). */
  async mine(userId: string | null, contentType: string, contentIds: string[]): Promise<Record<string, number>> {
    if (!userId || contentIds.length === 0) return {};
    const rows = await this.deps.db.contentReaction.findMany({
      where: { userId, contentType, contentId: { in: contentIds } },
      select: { contentId: true, reactionId: true },
    });
    return Object.fromEntries(rows.map((r) => [r.contentId, r.reactionId]));
  }

  /** ACP: adaugă sau editează o reacție. */
  async upsert(actor: GcsActor, input: GcsReactionInput): Promise<Reaction> {
    await this.deps.acp.assert(actor, REACTIONS_ACP_SECTION, "edit");
    validate(input);
    const data = {
      key: input.key,
      label: input.label.trim(),
      symbol: input.symbol.trim(),
      color: input.color,
      weight: input.weight,
      enabled: input.enabled,
    };
    const row = await this.deps.db.$transaction(async (tx) => {
      if (input.id !== undefined) return tx.reaction.update({ where: { id: input.id }, data });
      const last = await tx.reaction.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
      return tx.reaction.create({ data: { ...data, position: (last?.position ?? -1) + 1 } });
    });
    await this.changed();
    return row;
  }

  /** ACP: ordinea reacțiilor (toate id-urile, în ordinea nouă). */
  async reorder(actor: GcsActor, ids: number[]): Promise<void> {
    await this.deps.acp.assert(actor, REACTIONS_ACP_SECTION, "edit");
    await this.deps.db.$transaction(ids.map((id, position) => this.deps.db.reaction.update({ where: { id }, data: { position } })));
    await this.changed();
  }

  private async changed(): Promise<void> {
    await this.deps.bus.emit({ name: "reactions.updated", payload: {}, tags: [CACHE_TAG] });
  }
}
