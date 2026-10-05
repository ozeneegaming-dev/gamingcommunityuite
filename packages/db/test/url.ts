/** Câte baze de test se creează (una per worker Vitest, `redline_test_<VITEST_POOL_ID>`). */
export const TEST_DB_COUNT = 4;

/** Înlocuiește numele bazei de date dintr-un URL PostgreSQL. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
