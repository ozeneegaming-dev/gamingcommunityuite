/**
 * Traducerea mecanică a textului SQL scris pentru PostgreSQL în MySQL (ediția Lite), fără dependențe: o folosesc
 * tag-ul `sql` din `@gcs/db` și helper-ul SQL al testelor E2E (care nu pot importa pachetele aplicației).
 */

/** Un loc de parametru din textul tradus: o valoare, o listă pentru `IN (…)` sau una pentru `NOT IN (…)`. */
export type GcsSqlSlot = { index: number; kind: "value" | "in" | "not_in" };

/**
 * Textul PostgreSQL cu parametrii marcați (`\u0000<index>\u0000`) → bucățile de text MySQL dintre parametri și locurile
 * lor, în ordine: `= ANY(listă)` devine `IN (…)`, `<> ALL(listă)` devine `NOT IN (…)`, restul trece prin `toMysql`.
 */
export function translateMarked(text: string): { parts: string[]; slots: GcsSqlSlot[] } {
  const mark = (i: number) => `\u0000${i}\u0000`;
  const kinds = new Map<number, GcsSqlSlot["kind"]>();
  const list = (op: RegExp, kind: GcsSqlSlot["kind"], sql: string) => (t: string) =>
    t.replace(op, (_m, n: string) => {
      kinds.set(Number(n), kind);
      return `${sql} (${mark(Number(n))})`;
    });
  let out = list(/=\s*ANY\s*\(\s*\u0000(\d+)\u0000(\s*::[a-z_]+(?:\[\])?)?\s*\)/gi, "in", "IN")(text);
  out = list(/<>\s*ALL\s*\(\s*\u0000(\d+)\u0000(\s*::[a-z_]+(?:\[\])?)?\s*\)/gi, "not_in", "NOT IN")(out);
  out = toMysql(out);
  const parts = out.split(/\u0000\d+\u0000/);
  const slots = [...out.matchAll(/\u0000(\d+)\u0000/g)].map((m) => ({ index: Number(m[1]), kind: kinds.get(Number(m[1])) ?? ("value" as const) }));
  return { parts, slots };
}

/** Momentele trimise ca text ISO (`…T…Z`, pentru `::timestamp` în PostgreSQL) devin `YYYY-MM-DD HH:MM:SS.mmm` (UTC). */
export function mysqlValue(v: unknown): unknown {
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?$/.test(v)) return v.replace("T", " ").replace(/Z$/, "").slice(0, 23);
  return v;
}

/**
 * O interogare cu parametri PostgreSQL (`$1`, `$2`…, refolosibili) → textul MySQL cu `?` și valorile în ordine (listele
 * desfăcute pentru `IN`). Pentru clienții fără Prisma (testele E2E, cu `mysql2`).
 */
export function mysqlStatement(text: string, params: readonly unknown[]): { sql: string; values: unknown[] } {
  const { parts, slots } = translateMarked(text.replace(/\$(\d+)\b/g, (_m, n: string) => `\u0000${Number(n) - 1}\u0000`));
  let sql = parts[0] ?? "";
  const values: unknown[] = [];
  slots.forEach((slot, i) => {
    const v = params[slot.index];
    if (slot.kind === "value") {
      sql += "?";
      values.push(mysqlValue(v));
    } else {
      const items = Array.isArray(v) ? (v as unknown[]) : [v];
      if (items.length === 0) sql += slot.kind === "in" ? "NULL" : "SELECT NULL FROM DUAL WHERE 1 = 0";
      else {
        sql += items.map(() => "?").join(", ");
        values.push(...items.map(mysqlValue));
      }
    }
    sql += parts[i + 1] ?? "";
  });
  return { sql, values };
}

/**
 * `expr::int` / `::bigint` / `::float` → `CAST(expr AS SIGNED|DOUBLE)`: pe MySQL `SUM`/`AVG` întorc DECIMAL (text în
 * rezultat), deci conversia spre număr trebuie păstrată, nu doar ștearsă. Operandul e un apel / o paranteză sau un
 * identificator (inclusiv un parametru).
 */
function numericCasts(text: string): string {
  const re = /::(int|integer|bigint|smallint|float8?|real|double\s+precision)\b(?!\s*\[)/gi;
  let out = text;
  for (let m = re.exec(out); m; m = re.exec(out)) {
    const end = m.index;
    let start = end;
    if (out[end - 1] === ")") {
      // Un apel (`f(…)`), eventual urmat de `FILTER (…)` / `OVER (…)`: se merge înapoi până la începutul apelului.
      for (;;) {
        let depth = 0;
        for (start = start - 1; start >= 0; start--) {
          if (out[start] === ")") depth++;
          else if (out[start] === "(" && --depth === 0) break;
        }
        if (start < 0) break;
        while (start > 0 && /\w/.test(out[start - 1]!)) start--;
        const before = /\)\s*(?:FILTER|OVER)\s*$/i.exec(out.slice(0, start));
        if (!before) break;
        start = before.index + 1;
      }
      if (start < 0) {
        re.lastIndex = end + m[0].length;
        continue;
      }
    } else {
      while (start > 0 && /[\w."\u0000]/.test(out[start - 1]!)) start--;
    }
    if (start === end) continue;
    const type = /^(int|integer|bigint|smallint)$/i.test(m[1]!) ? "SIGNED" : "DOUBLE";
    const cast = `CAST(${out.slice(start, end)} AS ${type})`;
    out = out.slice(0, start) + cast + out.slice(end + m[0].length);
    re.lastIndex = start + cast.length;
  }
  return out;
}

/** Operandul lui `IS [NOT] DISTINCT FROM`: parametru, literal, coloană sau apel simplu (opțional cu `OVER (…)`). */
const OPERAND = String.raw`\u0000\d+\u0000|'[^']*'|[A-Za-z_]\w*\([^()]*\)(?:\s+OVER\s*\([^()]*\))?|[A-Za-z_][\w."]*`;

/** Traducerea textului (fără valori) din dialectul PostgreSQL în MySQL. */
export function toMysql(text: string): string {
  let out = numericCasts(text)
    // `(x->>'k')::boolean` → comparația cu textul `true` (înainte ca `::boolean` să dispară).
    .replace(/\(([^()]*->>\s*'[^']+')\)::boolean/gi, "(($1) = 'true')")
    .replace(/jsonb_typeof\(([^()]+)\)\s*=\s*'number'/gi, "JSON_TYPE($1) IN ('INTEGER', 'DOUBLE', 'DECIMAL', 'UNSIGNED INTEGER')")
    // `(array_agg(x ORDER BY y) [FILTER (WHERE … IS NOT NULL)])[1]` → primul element din GROUP_CONCAT (care sare NULL).
    .replace(
      /\(\s*array_agg\(([^()]*?)\s+ORDER\s+BY\s+([^()]*?)\)(?:\s*FILTER\s*\(\s*WHERE\s+[^()]*?\s+IS\s+NOT\s+NULL\s*\))?\s*\)\s*\[1\]/gi,
      "SUBSTRING_INDEX(GROUP_CONCAT($1 ORDER BY $2 SEPARATOR '\u001f'), '\u001f', 1)",
    )
    .replace(/\bbool_or\(/gi, "MAX(")
    // `jsonb_set(x, '{a,b}', to_jsonb(v))` → `JSON_SET(x, '$.a.b', v)`; și cu altă valoare JSON (ex. o subinterogare).
    .replace(/jsonb_set\(\s*([^,()]+),\s*'\{([^}']+)\}',\s*to_jsonb\(([^()]+)\)\s*\)/gi, (_m, x: string, p: string, v: string) => `JSON_SET(${x}, '$.${p.split(",").map((s) => s.trim()).join(".")}', ${v})`)
    .replace(/jsonb_set\(\s*([^,()]+),\s*'\{([^}']+)\}',/gi, (_m, x: string, p: string) => `JSON_SET(${x}, '$.${p.split(",").map((s) => s.trim()).join(".")}',`)
    .replace(/\bjsonb?_build_object\(/gi, "JSON_OBJECT(")
    // `json - 'cheie'` (scoaterea unei chei) → `JSON_REMOVE(json, '$.cheie')`.
    .replace(/("?[A-Za-z_]\w*"?)\s+-\s+'([A-Za-z_]\w*)'/g, "JSON_REMOVE($1, '$.$2')")
    // `interval '5 minutes'` → `INTERVAL 5 MINUTE`.
    .replace(/\binterval\s+'(\d+)\s+(second|minute|hour|day|week|month|year)s?'/gi, (_m, n: string, unit: string) => `INTERVAL ${n} ${unit.toUpperCase()}`)
    .replace(/to_char\(([^()]+?),\s*'YYYY-MM-DD"T"HH24:MI:SS\.US'\)/gi, "DATE_FORMAT($1, '%Y-%m-%dT%H:%i:%s.%f')")
    .replace(/to_char\(([^()]+?),\s*'YYYY-MM-DD'\)/gi, "DATE_FORMAT($1, '%Y-%m-%d')")
    .replace(/timezone\(\s*'UTC'\s*,\s*now\(\)\s*\)/gi, "UTC_TIMESTAMP(3)")
    .replace(/now\(\)\s+AT\s+TIME\s+ZONE\s+'UTC'/gi, "UTC_TIMESTAMP(3)")
    .replace(/\bnow\(\)/gi, "UTC_TIMESTAMP(3)")
    .replace(/::(?:"[A-Za-z_]\w*"|[a-z_]\w*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)(?:\[\])?/gi, "")
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(/\s+NULLS\s+(?:FIRST|LAST)\b/gi, "");
  if (/ON\s+CONFLICT\s*(?:\([^)]*\))?\s*DO\s+NOTHING/i.test(out)) {
    out = out.replace(/ON\s+CONFLICT\s*(?:\([^)]*\))?\s*DO\s+NOTHING/gi, "").replace(/\bINSERT\s+INTO\b/i, "INSERT IGNORE INTO");
  }
  out = out
    .replace(/ON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET/gi, "ON DUPLICATE KEY UPDATE")
    .replace(/\bEXCLUDED\.("?)([A-Za-z_]\w*)\1/g, "VALUES($1$2$1)")
    .replace(/\bEXCLUDED\.(\u0000\d+\u0000)/g, "VALUES($1)")
    // JSON: `x->'a'->>'b'` (text) și `x->'a'` (JSON), cu lanțuri.
    .replace(/((?:\u0000\d+\u0000|"?[A-Za-z_]\w*"?)(?:\.(?:"[A-Za-z_]\w*"|[A-Za-z_]\w*))?)((?:\s*->>?\s*'[^']+')+)/g, (_m, base: string, chain: string) => {
      const steps = [...chain.matchAll(/->(>?)\s*'([^']+)'/g)];
      const path = `'$.${steps.map((s) => s[2]).join(".")}'`;
      return steps[steps.length - 1]![1] ? `JSON_UNQUOTE(JSON_EXTRACT(${base}, ${path}))` : `JSON_EXTRACT(${base}, ${path})`;
    });
  out = out
    // `groups` e cuvânt rezervat în MySQL 8 (ferestrele `GROUPS`): numele tabelului se citează.
    .replace(/\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+groups\b/gi, "$1 `groups`")
    .replace(/\bCOLLATE\s+"C"/gi, "COLLATE utf8mb4_bin")
    .replace(/\s~\s*'/g, " REGEXP '")
    .replace(new RegExp(`(${OPERAND})\\s+IS\\s+NOT\\s+DISTINCT\\s+FROM\\s+(${OPERAND})`, "gi"), "($1 <=> $2)")
    .replace(new RegExp(`(${OPERAND})\\s+IS\\s+DISTINCT\\s+FROM\\s+(${OPERAND})`, "gi"), "NOT ($1 <=> $2)");
  out = insertSelectSameTable(out);
  out = rewriteFilters(out);
  // Secundele de la epocă fără fusul sesiunii (`UNIX_TIMESTAMP` ar citi DATETIME-ul UTC în fusul local).
  out = rewriteDateTrunc(out).replace(/\bextract\s*\(\s*epoch\s+from\s+/gi, "TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', ");
  if (/^\s*(?:DELETE|UPDATE)\b/i.test(out)) out = wrapSubqueries(sameTableSubqueries(updateFrom(deleteAliases(out))));
  out = distinctOn(out);
  return quoteIdentifiers(out);
}

/**
 * `"ident"` → `` `ident` ``, în afara șirurilor din apostrofuri. Coloanele cu nume rezervate doar în MySQL (`key`,
 * `rank`, `match`, `trigger`, `groups`, scrise cu litere mici și necitate în PostgreSQL) se citează și ele.
 */
function quoteIdentifiers(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const q = text.indexOf("'", i);
    const chunk = q < 0 ? text.slice(i) : text.slice(i, q);
    out += chunk.replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, "`$1`").replace(/(?<![`\w])(key|rank|match|trigger|groups)(?![`\w]|\s*\()/g, "`$1`");
    if (q < 0) break;
    let end = q + 1;
    while (end < text.length && !(text[end] === "'" && text[end + 1] !== "'")) end += text[end] === "'" ? 2 : 1;
    out += text.slice(q, end + 1);
    i = end + 1;
  }
  return out;
}

/**
 * `SELECT DISTINCT ON (k) cols FROM … ORDER BY k, rest [LIMIT …]` → primul rând pe fiecare `k`, cu `ROW_NUMBER()`
 * (MySQL 8 / MariaDB 10.2+): `SELECT * FROM (SELECT cols, ROW_NUMBER() OVER (PARTITION BY k ORDER BY …) AS gcs_rn
 * FROM …) gcs_d WHERE gcs_rn = 1 [LIMIT …]`.
 */
function distinctOn(text: string): string {
  const m = /^(\s*)SELECT\s+DISTINCT\s+ON\s*\(/i.exec(text);
  if (!m) return text;
  const open = m[0].length - 1;
  const close = closeParen(text, open);
  if (close < 0) return text;
  const keys = text.slice(open + 1, close);
  const fromAt = topLevel(text, "FROM", close + 1);
  if (fromAt < 0) return text;
  const cols = text.slice(close + 1, fromAt).trim();
  const orderAt = topLevel(text, "ORDER", fromAt);
  const limitAt = topLevel(text, "LIMIT", orderAt < 0 ? fromAt : orderAt);
  const body = text.slice(fromAt, orderAt >= 0 ? orderAt : limitAt >= 0 ? limitAt : undefined).trim();
  const order = orderAt >= 0 ? text.slice(orderAt, limitAt >= 0 ? limitAt : undefined).replace(/^ORDER\s+BY\s+/i, "").trim() : keys;
  const limit = limitAt >= 0 ? ` ${text.slice(limitAt).trim()}` : "";
  return `${m[1]}SELECT * FROM (SELECT ${cols}, ROW_NUMBER() OVER (PARTITION BY ${keys} ORDER BY ${order}) AS gcs_rn ${body}) gcs_d WHERE gcs_rn = 1${limit}`;
}

/**
 * `DELETE FROM t s WHERE …` / `DELETE FROM t s USING b WHERE …` (PostgreSQL) → `DELETE s FROM t s [, b] WHERE …`
 * (forma cu alias pe care o acceptă și MySQL, și MariaDB).
 */
function deleteAliases(text: string): string {
  return text
    .replace(/^(\s*)DELETE\s+FROM\s+("?[A-Za-z_]\w*"?)\s+(?!WHERE\b|USING\b)([A-Za-z_]\w*)\s+USING\s+/i, "$1DELETE $3 FROM $2 $3, ")
    .replace(/^(\s*)DELETE\s+FROM\s+("?[A-Za-z_]\w*"?)\s+(?!WHERE\b|USING\b)([A-Za-z_]\w*)\s+WHERE\b/i, "$1DELETE $3 FROM $2 $3 WHERE");
}

/**
 * `INSERT INTO t (…) SELECT … FROM t … ON DUPLICATE KEY UPDATE c = t.c + VALUES(c)`: pe MySQL `t.c` ar fi ambiguă
 * (tabelul apare și în SELECT); SELECT-ul trece într-un tabel derivat.
 */
function insertSelectSameTable(text: string): string {
  const m = /^(\s*INSERT\s+(?:IGNORE\s+)?INTO\s+"?([A-Za-z_]\w*)"?\s*\([^)]*\)\s*)(SELECT\b)/i.exec(text);
  if (!m) return text;
  const selectAt = m[1]!.length;
  const dupAt = text.search(/\sON\s+DUPLICATE\s+KEY\s+UPDATE\b/i);
  if (dupAt < 0) return text;
  const select = text.slice(selectAt, dupAt);
  if (!new RegExp(`\\bFROM\\s+"?${m[2]}"?\\b`, "i").test(select)) return text;
  return `${text.slice(0, selectAt)}SELECT * FROM (${select.trim()}) AS gcs_new${text.slice(dupAt)}`;
}

/** Pozițiile (la adâncimea 0 a parantezelor, în afara șirurilor) unde apare cuvântul cheie dat. */
function topLevel(text: string, word: string, from = 0): number {
  let depth = 0;
  const re = new RegExp(`^${word}\\b`, "i");
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /\s/.test(text[i - 1] ?? " ") && re.test(text.slice(i, i + word.length + 1))) return i;
  }
  return -1;
}

/** Împarte o listă `a = x, b = y` după virgulele de la adâncimea 0. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      i = text.indexOf("'", i + 1);
      if (i < 0) break;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/**
 * `UPDATE t a SET c = x FROM src WHERE …` (PostgreSQL) → `UPDATE t a, src SET a.c = x WHERE …` (MySQL): coloanele din
 * `SET` se califică cu aliasul țintei, ca să nu fie ambigue cu cele din `src`.
 */
function updateFrom(text: string): string {
  const head = /^(\s*)UPDATE\s+("?[A-Za-z_]\w*"?)(?:\s+(?!SET\b)([A-Za-z_]\w*))?\s+SET\s+/i.exec(text);
  if (!head) return text;
  const setStart = head[0].length;
  const fromAt = topLevel(text, "FROM", setStart);
  if (fromAt < 0) return text;
  const whereAt = topLevel(text, "WHERE", fromAt);
  const alias = head[3] ?? head[2]!.replace(/"/g, "");
  const sets = splitTopLevel(text.slice(setStart, fromAt))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^("?)([A-Za-z_]\w*)\1\s*=/, (_m, q: string, col: string) => `${alias}.${q}${col}${q} =`));
  const source = text.slice(fromAt + 4, whereAt < 0 ? undefined : whereAt).trim();
  const rest = whereAt < 0 ? "" : ` ${text.slice(whereAt)}`;
  return `${head[1]}UPDATE ${head[2]}${head[3] ? ` ${head[3]}` : ""}, ${source} SET ${sets.join(", ")}${rest}`;
}

/**
 * MySQL nu acceptă în `DELETE` / `UPDATE` o subinterogare pe tabelul modificat (eroarea 1093): o asemenea
 * subinterogare citește dintr-o copie materializată, `FROM (SELECT * FROM t) alias`.
 */
function sameTableSubqueries(text: string): string {
  const target = /^\s*(?:DELETE\s+(?:[A-Za-z_]\w*\s+)?FROM|UPDATE)\s+"?([A-Za-z_]\w*)"?/i.exec(text)?.[1];
  if (!target) return text;
  const head = /^\s*(?:DELETE\s+(?:[A-Za-z_]\w*\s+)?FROM|UPDATE)\s+"?[A-Za-z_]\w*"?/i.exec(text)![0].length;
  const rest = text.slice(head).replace(new RegExp(`\\bFROM\\s+"?${target}"?(\\s+(?:AS\\s+)?(?!WHERE\\b|JOIN\\b|GROUP\\b|ORDER\\b|LIMIT\\b)([A-Za-z_]\\w*))?`, "gi"), (_m, _a, alias: string | undefined) => `FROM (SELECT * FROM ${target}) ${alias ?? target}`);
  return text.slice(0, head) + rest;
}

/** Indexul parantezei care închide paranteza deschisă la `open`. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "'") {
      i = text.indexOf("'", i + 1);
      if (i < 0) return -1;
      continue;
    }
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** `date_trunc('day' | 'hour' | 'month', x)` → începutul zilei / orei / lunii, ca `DATETIME`. */
function rewriteDateTrunc(text: string): string {
  const formats: Record<string, string> = { day: "%Y-%m-%d 00:00:00", hour: "%Y-%m-%d %H:00:00", month: "%Y-%m-01 00:00:00", minute: "%Y-%m-%d %H:%i:00" };
  const re = /\bdate_trunc\s*\(\s*'(\w+)'\s*,/gi;
  let out = "";
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = text.indexOf("(", m.index);
    const close = closeParen(text, open);
    const format = formats[m[1]!.toLowerCase()];
    if (close < 0 || !format) continue;
    const arg = text.slice(m.index + m[0].length, close).trim();
    out += `${text.slice(i, m.index)}CAST(DATE_FORMAT(${arg}, '${format}') AS DATETIME)`;
    i = close + 1;
    re.lastIndex = close + 1;
  }
  return out + text.slice(i);
}

/**
 * `agg(x) FILTER (WHERE c)` (PostgreSQL) → `agg(CASE WHEN c THEN x END)`; `count(*) FILTER (WHERE c)` →
 * `COUNT(CASE WHEN c THEN 1 END)`. Agregatele ignoră NULL, deci rezultatul e același.
 */
function rewriteFilters(text: string): string {
  const re = /\b(count|sum|avg|min|max|bool_or|bool_and)\s*\(/gi;
  let out = "";
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const close = closeParen(text, open);
    if (close < 0) break;
    const after = /^\s*FILTER\s*\(\s*WHERE\b/i.exec(text.slice(close + 1));
    if (!after) continue;
    const filterOpen = close + 1 + after[0].indexOf("(");
    const filterClose = closeParen(text, filterOpen);
    if (filterClose < 0) break;
    const cond = text.slice(close + 1 + after[0].length, filterClose).trim();
    let arg = text.slice(open + 1, close).trim();
    let fn = m[1]!.toUpperCase();
    if (fn === "BOOL_OR") fn = "MAX";
    if (fn === "BOOL_AND") fn = "MIN";
    let distinct = "";
    if (/^DISTINCT\s/i.test(arg)) {
      distinct = "DISTINCT ";
      arg = arg.replace(/^DISTINCT\s+/i, "");
    }
    if (arg === "*") arg = "1";
    out += `${text.slice(i, m.index)}${fn}(${distinct}CASE WHEN ${cond} THEN ${arg} END)`;
    i = filterClose + 1;
    re.lastIndex = filterClose + 1;
  }
  return out + text.slice(i);
}

/**
 * În `DELETE` / `UPDATE`, MySQL nu acceptă `IN (SELECT … LIMIT n)` și nici o subinterogare pe tabelul modificat:
 * `IN (SELECT …)` devine `IN (SELECT * FROM (SELECT …) AS gcs_sub)` (tabel derivat, materializat întâi).
 */
function wrapSubqueries(text: string): string {
  let out = "";
  let i = 0;
  let n = 0;
  const re = /\bIN\s*\(\s*SELECT\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = text.indexOf("(", m.index);
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")" && --depth === 0) break;
    }
    if (end >= text.length) break;
    const inner = text.slice(open + 1, end);
    out += `${text.slice(i, open)}(SELECT * FROM (${inner}) AS gcs_sub${n++})`;
    i = end + 1;
    re.lastIndex = end + 1;
  }
  return out + text.slice(i);
}
