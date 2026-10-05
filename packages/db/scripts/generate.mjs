// `prisma generate` cu reîncercări: pe Windows, motorul Prisma (un DLL) poate rămâne blocat câteva secunde
// după oprirea unui proces care l-a încărcat (ex. serverul de E2E), iar înlocuirea lui eșuează cu EPERM.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prismaCli = path.resolve(here, "../node_modules/prisma/build/index.js");
const ATTEMPTS = 5;

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const result = spawnSync(process.execPath, [prismaCli, "generate"], { cwd: path.resolve(here, ".."), encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    process.stdout.write(output);
    process.exit(0);
  }
  if (!output.includes("EPERM") || attempt === ATTEMPTS) {
    process.stderr.write(output);
    process.exit(result.status ?? 1);
  }
  console.warn(`[gcs] prisma generate: fișier blocat (EPERM), reîncerc (${attempt}/${ATTEMPTS - 1})…`);
  await new Promise((r) => setTimeout(r, 2000 * attempt));
}
