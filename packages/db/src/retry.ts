/**
 * Rulează din nou o scriere care a pierdut o cursă pe un index unic (`P2002`), ex. un `upsert` Prisma: două prime
 * inserări simultane se ciocnesc, a doua reîncearcă și găsește rândul (devine actualizare). Înlocuiește
 * `INSERT … ON CONFLICT DO UPDATE` portabil (PostgreSQL și MySQL).
 */
export async function retryOnUnique<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= attempts || (error as { code?: string } | null)?.code !== "P2002") throw error;
    }
  }
}
