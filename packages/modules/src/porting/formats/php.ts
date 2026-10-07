/**
 * Citirea codului PHP **doar ca text** (expresii regulate și un mic tokenizer de șiruri și paranteze): niciun fișier nu
 * se execută sau se interpretează. Ce nu se recunoaște rămâne pentru portarea manuală.
 */
import type { GcsPortColumn, GcsPortIndex, GcsPortSetting, GcsPortTable } from "../types";

/** Un șir PHP între ghilimele simple sau duble, fără interpolare (`\'` și `\\` decodate). */
function unquote(lit: string): string {
  const body = lit.slice(1, -1);
  return lit[0] === "'" ? body.replace(/\\(['\\])/g, "$1") : body.replace(/\\(["\\$])/g, "$1").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

const STRING = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;

/**
 * Textul dintre paranteza (sau acolada, croșetul) deschisă de la `open` și perechea ei, ignorând șirurile și
 * comentariile. `null` dacă nu se închide (cod trunchiat).
 */
export function balanced(src: string, open: number): string | null {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === "#" && src[i + 1] !== "[") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return null;
      if (stack.length === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** Poziția următorului `;` de la `from`, în afara șirurilor; -1 dacă nu există. */
function statementEnd(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === ";") return i;
  }
  return -1;
}

/** Perechile `'cheie' => 'valoare'` dintr-un literal de tablou PHP (doar șiruri și numere). */
export function arrayPairs(src: string): [string, string][] {
  const out: [string, string][] = [];
  const re = new RegExp(String.raw`(${STRING}|-?\d+)\s*=>\s*(${STRING}|-?\d+(?:\.\d+)?)`, "g");
  for (const m of src.matchAll(re)) {
    const k = /^['"]/.test(m[1]!) ? unquote(m[1]!) : m[1]!;
    const v = /^['"]/.test(m[2]!) ? unquote(m[2]!) : m[2]!;
    out.push([k, v]);
  }
  return out;
}

/** Elementele șir ale unui literal de listă PHP (`['a', 'b']`, `array('a')`). */
export function arrayStrings(src: string): string[] {
  return [...src.matchAll(new RegExp(STRING, "g"))].map((m) => unquote(m[0]));
}

const FORM_TYPES: Record<string, GcsPortSetting["type"]> = {
  yesno: "toggle",
  checkbox: "toggle",
  number: "number",
  text: "text",
  url: "text",
  email: "text",
  color: "text",
  password: "text",
  textarea: "textarea",
  editor: "textarea",
  codemirror: "textarea",
  select: "select",
  radio: "select",
};

export type GcsPhpFormField = { key: string; type: GcsPortSetting["type"]; options?: { value: string; label: string }[]; min?: number; max?: number };

/**
 * Câmpurile formularelor de setări dintr-un fișier PHP: `new …\Form\YesNo( 'cheie', … )`, `Form\Number`,
 * `Form\Select` cu `'options' => [ … ]`. Tipurile necunoscute (membri, noduri, fișiere) devin `unknown`.
 */
export function scanFormFields(src: string): GcsPhpFormField[] {
  const out: GcsPhpFormField[] = [];
  const re = /new\s+\\?(?:[A-Za-z_]\w*\\)*Form\\(\w+)\s*\(\s*(['"])([A-Za-z0-9_.-]{1,80})\2/g;
  for (const m of src.matchAll(re)) {
    const type = FORM_TYPES[m[1]!.toLowerCase()] ?? "unknown";
    const field: GcsPhpFormField = { key: m[3]!, type };
    // Argumentele câmpului (opțiunile, limitele) sunt în aceeași pereche de paranteze.
    const open = src.indexOf("(", m.index!);
    const args = open === -1 ? null : balanced(src, open);
    if (args) {
      if (type === "select") {
        const at = /['"]options['"]\s*=>\s*(array\s*\(|\[)/.exec(args);
        if (at) {
          const list = balanced(args, at.index + at[0].length - 1);
          const pairs = list ? arrayPairs(list) : [];
          if (pairs.length > 0) field.options = pairs.slice(0, 50).map(([value, label]) => ({ value, label }));
        }
      }
      if (type === "number") {
        const min = /['"]min['"]\s*=>\s*(-?\d+)/.exec(args);
        const max = /['"]max['"]\s*=>\s*(-?\d+)/.exec(args);
        if (min) field.min = Number(min[1]);
        if (max) field.max = Number(max[1]);
      }
    }
    out.push(field);
  }
  return out;
}

/** Legăturile controller → șablon: `getTemplate( 'grup', 'app', 'zonă' )->nume(` sau `->view( 'Clasa', 'șablon', … )`. */
export function scanTemplateRefs(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/getTemplate\(\s*['"](\w+)['"](?:\s*,\s*['"](\w*)['"])?(?:\s*,\s*['"](\w*)['"])?\s*\)\s*->\s*(\w+)\s*\(/g)) {
    out.push(`${m[3] || "front"}/${m[1]}/${m[4]}`);
  }
  for (const m of src.matchAll(/->\s*view\(\s*['"][^'"]*['"]\s*,\s*['"]([\w:.-]+)['"]/g)) out.push(m[1]!);
  return out;
}

/** Valoarea unui argument PHP simplu: șir, număr, `null`, `true`/`false`. */
function scalar(raw: string): string | number | null | undefined {
  const s = raw.trim();
  if (/^['"]/.test(s)) return unquote(s);
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^null$/i.test(s)) return null;
  if (/^true$/i.test(s)) return 1;
  if (/^false$/i.test(s)) return 0;
  return undefined;
}

function keyColumns(args: string): string[] {
  const first = args.trim();
  if (first.startsWith("[") || /^array\s*\(/i.test(first)) {
    const open = first.startsWith("[") ? 0 : first.indexOf("(");
    return arrayStrings(balanced(first, open) ?? "");
  }
  const m = new RegExp(`^(${STRING})`).exec(first);
  return m ? [unquote(m[1]!)] : [];
}

/** Al doilea argument (numele indexului), dacă e un șir. */
function keyName(args: string): string | null {
  const first = args.trim();
  let rest = first;
  if (first.startsWith("[") || /^array\s*\(/i.test(first)) {
    const open = first.startsWith("[") ? 0 : first.indexOf("(");
    const inner = balanced(first, open);
    rest = inner === null ? "" : first.slice(open + inner.length + 2);
  } else {
    const m = new RegExp(`^(${STRING})`).exec(first);
    rest = m ? first.slice(m[0].length) : "";
  }
  const m = new RegExp(`^\\s*,\\s*(${STRING})`).exec(rest);
  return m ? unquote(m[1]!) : null;
}

/** O definiție de tabel din corpul unei funcții `function (Create $table) { $table->addColumn(…)…; }`. */
function tableFromBody(name: string, body: string, origin: string): GcsPortTable {
  const columns: GcsPortColumn[] = [];
  const indexes: GcsPortIndex[] = [];
  for (const m of body.matchAll(/\$\w+\s*->\s*(addColumn|addPrimaryKey|addUniqueKey|addKey|addFullTextKey)\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const args = balanced(body, open);
    if (args === null) continue;
    if (m[1] === "addColumn") {
      const parts = [...args.matchAll(new RegExp(`(${STRING})|(-?\\d+)`, "g"))].map((x) => x[0]);
      const col = parts[0] ? scalar(parts[0]) : undefined;
      const type = parts[1] ? scalar(parts[1]) : undefined;
      if (typeof col !== "string" || typeof type !== "string") continue;
      const column: GcsPortColumn = { name: col, type: type.toLowerCase(), nullable: false, unsigned: /int$/i.test(type) };
      if (parts[2] && /^\d+$/.test(parts[2])) column.length = Number(parts[2]);
      // Apelurile înlănțuite, până la `;` (în afara șirurilor).
      const end = statementEnd(body, open + args.length + 2);
      const chain = body.slice(open + args.length + 2, end === -1 ? body.length : end);
      for (const c of chain.matchAll(/->\s*(\w+)\s*\(/g)) {
        const cargs = balanced(chain, c.index! + c[0].length - 1) ?? "";
        switch (c[1]) {
          case "nullable":
            column.nullable = cargs.trim() === "" || /^true$/i.test(cargs.trim());
            break;
          case "setDefault": {
            const v = scalar(cargs);
            if (v !== undefined) column.default = v;
            break;
          }
          case "autoIncrement":
            column.autoIncrement = cargs.trim() === "" || /^true$/i.test(cargs.trim());
            break;
          case "unsigned":
            column.unsigned = cargs.trim() === "" || /^true$/i.test(cargs.trim());
            break;
          case "length": {
            const v = scalar(cargs);
            if (typeof v === "number") column.length = v;
            break;
          }
          case "values":
            column.values = arrayStrings(cargs).slice(0, 100);
            break;
          case "primaryKey":
            indexes.push({ kind: "primary", name: "PRIMARY", columns: [col] });
            break;
        }
      }
      columns.push(column);
    } else {
      const cols = keyColumns(args);
      if (cols.length === 0) continue;
      const kind = m[1] === "addPrimaryKey" ? "primary" : m[1] === "addUniqueKey" ? "unique" : m[1] === "addFullTextKey" ? "fulltext" : "key";
      indexes.push({ kind, name: keyName(args) ?? cols.join("_"), columns: cols });
    }
  }
  return { name, columns, indexes, origin };
}

/**
 * Tabelele create din codul de instalare: `createTable('nume', function (…) { … })` sau
 * `$tables['nume'] = function (…) { … }`. Doar definițiile cu coloane recunoscute.
 */
export function scanCreateTables(src: string, origin: string): GcsPortTable[] {
  const out: GcsPortTable[] = [];
  const re = new RegExp(String.raw`(?:createTable\(\s*(${STRING})\s*,|\$\w+\[\s*(${STRING})\s*\]\s*=)\s*(?:static\s+)?function\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?\{`, "g");
  for (const m of src.matchAll(re)) {
    const name = unquote((m[1] ?? m[2])!);
    const body = balanced(src, m.index! + m[0].length - 1);
    if (body === null) continue;
    const table = tableFromBody(name, body, origin);
    if (table.columns.length > 0 && !out.some((t) => t.name === name)) out.push(table);
  }
  return out;
}

/** Perechile `'cheie' => 'text'` dintr-un fișier de fraze PHP (`$lang = array( … )`). */
export function scanLangArray(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of arrayPairs(src)) if (/^[A-Za-z0-9_.-]{1,120}$/.test(k)) out.set(k, v);
  return out;
}
