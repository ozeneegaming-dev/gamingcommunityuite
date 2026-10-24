// Generează schema Prisma pentru MySQL / MariaDB (ediția Lite) din schema unică `prisma/schema.prisma`.
// Folosire: `node scripts/mysql-schema.mjs` (scrie `prisma/mysql/schema.prisma`; `--check` doar verifică dacă e la zi).
//
// Diferențe față de PostgreSQL:
// - `provider = "mysql"`, clientul generat separat (`generated/mysql-client`);
// - un `String` fără `@db.*` devine `VarChar(191)` dacă e cheie, unic, indexat sau cheie străină (limita indexurilor
//   InnoDB pe utf8mb4), altfel `LongText` (textele lungi: conținut, HTML, descrieri);
// - valorile implicite pe `LongText` / `Json` (pe care MySQL le acceptă doar ca expresii) se pun în migrația MySQL;
// - `dbgenerated(...)` specific PostgreSQL (secvențe) devine `@default(0)`: valoarea reală o dă aplicația.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../prisma/schema.prisma");
const outDir = path.resolve(here, "../prisma/mysql");
const out = path.join(outDir, "schema.prisma");

export function toMysqlSchema(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // 1. Câmpurile care trebuie să încapă într-un index, pe model.
  const indexed = new Map();
  let model = null;
  for (const line of lines) {
    const m = /^model (\w+) \{/.exec(line);
    if (m) {
      model = m[1];
      indexed.set(model, new Set());
      continue;
    }
    if (model && /^}/.test(line)) {
      model = null;
      continue;
    }
    if (!model) continue;
    const set = indexed.get(model);
    const field = /^\s+(\w+)\s+\w+/.exec(line);
    if (field && /@id\b|@unique\b/.test(line)) set.add(field[1]);
    for (const block of line.matchAll(/@@(?:index|unique|id)\(\[([^\]]+)\]/g)) {
      for (const f of block[1].split(",")) set.add(f.trim().replace(/\(.*$/, ""));
    }
    const rel = /fields:\s*\[([^\]]+)\]/.exec(line);
    if (rel) for (const f of rel[1].split(",")) set.add(f.trim());
  }

  // 2. Rescrierea.
  const result = [];
  model = null;
  for (const line of lines) {
    const m = /^model (\w+) \{/.exec(line);
    if (m) model = m[1];
    else if (model && /^}/.test(line)) model = null;

    if (/provider\s*=\s*"postgresql"/.test(line)) {
      result.push(line.replace('"postgresql"', '"mysql"'));
      continue;
    }
    if (/^\s*provider\s*=\s*"prisma-client-js"/.test(line)) {
      result.push(line);
      result.push('  output   = "../../generated/mysql-client"');
      continue;
    }
    const f = /^(\s+)(\w+)(\s+)(String)(\??)(\s.*)?$/.exec(line);
    if (model && f && !/@db\./.test(line) && !line.trim().startsWith("//")) {
      const [, ind, name, sp, type, opt, rest = ""] = f;
      const db = indexed.get(model)?.has(name) ? "@db.VarChar(191)" : "@db.LongText";
      result.push(`${ind}${name}${sp}${type}${opt} ${db}${rest}`.replace(/\s+$/, ""));
      continue;
    }
    if (model && /@default\(dbgenerated\(/.test(line)) {
      result.push(line.replace(/@default\(dbgenerated\((?:[^()]|\([^()]*\))*\)\)/, "@default(0)"));
      continue;
    }
    result.push(line);
  }
  return [
    "// GENERAT din ../schema.prisma de scripts/mysql-schema.mjs — nu edita aici.",
    ...result,
  ].join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const next = toMysqlSchema(readFileSync(src, "utf8"));
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(out, "utf8");
    } catch {
      // lipsește
    }
    if (current !== next) {
      console.error("prisma/mysql/schema.prisma nu e la zi: rulează `node scripts/mysql-schema.mjs`");
      process.exit(1);
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(out, next);
    console.log(`scris ${path.relative(process.cwd(), out)}`);
  }
}
