import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError, type GcsActor } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import { forumContainer, type GcsForumPosting } from "./posting";

export type GcsPollInput = { question: string; options: string[]; multiple: boolean; closesAt?: string | null };
export type GcsPollView = {
  id: number;
  question: string;
  multiple: boolean;
  closesAt: string | null;
  closed: boolean;
  voters: number;
  options: { id: number; text: string; votes: number }[];
  myVotes: number[];
  canVote: boolean;
};

type Tx = Prisma.TransactionClient;

/** Validează sondajul unui topic nou: întrebare 3–200 de caractere, 2–10 opțiuni distincte de 1–100 de caractere. */
export function validatePoll(input: GcsPollInput): { question: string; options: string[]; multiple: boolean; closesAt: Date | null } {
  const errors: Record<string, string> = {};
  const question = input.question.replace(/\s+/g, " ").trim();
  if (question.length < 3 || question.length > 200) errors["poll.question"] = "invalid";
  const options = input.options.map((o) => o.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (options.length < 2 || options.length > 10 || options.some((o) => o.length > 100) || new Set(options).size !== options.length) {
    errors["poll.options"] = "invalid";
  }
  let closesAt: Date | null = null;
  if (input.closesAt) {
    closesAt = new Date(input.closesAt);
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= Date.now()) errors["poll.closesAt"] = "invalid";
  }
  if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
  return { question, options, multiple: input.multiple, closesAt };
}

/** Sondajele topicurilor (spec §7). Un user votează o singură dată; voturile pe același sondaj se serializează. */
export class GcsPollService {
  constructor(private readonly posting: GcsForumPosting) {}

  async createInTx(tx: Tx, topicId: number, input: ReturnType<typeof validatePoll>): Promise<void> {
    await tx.poll.create({
      data: {
        topicId,
        question: input.question,
        multiple: input.multiple,
        closesAt: input.closesAt,
        options: { create: input.options.map((text, position) => ({ text, position })) },
      },
    });
  }

  async vote(actor: GcsActor, pollId: number, optionIds: number[]): Promise<void> {
    const { db, bus, permissions } = this.posting.deps;
    const poll = await db.poll.findUnique({ where: { id: pollId }, include: { topic: true, options: { select: { id: true } } } });
    if (!poll) throw new GcsNotFound();
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (poll.topic.visibility !== "VISIBLE" || !(await permissions.can(actor, "forums.read", forumContainer(poll.topic.forumId)))) {
      throw new GcsNotFound();
    }
    const chosen = [...new Set(optionIds)];
    const valid = new Set(poll.options.map((o) => o.id));
    if (chosen.length === 0 || (!poll.multiple && chosen.length > 1) || chosen.some((id) => !valid.has(id))) {
      throw new GcsValidationError({ options: "invalid_choice" });
    }

    await db.$transaction(async (tx) => {
      // Lock pe sondaj: două voturi simultane ale aceluiași user nu pot trece amândouă de verificarea de mai jos.
      const [locked] = await tx.$queryRaw<{ closed: boolean }[]>`
        SELECT ("closesAt" IS NOT NULL AND "closesAt" <= now() AT TIME ZONE 'UTC') AS closed FROM polls WHERE id = ${pollId} FOR UPDATE`;
      if (!locked) throw new GcsNotFound();
      if (locked.closed) throw new GcsConflict({ reason: "poll_closed" });
      if ((await tx.pollVote.count({ where: { pollId, userId: actor.userId! } })) > 0) throw new GcsConflict({ reason: "already_voted" });
      await tx.pollVote.createMany({ data: chosen.map((optionId) => ({ pollId, optionId, userId: actor.userId! })) });
      await tx.pollOption.updateMany({ where: { id: { in: chosen } }, data: { votesCount: { increment: 1 } } });
    });
    await bus.emit({ name: "poll.voted", payload: { pollId, topicId: poll.topicId }, tags: [`topic:${poll.topicId}`] });
  }

  /** Sondajul unui topic, cu rezultatele și voturile actorului; `null` dacă topicul nu are sondaj. */
  async forTopic(actor: GcsActor, topicId: number): Promise<GcsPollView | null> {
    const { db } = this.posting.deps;
    const poll = await db.poll.findUnique({ where: { topicId }, include: { options: { orderBy: { position: "asc" } } } });
    if (!poll) return null;
    const [voters, mine] = await Promise.all([
      db.pollVote.findMany({ where: { pollId: poll.id }, distinct: ["userId"], select: { userId: true } }),
      actor.userId ? db.pollVote.findMany({ where: { pollId: poll.id, userId: actor.userId }, select: { optionId: true } }) : Promise.resolve([]),
    ]);
    const closed = poll.closesAt !== null && poll.closesAt.getTime() <= Date.now();
    return {
      id: poll.id,
      question: poll.question,
      multiple: poll.multiple,
      closesAt: poll.closesAt?.toISOString() ?? null,
      closed,
      voters: voters.length,
      options: poll.options.map((o) => ({ id: o.id, text: o.text, votes: o.votesCount })),
      myVotes: mine.map((v) => v.optionId),
      canVote: actor.userId !== null && !closed && mine.length === 0,
    };
  }
}
