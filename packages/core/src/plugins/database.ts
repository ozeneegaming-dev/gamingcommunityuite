import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { GcsConflict, GcsValidationError } from "../errors";
import { pluginSchema } from "./catalog";
import { checkPluginSql } from "./sqlGuard";

export type GcsPluginDbCredentials = { role: string; password: string };

/** Câte rânduri poate întoarce o interogare a unui plugin. */
export const PLUGIN_QUERY_MAX_ROWS = 1000;
const QUERY_TIMEOUT = "5s";
const MIGRATION_TIMEOUT = "60s";

/** Un URL PostgreSQL curat (fără parametrii Prisma), cu alt user și altă parolă. */
function urlFor(databaseUrl: string, creds?: GcsPluginDbCredentials): string {
  const src = new URL(databaseUrl);
  const url = new URL(`${src.protocol}//${src.host}${src.pathname}`);
  url.username = encodeURIComponent(creds ? creds.role : decodeURIComponent(src.username));
  url.password = encodeURIComponent(creds ? creds.password : decodeURIComponent(src.password));
  const ssl = src.searchParams.get("sslmode");
  if (ssl) url.searchParams.set("sslmode", ssl);
  return url.toString();
}

/** Valorile întoarse unui plugin: doar JSON (datele → ISO, octeții → base64, `bigint` → text). */
function jsonRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (Buffer.isBuffer(v)) out[k] = v.toString("base64");
    else if (typeof v === "bigint") out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}

const isPermissionError = (e: unknown) => typeof e === "object" && e !== null && ((e as { code?: string }).code === "42501" || /permission denied|must have/i.test(String((e as Error).message)));

/**
 * Baza de date a unui plugin (designul pluginurilor §2.3): un **rol PostgreSQL dedicat** (`LOGIN`, fără drepturi
 * speciale) și schema `plugin_<vendor>__<nume>`, proprietatea lui. Migrațiile și interogările pluginului rulează pe o
 * conexiune autentificată ca acest rol, deci tabelele nucleului (ale userului aplicației) îi sunt inaccesibile, oricum
 * ar fi scris SQL-ul. Verificarea statică (`sqlGuard`) rulează în plus, ca apărare în adâncime.
 */
export class GcsPluginDatabase {
  private readonly pools = new Map<string, { pool: pg.Pool; password: string }>();

  constructor(private readonly deps: { databaseUrl: string | undefined }) {}

  private get url(): string {
    if (!this.deps.databaseUrl) throw new GcsConflict({ reason: "db_unavailable" });
    return this.deps.databaseUrl;
  }

  /** Numele rolului: unic per bază de date și plugin (rolurile sunt globale pe serverul PostgreSQL). */
  roleName(key: string): string {
    const database = decodeURIComponent(new URL(this.url).pathname.slice(1));
    return `gcsp_${createHash("sha256").update(`${database}:${key}`).digest("hex").slice(0, 20)}`;
  }

  private async admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: urlFor(this.url), application_name: "gcs-plugins" });
    client.on("error", () => {});
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  /**
   * Creează (sau reactivează, cu o parolă nouă) rolul și schema pluginului. Fără drept de a crea roluri, instalarea unui
   * plugin cu `db` e refuzată (`db_role_unavailable`), în loc să ruleze cu o izolare mai slabă.
   */
  async provision(key: string, existing?: GcsPluginDbCredentials | null): Promise<GcsPluginDbCredentials> {
    const role = existing?.role ?? this.roleName(key);
    const password = randomBytes(24).toString("base64url");
    const schema = pluginSchema(key);
    try {
      await this.admin(async (c) => {
        const r = pg.escapeIdentifier(role);
        const exists = await c.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
        const options = `LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 6`;
        await c.query(exists.rowCount ? `ALTER ROLE ${r} WITH ${options}` : `CREATE ROLE ${r} WITH ${options}`);
        const database = pg.escapeIdentifier(decodeURIComponent(new URL(this.url).pathname.slice(1)));
        await c.query(`GRANT CONNECT ON DATABASE ${database} TO ${r}`);
        await c.query(`ALTER ROLE ${r} IN DATABASE ${database} SET search_path = ${pg.escapeIdentifier(schema)}`);
        await c.query(`ALTER ROLE ${r} IN DATABASE ${database} SET statement_timeout = '${QUERY_TIMEOUT}'`);
        await c.query(`ALTER ROLE ${r} IN DATABASE ${database} SET lock_timeout = '3s'`);
        await c.query(`ALTER ROLE ${r} IN DATABASE ${database} SET idle_in_transaction_session_timeout = '15s'`);
        await c.query(`CREATE SCHEMA IF NOT EXISTS ${pg.escapeIdentifier(schema)} AUTHORIZATION ${r}`);
        await c.query(`ALTER SCHEMA ${pg.escapeIdentifier(schema)} OWNER TO ${r}`);
      });
    } catch (error) {
      if (isPermissionError(error)) throw new GcsConflict({ reason: "db_role_unavailable" });
      throw error;
    }
    await this.closePool(key);
    return { role, password };
  }

  private pool(key: string, creds: GcsPluginDbCredentials): pg.Pool {
    const current = this.pools.get(key);
    if (current && current.password === creds.password) return current.pool;
    if (current) void current.pool.end().catch(() => {});
    const pool = new pg.Pool({
      connectionString: urlFor(this.url, creds),
      application_name: `gcs-plugin:${key}`.slice(0, 63),
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", () => {});
    this.pools.set(key, { pool, password: creds.password });
    return pool;
  }

  /**
   * Aplică migrațiile care lipsesc, într-o singură tranzacție, ca rolul pluginului. Evidența stă în
   * `<schema>._gcs_migrations`, în aceeași tranzacție. Întoarce toate migrațiile aplicate (vechi și noi).
   */
  async migrate(key: string, creds: GcsPluginDbCredentials, migrations: { name: string; sql: string }[]): Promise<string[]> {
    const schema = pluginSchema(key);
    for (const m of migrations) {
      const check = checkPluginSql(m.sql, { schema, mode: "migration" });
      if (!check.ok) throw new GcsValidationError({ migration: check.code }, { name: m.name, detail: check.detail });
    }
    const client = await this.pool(key, creds).connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL search_path TO ${pg.escapeIdentifier(schema)}`);
      await client.query(`SET LOCAL statement_timeout = '${MIGRATION_TIMEOUT}'`);
      await client.query(`CREATE TABLE IF NOT EXISTS _gcs_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
      const done = new Set((await client.query<{ name: string }>("SELECT name FROM _gcs_migrations")).rows.map((r) => r.name));
      for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
        if (done.has(m.name)) continue;
        try {
          await client.query(m.sql);
        } catch (error) {
          throw new GcsValidationError({ migration: "migration_failed" }, { name: m.name, detail: String((error as Error).message).slice(0, 200) });
        }
        await client.query("INSERT INTO _gcs_migrations (name) VALUES ($1)", [m.name]);
        done.add(m.name);
      }
      await client.query("COMMIT");
      return [...done].sort();
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** O interogare a pluginului (o singură instrucțiune DML, protocolul extins), cu cel mult 1000 de rânduri. */
  async query(key: string, creds: GcsPluginDbCredentials, sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const check = checkPluginSql(sql, { schema: pluginSchema(key), mode: "query" });
    if (!check.ok) throw new GcsValidationError({ sql: check.code }, { detail: check.detail });
    if (!Array.isArray(params) || params.length > 100) throw new GcsValidationError({ params: "invalid" });
    const result = await this.pool(key, creds).query({ text: sql, values: params, queryMode: "extended" } as pg.QueryConfig);
    return { rows: (result.rows ?? []).slice(0, PLUGIN_QUERY_MAX_ROWS).map(jsonRow), rowCount: result.rowCount ?? 0 };
  }

  /** Mai multe instrucțiuni într-o tranzacție (`ctx.db.batch`); întoarce rândurile afectate de fiecare. */
  async batch(key: string, creds: GcsPluginDbCredentials, statements: { sql: string; params?: unknown[] }[]): Promise<number[]> {
    if (!Array.isArray(statements) || statements.length === 0 || statements.length > 50) throw new GcsValidationError({ statements: "invalid" });
    const schema = pluginSchema(key);
    for (const s of statements) {
      const check = checkPluginSql(s.sql, { schema, mode: "query" });
      if (!check.ok) throw new GcsValidationError({ sql: check.code }, { detail: check.detail });
    }
    const client = await this.pool(key, creds).connect();
    try {
      await client.query("BEGIN");
      const counts: number[] = [];
      for (const s of statements) {
        const r = await client.query({ text: s.sql, values: s.params ?? [], queryMode: "extended" } as pg.QueryConfig);
        counts.push(r.rowCount ?? 0);
      }
      await client.query("COMMIT");
      return counts;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Mărimea schemei pluginului (octeți), pentru pagina lui din ACP. */
  async schemaSize(key: string): Promise<number | null> {
    try {
      return await this.admin(async (c) => {
        const r = await c.query<{ size: string | null }>(
          `SELECT sum(pg_total_relation_size(c.oid))::text AS size FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r','m')`,
          [pluginSchema(key)],
        );
        return r.rows[0]?.size ? Number(r.rows[0].size) : 0;
      });
    } catch {
      return null;
    }
  }

  async closePool(key: string): Promise<void> {
    const current = this.pools.get(key);
    this.pools.delete(key);
    await current?.pool.end().catch(() => {});
  }

  /** Șterge datele pluginului: conexiunile rolului, schema (cu tot conținutul) și rolul. */
  async drop(key: string, role: string | null): Promise<void> {
    await this.closePool(key);
    await this.admin(async (c) => {
      if (role) await c.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [role]).catch(() => {});
      await c.query(`DROP SCHEMA IF EXISTS ${pg.escapeIdentifier(pluginSchema(key))} CASCADE`);
      if (role) {
        const database = pg.escapeIdentifier(decodeURIComponent(new URL(this.url).pathname.slice(1)));
        await c.query(`REVOKE ALL ON DATABASE ${database} FROM ${pg.escapeIdentifier(role)}`).catch(() => {});
        await c.query(`DROP ROLE IF EXISTS ${pg.escapeIdentifier(role)}`);
      }
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.pools.keys()].map((k) => this.closePool(k)));
  }
}
