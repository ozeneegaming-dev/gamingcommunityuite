import { jsonStrings, type Prisma } from "@gcs/db";

type Tx = Pick<Prisma.TransactionClient, "systemState">;

/** Marcajele seed-ului deja aplicate (`system_state.seedMarks`, o listă JSON); rândul de stare se creează la nevoie. */
export async function seedMarksOf(tx: Tx): Promise<string[]> {
  const state = await tx.systemState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  return jsonStrings(state.seedMarks);
}

/** Adaugă marcaje (fără dubluri), ca fostul `push` pe lista scalară. */
export async function addSeedMarks(tx: Tx, marks: string | string[]): Promise<void> {
  const current = await seedMarksOf(tx);
  const next = [...new Set([...current, ...(Array.isArray(marks) ? marks : [marks])])];
  if (next.length !== current.length) await tx.systemState.update({ where: { id: 1 }, data: { seedMarks: next } });
}
