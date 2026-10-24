// Migrația de bază MySQL / MariaDB (ediția Lite): toată schema de azi, într-o singură migrație (instalările MySQL sunt
// toate noi). Folosire: `node scripts/mysql-base.mjs` → `prisma/migrations-mysql/20261120300000_base/migration.sql`.
//
// Pornește de la `prisma migrate diff` pe `prisma/mysql/schema.prisma` și adaugă ce Prisma nu exprimă pe MySQL:
// - valorile implicite pe `LONGTEXT` / `JSON` (ca expresii, `DEFAULT ('…')`, MySQL 8.0.13+ / MariaDB 10.2+);
// - regulile „unic doar când …” (coloane generate + index unic, ca în PostgreSQL după etapa 2);
// - căutarea `FULLTEXT` (coloanele `searchText`);
// - cheile `gcs_kv` comparate binar (nu „A” = „a”);
// - revizia sancțiunilor fără secvență (o dă aplicația);
// - momentele implicite în UTC (`UTC_TIMESTAMP`, nu fusul sesiunii).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prismaCli = path.resolve(here, "../node_modules/prisma/build/index.js");
const mysqlSchema = path.resolve(here, "../prisma/mysql/schema.prisma");
const mainSchema = path.resolve(here, "../prisma/schema.prisma");
const outDir = path.resolve(here, "../prisma/migrations-mysql/20261120300000_base");

/** Valorile implicite text / JSON din schema principală: tabel → coloană → literal. */
function stringDefaults(schema) {
  const out = new Map();
  let model = null;
  let table = null;
  let fields = [];
  for (const line of schema.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^model (\w+) \{/.exec(line);
    if (m) {
      model = m[1];
      table = null;
      fields = [];
      continue;
    }
    if (!model) continue;
    const map = /@@map\("([^"]+)"\)/.exec(line);
    if (map) table = map[1];
    const f = /^\s+(\w+)\s+(String|Json)\??\s.*@default\("((?:[^"\\]|\\.)*)"\)/.exec(line);
    if (f) fields.push([f[1], f[3].replace(/\\"/g, '"')]);
    if (/^}/.test(line)) {
      const t = table ?? model;
      out.set(t, new Map(fields));
      model = null;
    }
  }
  return out;
}

const sqlString = (s) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

export function buildBase(ddl, schema) {
  const defaults = stringDefaults(schema);
  const lines = ddl.replace(/\r\n/g, "\n").split("\n");
  let table = null;
  const out = [];
  for (let line of lines) {
    const t = /^CREATE TABLE `([^`]+)`/.exec(line);
    if (t) table = t[1];
    if (/^\) DEFAULT CHARACTER SET/.test(line)) table = null;
    const col = /^(\s+)`(\w+)` (LONGTEXT|JSON)( NOT NULL| NULL)( DEFAULT .*?)?(,?)$/.exec(line);
    if (table && col) {
      const [, ind, name, type, nullity, , comma] = col;
      const literal = defaults.get(table)?.get(name);
      if (literal !== undefined) line = `${ind}\`${name}\` ${type}${nullity} DEFAULT (${sqlString(literal)})${comma}`;
      else line = `${ind}\`${name}\` ${type}${nullity}${comma}`;
    }
    // Momentele sunt în UTC (ca valorile scrise de Prisma); `CURRENT_TIMESTAMP` ar lua fusul sesiunii, des local pe
    // găzduirile partajate.
    out.push(line.replace(/DEFAULT CURRENT_TIMESTAMP\((\d)\)/g, "DEFAULT (UTC_TIMESTAMP($1))"));
  }
  return [
    "-- Ediția Lite: schema completă pentru MySQL 8 / MariaDB 10.6+ (generată de scripts/mysql-base.mjs).",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "",
    ...out,
    "",
    EXTRA,
    "SET FOREIGN_KEY_CHECKS = 1;",
    "",
  ].join("\n");
}

const EXTRA = `-- ─── Ce nu se exprimă în schema Prisma ───────────────────────────────────────────

-- Unic doar când …: coloane generate (NULL în afara condiției) + index unic.
ALTER TABLE \`notifications\` ADD COLUMN \`unreadKey\` VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN \`readAt\` IS NULL THEN \`groupKey\` END) STORED;
CREATE UNIQUE INDEX \`notifications_unread_group\` ON \`notifications\`(\`userId\`, \`unreadKey\`);
ALTER TABLE \`vip_subscriptions\` ADD COLUMN \`activeFlag\` TINYINT GENERATED ALWAYS AS (CASE WHEN \`status\` = 'ACTIVE' THEN 1 END) STORED;
CREATE UNIQUE INDEX \`vip_subscriptions_one_active_per_user\` ON \`vip_subscriptions\`(\`userId\`, \`activeFlag\`);
ALTER TABLE \`clan_members\` ADD COLUMN \`leaderFlag\` TINYINT GENERATED ALWAYS AS (CASE WHEN \`role\` = 'LEADER' THEN 1 END) STORED;
CREATE UNIQUE INDEX \`clan_members_one_leader\` ON \`clan_members\`(\`clanId\`, \`leaderFlag\`);
ALTER TABLE \`clan_requests\` ADD COLUMN \`pendingFlag\` TINYINT GENERATED ALWAYS AS (CASE WHEN \`status\` = 'PENDING' THEN 1 END) STORED;
CREATE UNIQUE INDEX \`clan_requests_one_pending\` ON \`clan_requests\`(\`clanId\`, \`userId\`, \`kind\`, \`pendingFlag\`);
ALTER TABLE \`game_sessions\` ADD COLUMN \`openFlag\` TINYINT GENERATED ALWAYS AS (CASE WHEN \`disconnectedAt\` IS NULL THEN 1 END) STORED;
CREATE UNIQUE INDEX \`game_sessions_one_open\` ON \`game_sessions\`(\`serverId\`, \`playerId\`, \`openFlag\`);
ALTER TABLE \`member_removals\` ADD COLUMN \`activeFlag\` TINYINT GENERATED ALWAYS AS (CASE WHEN \`status\` IN ('SCHEDULED', 'QUEUED', 'RUNNING', 'FAILED') THEN 1 END) STORED;
CREATE UNIQUE INDEX \`member_removals_one_active\` ON \`member_removals\`(\`userId\`, \`activeFlag\`);

-- Căutarea: textul simplu al titlului / postării, cu index FULLTEXT (colația ignoră diacriticele și majusculele).
ALTER TABLE \`topics\` ADD COLUMN \`searchText\` LONGTEXT NULL;
ALTER TABLE \`posts\` ADD COLUMN \`searchText\` LONGTEXT NULL;
CREATE FULLTEXT INDEX \`topics_searchText_idx\` ON \`topics\`(\`searchText\`);
CREATE FULLTEXT INDEX \`posts_searchText_idx\` ON \`posts\`(\`searchText\`);

-- Cheile GcsSqlKv sunt sensibile la majuscule (ca în Redis).
ALTER TABLE \`gcs_kv\` MODIFY \`key\` VARCHAR(255) NOT NULL COLLATE utf8mb4_bin;
ALTER TABLE \`gcs_kv_items\` MODIFY \`key\` VARCHAR(255) NOT NULL COLLATE utf8mb4_bin, MODIFY \`field\` VARCHAR(255) NOT NULL COLLATE utf8mb4_bin;

-- Revizia sancțiunilor (PostgreSQL: secvența \`game_sync_revision\`): în MySQL o dă aplicația, sub lacăt.
ALTER TABLE \`game_sanctions\` MODIFY \`revision\` BIGINT NOT NULL DEFAULT 0;
`;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ddl = execFileSync(process.execPath, [prismaCli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", mysqlSchema, "--script"], {
    env: { ...process.env, DATABASE_URL: "mysql://u:p@localhost:3306/x" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "migration.sql"), buildBase(ddl, readFileSync(mainSchema, "utf8")));
  console.log(`scris ${path.relative(process.cwd(), path.join(outDir, "migration.sql"))}`);
}
