/**
 * Verificarea statică a SQL-ului unui plugin (migrații și interogări). E **apărare în adâncime**: granița reală e rolul
 * PostgreSQL dedicat al pluginului, fără drepturi pe tabelele nucleului (vezi `database.ts`). Aici respingem din timp
 * ce nu are ce căuta în SQL-ul unui plugin, cu un mesaj clar:
 * - referințe la alte scheme (`public`, `pg_*`, `information_schema`, `plugin_*` străine);
 * - schimbarea rolului sau a setărilor sesiunii (`SET`, `RESET`, `set_config`, `SET ROLE`, `SESSION AUTHORIZATION`);
 * - `COPY`, `DO`, `LOAD`, `LISTEN`/`NOTIFY`, `GRANT`/`REVOKE`, controlul tranzacțiilor;
 * - DDL pe roluri, baze, scheme, extensii, limbaje, servere străine; `SECURITY DEFINER`; limbaje neprotejate;
 * - funcțiile de administrare (fișiere, procese, lock-uri advisory, obiecte mari, `dblink`);
 * - în interogări: o singură instrucțiune, doar `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`WITH`/`VALUES`.
 *
 * Limita cunoscută: SQL-ul construit dinamic în șiruri (ex. `EXECUTE '…'` în PL/pgSQL) nu se vede aici; rolul dedicat
 * îl oprește oricum la granița schemei proprii.
 */

type Token =
  | { t: "word"; v: string }
  | { t: "qident"; v: string }
  | { t: "string" }
  | { t: "dollar"; body: string }
  | { t: "num" }
  | { t: "param" }
  | { t: "punct"; v: string }
  | { t: "semi" };

export type GcsSqlCheck = { ok: true } | { ok: false; code: string; detail: string };

class SqlSyntaxError extends Error {}

const WORD_START = /[A-Za-z_\u0080-￿]/;
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/;

function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth > 0) throw new SqlSyntaxError("unterminated_comment");
      continue;
    }
    if (c === "'") {
      // E'…' acceptă `\'` ca escape; restul doar `''`.
      const prev = out[out.length - 1];
      const escapes = prev?.t === "word" && prev.v === "e" && sql[i - 1]?.toLowerCase() === "e";
      if (escapes) out.pop();
      i++;
      for (;;) {
        if (i >= n) throw new SqlSyntaxError("unterminated_string");
        if (escapes && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out.push({ t: "string" });
      continue;
    }
    if (c === '"') {
      let v = "";
      i++;
      for (;;) {
        if (i >= n) throw new SqlSyntaxError("unterminated_identifier");
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += sql[i];
        i++;
      }
      // Un identificator gol sau U&"…" nu are ce căuta într-un plugin.
      if (v.length === 0) throw new SqlSyntaxError("empty_identifier");
      out.push({ t: "qident", v });
      continue;
    }
    if (c === "$") {
      const m = /^\$(\d+)/.exec(sql.slice(i, i + 12));
      if (m) {
        out.push({ t: "param" });
        i += m[0].length;
        continue;
      }
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (!tag) throw new SqlSyntaxError("unexpected_dollar");
      const end = sql.indexOf(tag[0], i + tag[0].length);
      if (end === -1) throw new SqlSyntaxError("unterminated_dollar");
      out.push({ t: "dollar", body: sql.slice(i + tag[0].length, end) });
      i = end + tag[0].length;
      continue;
    }
    if (WORD_START.test(c)) {
      let j = i + 1;
      while (j < n && WORD_PART.test(sql[j]!)) j++;
      const word = sql.slice(i, j).toLowerCase();
      // U&'…' / U&"…": escape-uri unicode în identificatori și șiruri (ar ascunde nume).
      if (word === "u" && sql[j] === "&") throw new SqlSyntaxError("unicode_escape");
      out.push({ t: "word", v: word });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9.eE_]/.test(sql[j]!)) {
        if ((sql[j] === "e" || sql[j] === "E") && (sql[j + 1] === "+" || sql[j + 1] === "-")) j++;
        j++;
      }
      out.push({ t: "num" });
      i = j;
      continue;
    }
    if (c === ";") {
      out.push({ t: "semi" });
      i++;
      continue;
    }
    out.push({ t: "punct", v: c });
    i++;
  }
  return out;
}

/** Schemele străine: orice calificativ cu aceste nume (sau `pg_*`, `plugin_*` străin) e respins. */
const FOREIGN_SCHEMAS = new Set(["public", "information_schema"]);

/** Funcții și cuvinte interzise oriunde (în afara șirurilor). */
const FORBIDDEN_WORDS = new Set([
  "set_config",
  "copy",
  "listen",
  "notify",
  "unlisten",
  "pg_notify",
  "load",
  "grant",
  "revoke",
  "reset",
  "session_authorization",
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_ls_logdir",
  "pg_ls_waldir",
  "pg_ls_tmpdir",
  "pg_ls_archive_statusdir",
  "pg_stat_file",
  "pg_file_write",
  "pg_terminate_backend",
  "pg_cancel_backend",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "pg_promote",
  "pg_switch_wal",
  "pg_create_restore_point",
  "pg_sleep",
  "pg_sleep_for",
  "pg_sleep_until",
  "lo_import",
  "lo_export",
  "lo_unlink",
  "lo_from_bytea",
  "lo_put",
  "lo_open",
]);
const FORBIDDEN_PREFIXES = ["pg_advisory", "pg_try_advisory", "dblink", "pg_logical", "pg_replication", "pg_import_system"];

const QUERY_STARTS = new Set(["select", "insert", "update", "delete", "with", "values"]);
const MIGRATION_STARTS = new Set([...QUERY_STARTS, "create", "alter", "drop", "comment", "truncate"]);
/** Ce se poate crea / modifica / șterge într-o migrație (în schema proprie). */
const DDL_OBJECTS = new Set(["table", "index", "view", "sequence", "function", "procedure", "trigger", "type", "domain", "materialized", "aggregate", "policy", "statistics", "rule"]);
/** Cuvintele dintre `CREATE` și tipul obiectului. */
const CREATE_MODIFIERS = new Set(["or", "replace", "unique", "unlogged", "temp", "temporary", "recursive", "constraint", "global", "local"]);
const SAFE_LANGUAGES = new Set(["sql", "plpgsql"]);

const fail = (code: string, detail: string): GcsSqlCheck => ({ ok: false, code, detail: detail.slice(0, 80) });

function name(tok: Token | undefined): string | null {
  if (!tok) return null;
  if (tok.t === "word") return tok.v;
  if (tok.t === "qident") return tok.v.toLowerCase();
  return null;
}

/** Verificările valabile peste tot (inclusiv în corpurile de funcții): cuvinte interzise, scheme străine, `SET ROLE`… */
function checkTokens(tokens: Token[], schema: string): GcsSqlCheck {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const word = name(tok);
    if (word !== null) {
      if (FORBIDDEN_WORDS.has(word) || FORBIDDEN_PREFIXES.some((p) => word.startsWith(p))) return fail("sql_forbidden", word);
      const next = name(tokens[i + 1]);
      if (word === "set" && (next === "role" || next === "session" || next === "local" || next === "schema")) return fail("sql_forbidden", `set ${next}`);
      // `public` nu apare nici necalificat (ex. `SET SCHEMA public`, `search_path = public`).
      if (word === "public" || word === "information_schema" || word === "pg_catalog") return fail("sql_schema", word);
      if (word === "security" && next === "definer") return fail("sql_forbidden", "security definer");
      if (word === "language" && next !== null && !SAFE_LANGUAGES.has(next)) return fail("sql_language", next);
      if (word === "alter" && next === "system") return fail("sql_forbidden", "alter system");
      // `x.y`: calificativul nu poate fi o altă schemă.
      const dot = tokens[i + 1];
      if (dot?.t === "punct" && dot.v === ".") {
        const qualifier = word;
        const foreign = FOREIGN_SCHEMAS.has(qualifier) || qualifier.startsWith("pg_") || (qualifier.startsWith("plugin_") && qualifier !== schema);
        if (foreign) return fail("sql_schema", qualifier);
      }
    }
    if (tok.t === "dollar") {
      // Corpurile de funcții (și orice șir `$$…$$`) se verifică la fel.
      let inner: Token[];
      try {
        inner = tokenize(tok.body);
      } catch {
        continue;
      }
      const bodyCheck = checkTokens(inner, schema);
      if (!bodyCheck.ok) return bodyCheck;
      for (const stmt of statements(inner)) {
        const start = name(stmt[0]);
        if (start && ["set", "copy", "do", "grant", "revoke", "load", "listen", "notify", "reset"].includes(start)) {
          return fail("sql_forbidden", start);
        }
      }
    }
  }
  return { ok: true };
}

function statements(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  let current: Token[] = [];
  for (const tok of tokens) {
    if (tok.t === "semi") {
      if (current.length > 0) out.push(current);
      current = [];
    } else current.push(tok);
  }
  if (current.length > 0) out.push(current);
  return out;
}

function checkDdl(stmt: Token[]): GcsSqlCheck {
  const verb = name(stmt[0])!;
  if (verb !== "create" && verb !== "alter" && verb !== "drop") return { ok: true };
  let i = 1;
  if (verb === "create") while (CREATE_MODIFIERS.has(name(stmt[i]) ?? "")) i++;
  const object = name(stmt[i]);
  if (!object || !DDL_OBJECTS.has(object)) return fail("sql_ddl", `${verb} ${object ?? ""}`);
  return { ok: true };
}

/**
 * Verifică SQL-ul unui plugin. `mode: "query"` = o interogare din `ctx.db` (o singură instrucțiune DML);
 * `mode: "migration"` = un fișier din `migrations/` (mai multe instrucțiuni, DDL în schema proprie).
 */
export function checkPluginSql(sql: string, opts: { schema: string; mode: "query" | "migration" }): GcsSqlCheck {
  const max = opts.mode === "query" ? 20_000 : 200_000;
  if (typeof sql !== "string" || sql.trim() === "") return fail("sql_empty", "");
  if (sql.length > max) return fail("sql_too_long", String(max));
  if (sql.includes("\0")) return fail("sql_syntax", "nul");
  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch (error) {
    return fail("sql_syntax", error instanceof Error ? error.message : "syntax");
  }
  const list = statements(tokens);
  if (list.length === 0) return fail("sql_empty", "");
  if (opts.mode === "query" && list.length > 1) return fail("sql_multiple", String(list.length));

  const starts = opts.mode === "query" ? QUERY_STARTS : MIGRATION_STARTS;
  for (const stmt of list) {
    const start = name(stmt[0]);
    if (!start || stmt[0]!.t !== "word" || !starts.has(start)) return fail("sql_statement", start ?? "?");
    const ddl = checkDdl(stmt);
    if (!ddl.ok) return ddl;
  }
  return checkTokens(tokens, opts.schema);
}
