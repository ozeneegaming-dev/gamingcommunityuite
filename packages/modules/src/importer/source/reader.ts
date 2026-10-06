/**
 * Citirea bazei vechi printr-o interfață structurată (nu SQL liber): tabel, coloane, filtre simple, ordine, limită.
 * Implementarea MySQL construiește SQL parametrizat și deschide sesiunea doar pentru citire; cea în memorie aplică
 * aceleași filtre pe rânduri înregistrate (testele adaptoarelor și sursa de test din E2E).
 */
export type GcsSqlValue = string | number | null;
export type GcsCond =
  | GcsSqlValue
  | { in: GcsSqlValue[] }
  | { gt: number | string }
  | { gte: number | string }
  | { lt: number | string }
  | { lte: number | string }
  | { ne: GcsSqlValue }
  | { isNull: boolean }
  /** `(low, high]`: citirea pe intervale a tabelelor cu cheie compusă. */
  | { between: [number, number] };

export type GcsSelect = {
  columns?: string[];
  where?: Record<string, GcsCond>;
  orderBy?: [string, "asc" | "desc"][];
  limit?: number;
};

export type GcsRow = Record<string, unknown>;

export interface GcsSourceReader {
  /** Numele tabelelor din baza veche. */
  tables(): Promise<string[]>;
  /** Coloanele unui tabel (versiunile diferă). Un tabel lipsă → listă goală. */
  columns(table: string): Promise<string[]>;
  select(table: string, q?: GcsSelect): Promise<GcsRow[]>;
  count(table: string, where?: Record<string, GcsCond>): Promise<number>;
  max(table: string, column: string): Promise<number | null>;
  close(): Promise<void>;
}

const IDENT = /^[A-Za-z0-9_]{1,64}$/;

/** Un identificator SQL (tabel, coloană) validat și pus între backtick-uri. Orice altceva aruncă eroare. */
export function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`identificator invalid: ${name.slice(0, 40)}`);
  return `\`${name}\``;
}

function isOp(c: GcsCond): c is Exclude<GcsCond, GcsSqlValue> {
  return typeof c === "object" && c !== null;
}

/** `WHERE`-ul parametrizat al unei interogări (exportat pentru teste). */
export function buildWhere(where: Record<string, GcsCond> | undefined): { sql: string; params: GcsSqlValue[] } {
  const parts: string[] = [];
  const params: GcsSqlValue[] = [];
  for (const [column, cond] of Object.entries(where ?? {})) {
    const col = ident(column);
    if (!isOp(cond)) {
      if (cond === null) parts.push(`${col} IS NULL`);
      else {
        parts.push(`${col} = ?`);
        params.push(cond);
      }
    } else if ("in" in cond) {
      if (cond.in.length === 0) parts.push("1 = 0");
      else {
        parts.push(`${col} IN (${cond.in.map(() => "?").join(", ")})`);
        params.push(...cond.in);
      }
    } else if ("gt" in cond) {
      parts.push(`${col} > ?`);
      params.push(cond.gt);
    } else if ("gte" in cond) {
      parts.push(`${col} >= ?`);
      params.push(cond.gte);
    } else if ("lt" in cond) {
      parts.push(`${col} < ?`);
      params.push(cond.lt);
    } else if ("lte" in cond) {
      parts.push(`${col} <= ?`);
      params.push(cond.lte);
    } else if ("between" in cond) {
      parts.push(`${col} > ? AND ${col} <= ?`);
      params.push(cond.between[0], cond.between[1]);
    } else if ("ne" in cond) {
      if (cond.ne === null) parts.push(`${col} IS NOT NULL`);
      else {
        parts.push(`(${col} <> ? OR ${col} IS NULL)`);
        params.push(cond.ne);
      }
    } else {
      parts.push(cond.isNull ? `${col} IS NULL` : `${col} IS NOT NULL`);
    }
  }
  return { sql: parts.length > 0 ? ` WHERE ${parts.join(" AND ")}` : "", params };
}

/** Interogarea `SELECT` completă (exportată pentru teste). */
export function buildSelect(table: string, q: GcsSelect = {}): { sql: string; params: GcsSqlValue[] } {
  const cols = q.columns?.length ? q.columns.map(ident).join(", ") : "*";
  const where = buildWhere(q.where);
  const order = q.orderBy?.length ? ` ORDER BY ${q.orderBy.map(([c, d]) => `${ident(c)} ${d === "desc" ? "DESC" : "ASC"}`).join(", ")}` : "";
  const limit = q.limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(q.limit))}` : "";
  return { sql: `SELECT ${cols} FROM ${ident(table)}${where.sql}${order}${limit}`, params: where.params };
}

// ─── În memorie ──────────────────────────────────────────────────────────────

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  const x = Buffer.isBuffer(a) ? a.toString("utf8") : String(a);
  const y = Buffer.isBuffer(b) ? b.toString("utf8") : String(b);
  if (/^-?\d+(\.\d+)?$/.test(x) && /^-?\d+(\.\d+)?$/.test(y)) return Number(x) - Number(y);
  return x < y ? -1 : x > y ? 1 : 0;
}

function same(a: unknown, b: GcsSqlValue): boolean {
  if (a === undefined) a = null;
  if (a === null || b === null) return a === b;
  return compare(a, b) === 0;
}

function matches(row: GcsRow, where: Record<string, GcsCond> | undefined): boolean {
  for (const [column, cond] of Object.entries(where ?? {})) {
    const v = row[column];
    if (!isOp(cond)) {
      if (!same(v, cond)) return false;
    } else if ("in" in cond) {
      if (!cond.in.some((x) => same(v, x))) return false;
    } else if ("gt" in cond) {
      if (v === null || v === undefined || compare(v, cond.gt) <= 0) return false;
    } else if ("gte" in cond) {
      if (v === null || v === undefined || compare(v, cond.gte) < 0) return false;
    } else if ("lt" in cond) {
      if (v === null || v === undefined || compare(v, cond.lt) >= 0) return false;
    } else if ("lte" in cond) {
      if (v === null || v === undefined || compare(v, cond.lte) > 0) return false;
    } else if ("between" in cond) {
      if (v === null || v === undefined || compare(v, cond.between[0]) <= 0 || compare(v, cond.between[1]) > 0) return false;
    } else if ("ne" in cond) {
      if (same(v, cond.ne)) return false;
    } else if ((v === null || v === undefined) !== cond.isNull) return false;
  }
  return true;
}

/** O bază veche falsă, din rânduri înregistrate: aceleași filtre ca MySQL (testele adaptoarelor, sursa de test E2E). */
export function createMemoryReader(tables: Record<string, GcsRow[]>): GcsSourceReader {
  const rowsOf = (table: string) => {
    ident(table);
    return tables[table] ?? null;
  };
  return {
    async tables() {
      return Object.keys(tables);
    },
    async columns(table) {
      const rows = rowsOf(table);
      return rows ? [...new Set(rows.flatMap((r) => Object.keys(r)))] : [];
    },
    async select(table, q = {}) {
      const rows = rowsOf(table);
      if (!rows) throw new Error(`Table '${table}' doesn't exist`);
      let out = rows.filter((r) => matches(r, q.where));
      if (q.orderBy?.length) {
        out = [...out].sort((a, b) => {
          for (const [c, d] of q.orderBy!) {
            const diff = compare(a[c], b[c]);
            if (diff !== 0) return d === "desc" ? -diff : diff;
          }
          return 0;
        });
      }
      if (q.limit !== undefined) out = out.slice(0, q.limit);
      if (q.columns?.length) out = out.map((r) => Object.fromEntries(q.columns!.map((c) => [c, r[c] ?? null])));
      return out.map((r) => ({ ...r }));
    },
    async count(table, where) {
      const rows = rowsOf(table);
      return rows ? rows.filter((r) => matches(r, where)).length : 0;
    },
    async max(table, column) {
      const rows = rowsOf(table) ?? [];
      let best: number | null = null;
      for (const r of rows) {
        const v = Number(r[column]);
        if (Number.isFinite(v) && (best === null || v > best)) best = v;
      }
      return best;
    },
    async close() {},
  };
}

// ─── MySQL / MariaDB ─────────────────────────────────────────────────────────

export type GcsMysqlConfig = { host: string; port: number; database: string; user: string; password: string };

/**
 * Conexiunea la baza veche (MySQL/MariaDB), doar pentru citire: sesiunea e `READ ONLY` și se rulează doar
 * `SELECT`/`SHOW` construite aici (fără `multipleStatements`). Parola nu apare în erori sau loguri.
 */
export async function createMysqlReader(config: GcsMysqlConfig): Promise<GcsSourceReader> {
  const mysql = await import("mysql2/promise");
  let conn: Awaited<ReturnType<typeof mysql.createConnection>>;
  try {
    conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      charset: "utf8mb4",
      connectTimeout: 15_000,
      multipleStatements: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: true,
    });
  } catch (error) {
    // Mesajul driverului poate conține host-ul și userul, niciodată parola; codul e suficient pentru UI.
    const code = (error as { code?: string }).code ?? "connect_failed";
    throw new Error(`mysql:${code}`);
  }
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  const run = async (sql: string, params: GcsSqlValue[] = []) => {
    const [rows] = await conn.query({ sql, values: params, timeout: 120_000 });
    return rows as GcsRow[];
  };
  return {
    async tables() {
      const rows = await run("SHOW TABLES");
      return rows.map((r) => String(Object.values(r)[0]));
    },
    async columns(table) {
      try {
        return (await run(`SHOW COLUMNS FROM ${ident(table)}`)).map((r) => String(r.Field));
      } catch {
        return [];
      }
    },
    async select(table, q) {
      const { sql, params } = buildSelect(table, q);
      return run(sql, params);
    },
    async count(table, where) {
      const w = buildWhere(where);
      const rows = await run(`SELECT COUNT(*) AS n FROM ${ident(table)}${w.sql}`, w.params);
      return Number(rows[0]?.n ?? 0);
    },
    async max(table, column) {
      const rows = await run(`SELECT MAX(${ident(column)}) AS m FROM ${ident(table)}`);
      const v = rows[0]?.m;
      return v === null || v === undefined ? null : Number(v);
    },
    async close() {
      await conn.end().catch(() => {});
    },
  };
}
