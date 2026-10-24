// `prisma generate` cu reîncercări: pe Windows, motorul Prisma (un DLL) poate rămâne blocat câteva secunde
// după oprirea unui proces care l-a încărcat (ex. serverul de E2E), iar înlocuirea lui eșuează cu EPERM.
//
// `GCS_PRISMA_BINARY_TARGETS=native,debian-openssl-3.0.x,…` (pachetul Lite, `pnpm release --edition lite`): clienții
// primesc și motoarele pentru sistemele date; blocul `generator` al schemelor e modificat doar pe durata generării.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prismaCli = path.resolve(here, "../node_modules/prisma/build/index.js");
const ATTEMPTS = 5;
const targets = (process.env.GCS_PRISMA_BINARY_TARGETS ?? "").split(",").map((t) => t.trim()).filter(Boolean);

/** Schema cu `binaryTargets` în blocul `generator client` (textul original, pentru restaurare). */
function withTargets(file) {
  const original = readFileSync(file, "utf8");
  if (targets.length === 0) return original;
  const patched = original.replace(/generator client \{\n/, `generator client {\n  binaryTargets = ${JSON.stringify(targets)}\n`);
  if (patched === original) throw new Error(`nu găsesc blocul generator în ${file}`);
  writeFileSync(file, patched);
  return original;
}

// Ambii clienți: PostgreSQL (`@prisma/client`) și MySQL (`generated/mysql-client`, schema generată din cea principală).
spawnSync(process.execPath, [path.join(here, "mysql-schema.mjs")], { stdio: "inherit" });
for (const schema of ["prisma/schema.prisma", "prisma/mysql/schema.prisma"]) {
  const file = path.resolve(here, "..", schema);
  const original = withTargets(file);
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const result = spawnSync(process.execPath, [prismaCli, "generate", "--schema", schema], { cwd: path.resolve(here, ".."), encoding: "utf8" });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      if (result.status === 0) {
        process.stdout.write(output);
        break;
      }
      if (!output.includes("EPERM") || attempt === ATTEMPTS) {
        process.stderr.write(output);
        process.exitCode = result.status ?? 1;
        break;
      }
      console.warn(`[gcs] prisma generate: fișier blocat (EPERM), reîncerc (${attempt}/${ATTEMPTS - 1})…`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  } finally {
    writeFileSync(file, original);
  }
  if (process.exitCode) process.exit(process.exitCode);
}
