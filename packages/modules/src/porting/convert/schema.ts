/**
 * Schema sursei (tabele MySQL descrise în JSON sau în codul de instalare) → migrația PostgreSQL a pluginului
 * (`migrations/001_init.sql`), în schema proprie a pluginului. Fiecare tabel trece separat prin SQL guard; un tabel
 * respins sau fără coloane recunoscute rămâne pentru portarea manuală.
 */
import { checkPluginSql, pluginSchema } from "@gcs/core";
import { commentText } from "../text";
import type { GcsPortColumn, GcsPortNote, GcsPortTable } from "../types";

/** Cuvintele rezervate PostgreSQL care nu pot fi nume de tabel sau coloană fără ghilimele. */
const RESERVED = new Set(
  (
    "all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation column concurrently " +
    "constraint create cross current_catalog current_date current_role current_schema current_time current_timestamp current_user default " +
    "deferrable desc distinct do else end except false fetch for foreign freeze from full grant group having ilike in initially inner " +
    "intersect into is isnull join lateral leading left like limit localtime localtimestamp natural not notnull null offset on only or " +
    "order outer overlaps placing primary references returning right select session_user similar some symmetric system_user table " +
    "tablesample then to trailing true union unique user using variadic verbose when where window with"
  ).split(" "),
);

/** Un identificator PostgreSQL: litere mici, `[a-z_][a-z0-9_]*`, ≤ 63 de caractere, între ghilimele dacă e rezervat. */
export function sqlIdent(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+(?=.)/, "")
    .slice(0, 63);
  if (!/^[a-z_]/.test(s)) s = `c_${s}`.slice(0, 63);
  return RESERVED.has(s) ? `"${s}"` : s;
}

const quote = (s: string) => `'${s.replace(/[\u0000-\u001f]/g, " ").replace(/'/g, "''")}'`;
const INT = new Set(["tinyint", "smallint", "mediumint", "int", "integer", "bigint", "bit", "bool", "boolean", "year"]);
const NUMERIC = new Set([...INT, "float", "double", "real", "decimal", "numeric"]);
const TEXTUAL = new Set(["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"]);

/** Tipul PostgreSQL al unei coloane (fără `NOT NULL` / `DEFAULT`). */
export function columnType(c: GcsPortColumn): { type: string; known: boolean } {
  const t = c.type.toLowerCase().replace(/\(.*$/, "").trim();
  if (c.autoIncrement && INT.has(t)) return { type: t === "bigint" ? "bigserial" : "serial", known: true };
  switch (t) {
    case "tinyint":
    case "bit":
    case "bool":
    case "boolean":
    case "year":
      return { type: "smallint", known: true };
    case "smallint":
      return { type: c.unsigned ? "integer" : "smallint", known: true };
    case "mediumint":
    case "int":
    case "integer":
      return { type: "integer", known: true };
    case "bigint":
      return { type: "bigint", known: true };
    case "float":
      return { type: "real", known: true };
    case "double":
    case "real":
      return { type: "double precision", known: true };
    case "decimal":
    case "numeric": {
      const p = Math.min(Math.max(c.length ?? 10, 1), 1000);
      const s = Math.min(Math.max(c.decimals ?? 0, 0), p);
      return { type: `numeric(${p}, ${s})`, known: true };
    }
    case "char":
    case "varchar":
      return { type: c.length && c.length > 0 && c.length <= 10_485_760 ? `varchar(${c.length})` : "text", known: true };
    case "tinytext":
    case "text":
    case "mediumtext":
    case "longtext":
    case "enum":
    case "set":
      return { type: "text", known: true };
    case "binary":
    case "varbinary":
    case "tinyblob":
    case "blob":
    case "mediumblob":
    case "longblob":
      return { type: "bytea", known: true };
    case "date":
      return { type: "date", known: true };
    case "datetime":
      return { type: "timestamp", known: true };
    case "timestamp":
      return { type: "timestamptz", known: true };
    case "time":
      return { type: "time", known: true };
    case "json":
      return { type: "jsonb", known: true };
    default:
      return { type: "text", known: false };
  }
}

/** Valoarea implicită, dacă se poate traduce (altfel lipsește: codul portat o completează). */
function columnDefault(c: GcsPortColumn, pgType: string): string | null {
  if (c.default === undefined || c.autoIncrement) return null;
  if (c.default === null) return c.nullable ? "NULL" : null;
  const t = c.type.toLowerCase();
  const v = String(c.default);
  if (NUMERIC.has(t)) return /^-?\d+(?:\.\d+)?$/.test(v.trim()) ? v.trim() : null;
  if (/^(?:date|datetime|timestamp|time)$/.test(t)) {
    if (/^current_timestamp(?:\(\))?$|^now\(\)$/i.test(v.trim())) return t === "date" ? "CURRENT_DATE" : "now()";
    return /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(v) && !v.startsWith("0000") ? quote(v) : null;
  }
  if (TEXTUAL.has(t) || pgType.startsWith("varchar") || pgType === "text") {
    if (t === "enum" && c.values && !c.values.includes(v)) return null;
    return quote(v.slice(0, 1000));
  }
  return null;
}

export type GcsSchemaResult = { sql: string | null; tables: string[]; skipped: string[]; notes: GcsPortNote[] };

/** Instrucțiunile SQL ale unui tabel (CREATE TABLE + indexurile). */
function tableSql(table: GcsPortTable, notes: GcsPortNote[]): string | null {
  const name = sqlIdent(table.name);
  const seen = new Set<string>();
  const lines: string[] = [];
  const columnNames = new Map<string, string>();
  for (const c of table.columns.slice(0, 200)) {
    const ident = sqlIdent(c.name);
    if (seen.has(ident)) continue;
    seen.add(ident);
    columnNames.set(c.name.toLowerCase(), ident);
    const { type, known } = columnType(c);
    if (!known) notes.push({ code: "column_type_unknown", params: { table: table.name, column: c.name, type: c.type } });
    const parts = [ident, type];
    if (!c.nullable && !type.endsWith("serial")) parts.push("NOT NULL");
    const def = columnDefault(c, type);
    if (def !== null) parts.push(`DEFAULT ${def}`);
    if (c.type.toLowerCase() === "enum" && c.values?.length) parts.push(`CHECK (${ident} IN (${c.values.map(quote).join(", ")}))`);
    lines.push(`  ${parts.join(" ")}`);
  }
  if (lines.length === 0) return null;
  const cols = (list: string[]) => {
    const mapped = list.map((x) => columnNames.get(x.toLowerCase()));
    return mapped.every(Boolean) ? (mapped as string[]) : null;
  };
  const primary = table.indexes.find((i) => i.kind === "primary");
  const pk = primary ? cols(primary.columns) : null;
  if (pk) lines.push(`  PRIMARY KEY (${pk.join(", ")})`);
  const statements = [`CREATE TABLE ${name} (\n${lines.join(",\n")}\n);`];
  const indexNames = new Set<string>();
  for (const idx of table.indexes) {
    if (idx.kind === "primary") continue;
    if (idx.kind === "fulltext") {
      notes.push({ code: "fulltext_index", params: { table: table.name, index: idx.name } });
      continue;
    }
    const list = cols(idx.columns);
    if (!list) continue;
    let iname = sqlIdent(`${table.name}_${idx.name}`.slice(0, 60)).replace(/"/g, "");
    for (let n = 2; indexNames.has(iname); n++) iname = `${iname.slice(0, 58)}_${n}`;
    indexNames.add(iname);
    statements.push(`CREATE ${idx.kind === "unique" ? "UNIQUE " : ""}INDEX ${iname} ON ${name} (${list.join(", ")});`);
  }
  return statements.join("\n");
}

/** Migrația inițială a pluginului, din tabelele sursei. `null` dacă nu rămâne niciun tabel. */
export function convertSchema(tables: GcsPortTable[], pluginKey: string): GcsSchemaResult {
  const notes: GcsPortNote[] = [];
  const parts: string[] = [];
  const done: string[] = [];
  const skipped: string[] = [];
  const schema = pluginSchema(pluginKey);
  const names = new Set<string>();
  for (const table of tables.slice(0, 100)) {
    const ident = sqlIdent(table.name);
    if (names.has(ident)) {
      skipped.push(table.name);
      continue;
    }
    const sql = tableSql(table, notes);
    if (!sql) {
      skipped.push(table.name);
      continue;
    }
    const check = checkPluginSql(sql, { schema, mode: "migration" });
    if (!check.ok) {
      notes.push({ code: "table_rejected", params: { table: table.name, issue: check.code } });
      skipped.push(table.name);
      continue;
    }
    names.add(ident);
    done.push(table.name);
    parts.push(`-- ${commentText(`Din ${table.origin}: ${table.name}`)}\n${sql}`);
  }
  if (parts.length === 0) return { sql: null, tables: done, skipped, notes };
  const header = "-- Generat de asistentul de portare GCS din schema sursei (tipurile MySQL traduse în PostgreSQL).\n-- Verifică tipurile, valorile implicite și indexurile înainte de instalare.\n";
  return { sql: `${header}\n${parts.join("\n\n")}\n`, tables: done, skipped, notes };
}
