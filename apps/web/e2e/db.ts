import { createRequire } from "node:module";
import path from "node:path";
import pg from "pg";

/**
 * Clientul SQL al specurilor, pe baza din `DATABASE_URL` (sau alta dată explicit): PostgreSQL cu `pg` sau, în rularea
 * MySQL-Lite (`mysql://…`), `mysql2`. Interogările se scriu o singură dată, în dialectul PostgreSQL (`$1`, `"coloană"`,
 * `now()`, `ON CONFLICT`…); pe MySQL trec prin aceeași traducere ca tag-ul `sql` al aplicației (`@gcs/db/dialect`,
 * încărcat dinamic: specurile rulează ca CommonJS). `INSERT/UPDATE … RETURNING` se emulează (id-ul inserat, respectiv
 * rândurile actualizate citite după).
 */
export type GcsE2eDb = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  end(): Promise<void>;
};

export const isMysqlUrl = (url: string | undefined) => /^mysql:\/\//i.test(url ?? "");

type MysqlField = { type: string; length: number; string(): string | null };
type MysqlConnection = { query(sql: string, values: unknown[]): Promise<[unknown, unknown]>; end(): Promise<void> };
type Mysql2 = { createConnection(opts: { uri: string; timezone: string; typeCast: (field: MysqlField, next: () => unknown) => unknown }): Promise<MysqlConnection> };

/** `mysql2/promise` din pachetul `@gcs/db` (dependența lui; aplicația web nu-l cere direct). */
function mysql2(): Mysql2 {
  const req = createRequire(path.resolve(process.cwd(), "../../packages/db/package.json"));
  return req("mysql2/promise") as Mysql2;
}

export async function e2eDb(url = process.env.DATABASE_URL): Promise<GcsE2eDb> {
  if (!isMysqlUrl(url)) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return {
      async query<T extends Record<string, unknown>>(text: string, params: unknown[] = []) {
        const r = await client.query<T>(text, params);
        return { rows: r.rows, rowCount: r.rowCount ?? 0 };
      },
      end: () => client.end(),
    };
  }
  const { mysqlStatement } = (await import("@gcs/db/dialect")) as typeof import("@gcs/db/dialect");
  const conn = await mysql2().createConnection({
    uri: url!,
    // DATETIME-urile sunt în UTC (ca valorile scrise de Prisma); TINYINT(1) e boolean (ca în PostgreSQL).
    timezone: "Z",
    typeCast: (field, next) => {
      if (field.type !== "TINY" || field.length !== 1) return next();
      const s = field.string();
      return s === null ? null : s === "1";
    },
  });
  const run = async (text: string, params: unknown[]) => {
    const { sql, values } = mysqlStatement(text, params);
    // Obiectele (coloanele JSON) pleacă ca text JSON, ca la `pg` (`mysql2` le-ar face `cheie = valoare`).
    const plain = values.map((v) => (v && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v) ? JSON.stringify(v) : v));
    const [result] = await conn.query(sql, plain);
    return result;
  };
  return {
    async query<T extends Record<string, unknown>>(text: string, params: unknown[] = []) {
      const returning = /\s+RETURNING\s+([\s\S]+?)\s*;?\s*$/i.exec(text);
      if (!returning) {
        const result = await run(text, params);
        if (Array.isArray(result)) return { rows: result as T[], rowCount: result.length };
        return { rows: [], rowCount: (result as { affectedRows: number }).affectedRows };
      }
      const body = text.slice(0, returning.index);
      const update = /^\s*UPDATE\s+("?\w+"?)\s+SET\s+[\s\S]+?\s+(WHERE\s+[\s\S]+)$/i.exec(body);
      if (update) {
        // Rândurile actualizate, citite după, cu aceeași condiție (specurile nu schimbă coloanele din WHERE).
        const result = (await run(body, params)) as { affectedRows: number };
        const rows = (await run(`SELECT ${returning[1]} FROM ${update[1]} ${update[2]}`, params)) as T[];
        return { rows, rowCount: result.affectedRows };
      }
      if (!/^id$/i.test(returning[1]!.trim())) throw new Error(`e2eDb (MySQL): RETURNING ${returning[1]} nu e suportat`);
      const result = (await run(body, params)) as { insertId: number; affectedRows: number };
      return { rows: [{ id: result.insertId } as unknown as T], rowCount: result.affectedRows };
    },
    end: () => conn.end(),
  };
}

/** O interogare pe o conexiune de unică folosință. */
export async function e2eQuery<T extends Record<string, unknown> = Record<string, unknown>>(url: string | undefined, text: string, params: unknown[] = []): Promise<T[]> {
  const db = await e2eDb(url);
  try {
    return (await db.query<T>(text, params)).rows;
  } finally {
    await db.end();
  }
}
