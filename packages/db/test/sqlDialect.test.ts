import { afterEach, describe, expect, test } from "vitest";
import { mysqlStatement, toMysql } from "../src/dialect";
import { sql } from "../src/sql";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const original = process.env.GCS_DB;

afterEach(() => {
  if (original === undefined) delete process.env.GCS_DB;
  else process.env.GCS_DB = original;
});

/** Traducerea mecanică a SQL-ului scris pentru PostgreSQL în MySQL (ediția Lite). */
describe("toMysql", () => {
  test("identificatori, conversii, now(), ILIKE, NULLS LAST", () => {
    expect(squash(toMysql(`SELECT "userId", count(*)::int AS n FROM posts WHERE "createdAt" >= now() AND title ILIKE 'a%' ORDER BY "lastPostAt" DESC NULLS LAST`))).toBe(
      "SELECT `userId`, CAST(count(*) AS SIGNED) AS n FROM posts WHERE `createdAt` >= UTC_TIMESTAMP(3) AND title LIKE 'a%' ORDER BY `lastPostAt` DESC",
    );
    expect(toMysql(`now() AT TIME ZONE 'UTC'`)).toBe("UTC_TIMESTAMP(3)");
  });

  test("upsert: ON CONFLICT DO UPDATE / DO NOTHING", () => {
    expect(squash(toMysql(`INSERT INTO read_markers ("userId", x) VALUES (1, 2) ON CONFLICT ("userId") DO UPDATE SET x = GREATEST(read_markers.x, EXCLUDED.x), "updatedAt" = EXCLUDED."updatedAt"`))).toBe(
      "INSERT INTO read_markers (`userId`, x) VALUES (1, 2) ON DUPLICATE KEY UPDATE x = GREATEST(read_markers.x, VALUES(x)), `updatedAt` = VALUES(`updatedAt`)",
    );
    expect(squash(toMysql(`INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO NOTHING`))).toBe("INSERT IGNORE INTO t (a) VALUES (1)");
  });

  test("agregatele cu FILTER, DISTINCT FROM, JSON, groups, date_trunc, epoch", () => {
    expect(squash(toMysql(`SELECT count(*) FILTER (WHERE secondary) AS s, count(DISTINCT u.id) FILTER (WHERE u.x > 1) AS d FROM groups g`))).toBe(
      "SELECT COUNT(CASE WHEN secondary THEN 1 END) AS s, COUNT(DISTINCT CASE WHEN u.x > 1 THEN u.id END) AS d FROM `groups` g",
    );
    expect(squash(toMysql(`WHERE a IS DISTINCT FROM b AND c IS NOT DISTINCT FROM d`))).toBe("WHERE NOT (a <=> b) AND (c <=> d)");
    expect(squash(toMysql(`SELECT COALESCE(u.privacy->>'profile', 'PUBLIC'), prefs->'skin'`))).toBe("SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(u.privacy, '$.profile')), 'PUBLIC'), JSON_EXTRACT(prefs, '$.skin')");
    expect(squash(toMysql(`SELECT date_trunc('day', "createdAt"), floor(extract(epoch from at) / 60)`))).toBe(
      "SELECT CAST(DATE_FORMAT(`createdAt`, '%Y-%m-%d 00:00:00') AS DATETIME), floor(TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', at) / 60)",
    );
  });

  test("DELETE cu alias, subinterogări pe același tabel și LIMIT în IN", () => {
    expect(squash(toMysql(`DELETE FROM follows s WHERE s."userId" = 1 AND EXISTS (SELECT 1 FROM follows t WHERE t.k = s.k)`))).toBe(
      "DELETE s FROM follows s WHERE s.`userId` = 1 AND EXISTS (SELECT 1 FROM (SELECT * FROM follows) t WHERE t.k = s.k)",
    );
    expect(squash(toMysql(`UPDATE posts SET x = 1 WHERE id IN (SELECT id FROM posts WHERE y = 2 LIMIT 10)`))).toBe(
      "UPDATE posts SET x = 1 WHERE id IN (SELECT * FROM (SELECT id FROM (SELECT * FROM posts) posts WHERE y = 2 LIMIT 10) AS gcs_sub0)",
    );
  });

  test("UPDATE … FROM devine UPDATE cu mai multe tabele; SET calificat cu aliasul țintei", () => {
    expect(squash(toMysql(`UPDATE conversation_participants t SET "leftAt" = NULL, x = GREATEST(t.x, s.x) FROM conversation_participants s WHERE t.a = 1 AND s.b = 2`))).toBe(
      "UPDATE conversation_participants t, conversation_participants s SET t.`leftAt` = NULL, t.x = GREATEST(t.x, s.x) WHERE t.a = 1 AND s.b = 2",
    );
    expect(squash(toMysql(`UPDATE status_updates s SET "repliesCount" = (SELECT COUNT(*)::int FROM status_updates r WHERE r."parentId" = s.id) WHERE s.id = 1`))).toBe(
      "UPDATE status_updates s SET `repliesCount` = (SELECT CAST(COUNT(*) AS SIGNED) FROM (SELECT * FROM status_updates) r WHERE r.`parentId` = s.id) WHERE s.id = 1",
    );
  });

  test("DISTINCT ON, to_char, coloanele rezervate în MySQL, șirurile rămân neatinse", () => {
    expect(squash(toMysql(`SELECT DISTINCT ON (s."profileUserId") s."profileUserId" AS "userId", s.x FROM status_updates s WHERE s.v = 1 ORDER BY s."profileUserId", s.id DESC`))).toBe(
      "SELECT * FROM (SELECT s.`profileUserId` AS `userId`, s.x, ROW_NUMBER() OVER (PARTITION BY s.`profileUserId` ORDER BY s.`profileUserId`, s.id DESC) AS gcs_rn FROM status_updates s WHERE s.v = 1) gcs_d WHERE gcs_rn = 1",
    );
    expect(toMysql(`to_char(x.at, 'YYYY-MM-DD"T"HH24:MI:SS.US')`)).toBe("DATE_FORMAT(x.at, '%Y-%m-%dT%H:%i:%s.%f')");
    expect(squash(toMysql(`SELECT key, value FROM settings WHERE key = 'a"b"' AND s.rank IS DISTINCT FROM r.rank`))).toBe(
      "SELECT `key`, value FROM settings WHERE `key` = 'a\"b\"' AND NOT (s.`rank` <=> r.`rank`)",
    );
  });

  test("lanțuri JSON, ::boolean pe JSON, jsonb_typeof, array_agg(…)[1], bool_or, DISTINCT FROM cu literal și fereastră", () => {
    expect(squash(toMysql(`WHERE m.meta -> 'system' ->> 'targetId' = 'x' AND COALESCE((u.privacy->>'showOnline')::boolean, true)`))).toBe(
      "WHERE JSON_UNQUOTE(JSON_EXTRACT(m.meta, '$.system.targetId')) = 'x' AND COALESCE(((JSON_UNQUOTE(JSON_EXTRACT(u.privacy, '$.showOnline'))) = 'true'), true)",
    );
    expect(squash(toMysql(`WHERE jsonb_typeof(data->'elo') = 'number'`))).toBe("WHERE JSON_TYPE(JSON_EXTRACT(data, '$.elo')) IN ('INTEGER', 'DOUBLE', 'DECIMAL', 'UNSIGNED INTEGER')");
    expect(squash(toMysql(`SELECT bool_or(online), (array_agg(map ORDER BY at DESC) FILTER (WHERE map IS NOT NULL))[1]`))).toBe(
      "SELECT MAX(online), SUBSTRING_INDEX(GROUP_CONCAT(map ORDER BY at DESC SEPARATOR '\u001f'), '\u001f', 1)",
    );
    expect(squash(toMysql(`WHERE p.k IS DISTINCT FROM 'STEAM' AND map IS DISTINCT FROM lag(map) OVER (ORDER BY at)`))).toBe(
      "WHERE NOT (p.k <=> 'STEAM') AND NOT (map <=> lag(map) OVER (ORDER BY at))",
    );
    expect(squash(toMysql(`INSERT INTO d ("userId", day) SELECT 2, day FROM d WHERE "userId" = 1 ON CONFLICT ("userId", day) DO UPDATE SET s = d.s + EXCLUDED.s`))).toBe(
      "INSERT INTO d (`userId`, day) SELECT * FROM (SELECT 2, day FROM d WHERE `userId` = 1) AS gcs_new ON DUPLICATE KEY UPDATE s = d.s + VALUES(s)",
    );
  });

  test("conversiile numerice rămân CAST (SUM/AVG sunt DECIMAL pe MySQL), și după FILTER / OVER", () => {
    expect(squash(toMysql(`SELECT COALESCE(SUM(s.kills), 0)::int AS k, round(avg(ping) FILTER (WHERE online))::int, x.n::bigint, sum(a)::float, ids::int[]`))).toBe(
      "SELECT CAST(COALESCE(SUM(s.kills), 0) AS SIGNED) AS k, CAST(round(AVG(CASE WHEN online THEN ping END)) AS SIGNED), CAST(x.n AS SIGNED), CAST(sum(a) AS DOUBLE), ids",
    );
    expect(squash(toMysql(`SELECT count(*) FILTER (WHERE a)::int AS n, row_number() OVER (ORDER BY id)::int`))).toBe(
      "SELECT CAST(COUNT(CASE WHEN a THEN 1 END) AS SIGNED) AS n, CAST(row_number() OVER (ORDER BY id) AS SIGNED)",
    );
  });

  test("mysqlStatement: $n (și refolosit) → ?, listele desfăcute, NOT IN gol", () => {
    expect(mysqlStatement(`UPDATE users SET "primaryGroupId" = (SELECT id FROM groups WHERE key = $2) WHERE email = $1 OR name = $2`, ["a@x", "vip"])).toEqual({
      sql: "UPDATE users SET `primaryGroupId` = (SELECT id FROM `groups` WHERE `key` = ?) WHERE email = ? OR name = ?",
      values: ["vip", "a@x", "vip"],
    });
    expect(mysqlStatement(`DELETE FROM gcs_kv WHERE key = ANY($1::text[]) AND x <> ALL($2)`, [["a", "b"], []])).toEqual({
      sql: "DELETE FROM gcs_kv WHERE `key` IN (?, ?) AND x NOT IN (SELECT NULL FROM DUAL WHERE 1 = 0)",
      values: ["a", "b"],
    });
  });

  test("sql: = ANY(listă) devine IN (…), momentele ISO devin DATETIME; pe PostgreSQL nimic nu se schimbă", () => {
    process.env.GCS_DB = "mysql";
    const q = sql`SELECT 1 FROM t WHERE id = ANY(${[1, 2, 3]}::int[]) AND at >= ${"2026-10-24T10:00:00.000Z"}::timestamp AND x = ANY(${[]})`;
    expect(squash(q.sql)).toBe("SELECT 1 FROM t WHERE id IN (?,?,?) AND at >= ? AND x IN (NULL)");
    expect(q.values).toEqual([1, 2, 3, "2026-10-24 10:00:00.000"]);
    delete process.env.GCS_DB;
    const pg = sql`SELECT 1 FROM t WHERE id = ANY(${[1, 2]}::int[])`;
    expect(pg.sql).toBe("SELECT 1 FROM t WHERE id = ANY(?::int[])");
  });
});
