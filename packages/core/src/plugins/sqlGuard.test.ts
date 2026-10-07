import { describe, expect, test } from "vitest";
import { checkPluginSql } from "./sqlGuard";

const schema = "plugin_acme__demo";
const query = (sql: string) => checkPluginSql(sql, { schema, mode: "query" });
const migration = (sql: string) => checkPluginSql(sql, { schema, mode: "migration" });
const codeOf = (r: ReturnType<typeof query>) => (r.ok ? "ok" : r.code);

describe("SQL guard", () => {
  test("interogările obișnuite trec", () => {
    for (const sql of [
      "SELECT id, name FROM items WHERE id = $1",
      "select count(*)::int as n from greetings_log",
      "INSERT INTO items (name, note) VALUES ($1, 'it''s; fine -- not a comment') RETURNING id",
      "UPDATE items SET name = $1 WHERE id = $2",
      "DELETE FROM items WHERE created_at < now() - interval '30 days'",
      "WITH x AS (SELECT 1 AS a) SELECT a FROM x",
      `SELECT "Weird Name" FROM plugin_acme__demo.items i JOIN tags t ON t.item_id = i.id`,
      "SELECT 1; ",
      "SELECT $$text with ; inside$$",
      "SELECT E'escaped \\' quote'",
    ]) {
      expect([sql, codeOf(query(sql))]).toEqual([sql, "ok"]);
    }
  });

  test("migrațiile: DDL în schema proprie", () => {
    const sql = `
      -- tabelul principal
      CREATE TABLE greetings_log (id serial PRIMARY KEY, post_id int NOT NULL, created_at timestamptz DEFAULT now());
      CREATE INDEX greetings_log_post ON greetings_log (post_id);
      CREATE OR REPLACE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN NEW.created_at := now(); RETURN NEW; END;
      $fn$;
      ALTER TABLE greetings_log ADD COLUMN note text;
      COMMENT ON TABLE greetings_log IS 'jurnal';`;
    expect(migration(sql)).toEqual({ ok: true });
  });

  test("alte scheme sunt refuzate", () => {
    for (const sql of [
      "SELECT * FROM public.users",
      'SELECT * FROM "public"."users"',
      "SELECT * FROM pg_catalog.pg_authid",
      "SELECT * FROM information_schema.tables",
      "SELECT * FROM plugin_other__x.items",
      "SELECT * FROM pg_temp.t",
      "SELECT * FROM PUBLIC . users",
    ]) {
      expect([sql, codeOf(query(sql))]).toEqual([sql, "sql_schema"]);
    }
    expect(codeOf(migration("ALTER TABLE items SET SCHEMA public"))).not.toBe("ok");
  });

  test("schimbarea rolului, a setărilor și funcțiile de administrare", () => {
    for (const sql of [
      "SELECT set_config('role', 'postgres', false)",
      "SELECT pg_read_file('/etc/passwd')",
      "SELECT pg_advisory_lock(72707369)",
      "SELECT pg_terminate_backend(1)",
      "SELECT pg_sleep(100)",
      "SELECT lo_import('/etc/passwd')",
      "SELECT lo_create(0)",
      "SELECT lo_creat(-1)",
      "SELECT lowrite(lo_open(1, 131072), 'x')",
      "SELECT loread(0, 10)",
      "SELECT lo_truncate(0, 0)",
      "SELECT dblink_connect('host=x')",
      "SELECT pg_notify('gcs', 'x')",
    ]) {
      expect([sql, codeOf(query(sql))]).toEqual([sql, "sql_forbidden"]);
    }
  });

  test("instrucțiunile interzise", () => {
    for (const sql of ["SET ROLE postgres", "RESET ROLE", "COPY items TO PROGRAM 'id'", "DO $$ BEGIN END $$", "LISTEN gcs", "BEGIN", "COMMIT", "GRANT ALL ON items TO PUBLIC", "VACUUM", "EXPLAIN ANALYZE SELECT 1", "TRUNCATE items"]) {
      expect([sql, codeOf(query(sql))]).toEqual([sql, expect.stringMatching(/^sql_(statement|forbidden|schema)$/)]);
    }
    expect(codeOf(query("SELECT 1; DELETE FROM items"))).toBe("sql_multiple");
  });

  test("DDL periculos în migrații", () => {
    for (const sql of [
      "CREATE ROLE evil SUPERUSER",
      "CREATE SCHEMA other",
      "CREATE EXTENSION dblink",
      "DROP SCHEMA plugin_acme__demo CASCADE",
      "ALTER ROLE gcsp SUPERUSER",
      "ALTER SYSTEM SET x = 1",
      "CREATE DATABASE x",
      "DROP OWNED BY x",
      "CREATE FUNCTION f() RETURNS int SECURITY DEFINER LANGUAGE sql AS 'select 1'",
      "CREATE FUNCTION f() RETURNS int LANGUAGE c AS 'libc', 'system'",
      "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN SET ROLE postgres; END $$",
      "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(10); END $$",
      "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN DELETE FROM public.users; END $$",
    ]) {
      expect([sql, codeOf(migration(sql))]).toEqual([sql, expect.stringMatching(/^sql_/)]);
    }
  });

  test("un corp de funcție care nu poate fi citit e refuzat, nu sărit", () => {
    for (const sql of [
      "CREATE FUNCTION f() RETURNS bigint LANGUAGE sql AS $$ SELECT U&'x'; SELECT count(*) FROM public.users $$",
      "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN PERFORM 1 $ 2; PERFORM pg_sleep(9); END $body$",
      "CREATE PROCEDURE p() LANGUAGE sql AS $$ SELECT 'neterminat $$",
      "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT U&'x' $$ LANGUAGE sql",
    ]) {
      expect([sql, migration(sql)]).toEqual([sql, { ok: false, code: "sql_syntax", detail: "function_body" }]);
    }
    // Un șir `$$…$$` obișnuit (date, nu cod) rămâne permis chiar dacă nu e SQL valid.
    expect(query("SELECT $$costs $ 5$$")).toEqual({ ok: true });
    expect(migration("INSERT INTO items (name) VALUES ($$it's $ 5$$)")).toEqual({ ok: true });
  });

  test("sintaxa ambiguă e refuzată", () => {
    for (const sql of ["SELECT 'neterminat", 'SELECT "neterminat', "SELECT $tag$ fără sfârșit", "SELECT U&\"\\0070ublic\".x", "/* comentariu deschis SELECT 1", ""]) {
      expect([sql, codeOf(query(sql))]).toEqual([sql, expect.stringMatching(/^sql_(syntax|empty)$/)]);
    }
  });
});
