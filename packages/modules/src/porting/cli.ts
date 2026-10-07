/**
 * CLI-ul asistentului de portare, pentru dezvoltatori (fără bază de date):
 *
 *   pnpm gcs:port <arhivă> --rights=author|consent|license [--key=vendor.nume] [--out=folder] [--locale=ro|en] [--force]
 *
 * Aceeași conversie ca în ACP. Confirmarea dreptului de a modifica și folosi pluginul e obligatorie (`--rights`) și
 * apare în `PORTING.md` / `report.json`. Scrie folderul rezultatului (implicit `ported/<cheie>/`): pluginul, pachetul
 * instalabil, `ORIGINAL/` (sursele, doar ca text), `PORTING.md`, `report.json`. Nu instalează nimic.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readPortArchive } from "./archive";
import { analyzePortSource, readPortSource } from "./detect";
import { convertPortSource } from "./generate";
import { portingMarkdown } from "./report";
import { GCS_PORT_RIGHTS, type GcsPortRightsBasis } from "./types";

export type GcsPortCliIo = { cwd: string; log: (line: string) => void };

const USAGE = "Folosire: pnpm gcs:port <arhivă> --rights=author|consent|license [--key=vendor.nume] [--out=folder] [--locale=ro|en] [--force]";

function parseArgs(argv: string[]): { file: string | null; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  let file: string | null = null;
  for (const arg of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (m) flags.set(m[1]!, m[2] ?? "true");
    else if (!file) file = arg;
  }
  return { file, flags };
}

/** Scrie un fișier în `root`, refuzând orice cale care ar ieși din el (apărare în adâncime: căile sunt deja verificate). */
async function writeInside(root: string, rel: string, data: Buffer | string): Promise<void> {
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`cale nesigură: ${rel}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}

/** Rulează CLI-ul; întoarce codul de ieșire (0 = succes). */
export async function runPortCli(argv: string[], io: GcsPortCliIo): Promise<number> {
  const { file, flags } = parseArgs(argv);
  const rights = flags.get("rights") as GcsPortRightsBasis | undefined;
  if (!file) {
    io.log(USAGE);
    return 2;
  }
  if (!rights || !GCS_PORT_RIGHTS.includes(rights)) {
    io.log("Confirmă că ai dreptul să modifici și să folosești pluginul: --rights=author (ești autorul), consent (ai acordul scris al autorului) sau license (licența permite).");
    io.log("Pluginurile cumpărate sunt licențiate de autorii lor: portarea și redistribuirea fără acord nu sunt permise.");
    return 2;
  }
  const input = path.resolve(io.cwd, file);
  let source;
  try {
    source = readPortSource(readPortArchive(path.basename(input), await readFile(input)));
  } catch (e) {
    const code = (e as { code?: string }).code ?? (e instanceof Error ? e.message : String(e));
    const params = (e as { params?: Record<string, string> }).params;
    io.log(`Arhiva nu poate fi portată: ${code}${params && Object.keys(params).length ? ` ${JSON.stringify(params)}` : ""}`);
    return 1;
  }
  const analysis = analyzePortSource(source);
  const key = flags.get("key") ?? analysis.suggestedKey;
  const out = convertPortSource(source, { key, rights: { basis: rights, confirmedAt: new Date() }, locale: flags.get("locale") === "en" ? "en" : "ro" });
  const dir = path.resolve(io.cwd, flags.get("out") ?? path.join("ported", key));
  const existing = await readdir(dir).catch(() => [] as string[]);
  if (existing.length > 0 && flags.get("force") !== "true") {
    io.log(`Folderul ${dir} nu e gol (adaugă --force ca să scrii peste el).`);
    return 1;
  }
  for (const [rel, data] of out.pluginFiles) await writeInside(dir, path.join(key, rel), data);
  await writeInside(dir, out.report.plugin.fileName, out.packageZip);
  for (const [rel, data] of source.files) await writeInside(dir, path.join("ORIGINAL", rel), data);
  await writeInside(dir, "PORTING.md", portingMarkdown(out.report, flags.get("locale") === "en" ? "en" : "ro"));
  await writeInside(dir, "report.json", `${JSON.stringify(out.report, null, 2)}\n`);

  io.log(`${analysis.meta.name} (${analysis.format}) → ${key} ${out.report.plugin.version}`);
  if (source.license.gpl) io.log("Atenție: licență GPL. Codul GPL nu poate intra într-o distribuție GCS închisă.");
  io.log(`Automat: ~${out.report.automatedPercent}% · TODO(portare): ${out.report.todos} · fișiere de portat manual: ${out.report.manual.length}`);
  io.log(out.report.validation.ok ? `Pachetul ${out.report.plugin.fileName} trece de validarea instalatorului.` : `Pachetul nu trece de validare: ${JSON.stringify(out.report.validation.checks.filter((c) => c.level === "error"))}`);
  io.log(`Rezultatul: ${dir}`);
  return out.report.validation.ok ? 0 : 1;
}

// `pnpm gcs:port …` (din rădăcină) rulează în folderul pachetului; căile utilizatorului sunt relative la `INIT_CWD`.
if (process.argv[1] && /porting[\\/]cli\.ts$/.test(process.argv[1])) {
  runPortCli(process.argv.slice(2), { cwd: process.env.INIT_CWD ?? process.cwd(), log: (line) => console.log(line) })
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
