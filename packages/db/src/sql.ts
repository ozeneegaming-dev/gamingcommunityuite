import { Prisma } from "@prisma/client";
import { gcsDbDialect } from "./json";
import { mysqlValue, translateMarked } from "./dialect";

/**
 * SQL scris o singură dată, în dialectul PostgreSQL, care merge și pe MySQL (ediția Lite). Pe PostgreSQL e exact
 * `Prisma.sql`; pe MySQL textul se traduce mecanic:
 * - identificatorii în ghilimele duble (`"userId"`) → backtick-uri;
 * - conversiile `::tip` dispar (MySQL convertește singur parametrii);
 * - `= ANY(${listă})` → `IN (…)` (o listă goală nu se potrivește cu nimic);
 * - `now()` / `now() AT TIME ZONE 'UTC'` → `UTC_TIMESTAMP(3)` (coloanele de timp sunt în UTC);
 * - `INSERT … ON CONFLICT (…) DO NOTHING` → `INSERT IGNORE …`;
 * - `ON CONFLICT (…) DO UPDATE SET x = EXCLUDED.x` → `ON DUPLICATE KEY UPDATE x = VALUES(x)`;
 * - `ILIKE` → `LIKE` (colația MySQL ignoră deja majusculele), `NULLS FIRST/LAST` dispare.
 * Ce nu se poate traduce (`RETURNING`, `DISTINCT ON`, `date_trunc`, `FILTER`, `jsonb`, `unnest`…) se scrie pe ramuri,
 * cu `isMysql()`. Fragmentele încorporate se construiesc tot cu `sql`.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Prisma.Sql {
  if (!isMysql()) return Prisma.sql(strings, ...values);
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `\u0000${i}\u0000` : ""), "");
  const { parts, slots } = translateMarked(text);
  const vals = slots.map((slot) => {
    const v = values[slot.index];
    if (slot.kind === "value") return mysqlValue(v);
    const list = Array.isArray(v) ? (v as unknown[]) : [v];
    if (slot.kind === "in") return sqlIn(list);
    return list.length > 0 ? Prisma.join(list) : Prisma.sql`SELECT NULL FROM DUAL WHERE 1 = 0`;
  });
  return Prisma.sql(Object.assign([...parts], { raw: parts }) as unknown as TemplateStringsArray, ...vals);
}

/** Un identificator construit la rulare (nume de coloană din cod, nu de la utilizator), citat pe dialect. */
export function sqlIdent(name: string): Prisma.Sql {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Identificator SQL invalid: ${name}`);
  return Prisma.raw(isMysql() ? `\`${name}\`` : `"${name}"`);
}

export function isMysql(): boolean {
  return gcsDbDialect() === "mysql";
}

/** O listă de valori pentru `IN (…)`; o listă goală devine `NULL` (nu se potrivește nimic, pe ambele baze). */
export function sqlIn(values: readonly unknown[]): Prisma.Sql {
  return values.length === 0 ? Prisma.sql`NULL` : Prisma.join(values as unknown[]);
}

/**
 * Un moment pentru coloanele `timestamp` / `DATETIME` (UTC, fără fus): pe PostgreSQL ca text `::timestamp` (fusul
 * sesiunii nu contează), pe MySQL ca valoare `DATETIME`.
 */
export function sqlTs(at: Date): Prisma.Sql {
  const iso = at.toISOString();
  return isMysql() ? Prisma.sql`${iso.slice(0, 23).replace("T", " ")}` : Prisma.sql`${iso.slice(0, -1)}::timestamp`;
}

export { Prisma };

/**
 * `col || {…}` pentru coloanele JSON (cheile de sus din `patch` se scriu peste cele existente): PostgreSQL `jsonb ||`,
 * MySQL `JSON_MERGE_PATCH` (fără valori `null` în patch: acolo ar șterge cheia).
 */
export function sqlJsonMerge(column: string, patch: Record<string, unknown>): Prisma.Sql {
  const json = JSON.stringify(patch);
  return isMysql() ? Prisma.sql`JSON_MERGE_PATCH(${sqlIdent(column)}, CAST(${json} AS JSON))` : Prisma.sql`${sqlIdent(column)} || ${json}::jsonb`;
}
