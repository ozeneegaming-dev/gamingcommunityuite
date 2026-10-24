#!/usr/bin/env node
/**
 * Pachetul ediției Lite (găzduire partajată cu „Setup Node.js App”, cPanel / Plesk): `pnpm release -- --edition lite
 * --license-key-file <cheia publică> [--version 1.2.0] [--out <folder>] [--target linux-x64-gnu|win32-x64] [--skip-build]`.
 *
 * Scrie `dist/release/<versiune>/gcs-lite-<versiune>.zip` (+ `.sha256`). În arhivă, folderul `gcs-lite-<versiune>/`:
 * - aplicația Next.js gata construită (`apps/web`, build „standalone”), cu `node_modules` de producție plat (fără
 *   link-uri simbolice: arhivele se dezarhivează din File Manager-ul gazdei) și binarele native ale țintei — implicit
 *   **linux-x64 (glibc)**: sharp, argon2 și motoarele Prisma ale ambelor dialecte pentru OpenSSL 1.0 / 1.1 / 3;
 * - migrațiile PostgreSQL și MySQL (`packages/db/prisma/migrations*`);
 * - `app.js` (fișierul de pornire pentru Passenger), `cron.mjs` (cron-ul gazdei), `docs/INSTALL-LITE.md` (RO) și
 *   `docs/INSTALL-LITE.en.md` (EN), `EULA.md`, `THIRD-PARTY-NOTICES.md`, `LICENSE`, `VERSION`, `CHECKSUMS.sha256`.
 *
 * Cheile publice de licență intră în build (ca la VPS, în `license.ts`), iar clienții Prisma se generează cu motoarele
 * țintei; ambele fișiere revin la forma lor după build. Binarele native ale țintei vin din registrul npm, exact la
 * versiunile din build. `--target win32-x64` face aceeași arhivă cu binarele Windows (verificarea locală a pachetului).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLicenseKeys, brandingIssues, checksumsFile, LICENSE_KEYS_EMPTY, LICENSE_KEYS_FILE, LICENSE_TEXT, parseLicenseKeys, sha256, writeZip } from "./release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "apps", "web");

/** Ținta pachetului: motoarele Prisma și potrivirea pachetelor native (`<nume>-<os>-<cpu>[-<libc>]`). */
export const LITE_TARGETS = {
  "linux-x64-gnu": {
    prisma: ["debian-openssl-1.1.x", "debian-openssl-3.0.x", "rhel-openssl-1.0.x", "rhel-openssl-1.1.x", "rhel-openssl-3.0.x"],
    native: (name) => /-linux-x64(-gnu)?$/.test(name),
  },
  "win32-x64": { prisma: ["windows"], native: (name) => /-win32-x64(-msvc)?$/.test(name) },
};

/** Un pachet npm specific unei platforme (ex. `@img/sharp-linux-x64`, `@node-rs/argon2-win32-x64-msvc`). */
export const PLATFORM_PACKAGE = /-(win32|linux|linuxmusl|darwin|freebsd|android|openharmony)-(x64|arm64|ia32|arm|riscv64|s390x|ppc64|loong64|wasm32)(-(gnu|musl|msvc|gnueabihf|musleabihf))?$/;

/** Ce nu intră în pachet din folderul aplicației (sursele de test, configurările de dezvoltare). */
export const LITE_EXCLUDES = [
  /(^|\/)e2e\//,
  /(^|\/)test\//,
  /(^|\/)__tests__\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)(vitest|playwright)\.config\.[cm]?[jt]s$/,
  /(^|\/)tsconfig(\.[\w-]+)?\.json$/,
  /(^|\/)tsconfig\.tsbuildinfo$/,
  /(^|\/)eslint\.config\.[cm]?js$/,
  /^apps\/web\/scripts\//,
  /^apps\/web\/cli\//,
  /(^|\/)\.env(\.[^/]*)?$/,
  /(^|\/)\.gcs-config\//,
  /(^|\/)\.e2e\//,
  /\.(pem|key)$/,
];

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" && !path.isAbsolute(cmd), ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} a eșuat (cod ${res.status})`);
  return res;
};

/** Fișierele unui folder (căi relative cu `/`), urmând link-urile simbolice. */
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** Numele pachetelor dintr-un `node_modules` (inclusiv cele cu scope și folderul `.prisma`). */
function packagesIn(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === ".bin" || name === ".pnpm" || name === ".modules.yaml") continue;
    if (name.startsWith("@")) for (const sub of readdirSync(path.join(dir, name))) out.push(`${name}/${sub}`);
    else out.push(name);
  }
  return out;
}

/**
 * Build-ul standalone, copiat cu link-urile rezolvate: `node_modules/.pnpm/<x>/node_modules/<pachet>` devine
 * `node_modules/<pachet>` (o singură versiune per pachet: altfel ar trebui păstrată structura pnpm), restul se copiază
 * la aceeași cale. Întoarce folderul pachetului.
 */
export function assembleStandalone(standalone, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const modules = path.join(dest, "node_modules");
  mkdirSync(modules, { recursive: true });
  const versions = new Map();
  const pnpm = path.join(standalone, "node_modules", ".pnpm");
  const copyPackage = (from, name) => {
    const pkgFile = path.join(from, "package.json");
    const version = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, "utf8")).version : "";
    const seen = versions.get(name);
    if (seen !== undefined) {
      if (seen !== version) throw new Error(`două versiuni ale lui ${name} (${seen}, ${version}): node_modules plat nu e posibil`);
      return;
    }
    versions.set(name, version);
    cpSync(from, path.join(modules, name), { recursive: true, dereference: true, filter: (src) => path.basename(src) !== ".bin" });
  };
  if (existsSync(pnpm)) {
    for (const entry of readdirSync(pnpm)) {
      if (entry === "node_modules" || entry === "lock.yaml") continue;
      const nm = path.join(pnpm, entry, "node_modules");
      for (const name of packagesIn(nm)) copyPackage(path.join(nm, name), name);
    }
  }
  for (const name of packagesIn(path.join(standalone, "node_modules"))) copyPackage(path.join(standalone, "node_modules", name), name);
  // `apps/web/node_modules` (ex. `next`) urcă și el la rădăcină: rezolvarea modulelor urcă prin foldere.
  for (const name of packagesIn(path.join(standalone, "apps", "web", "node_modules"))) copyPackage(path.join(standalone, "apps", "web", "node_modules", name), name);

  for (const entry of readdirSync(standalone)) {
    if (entry === "node_modules") continue;
    const from = path.join(standalone, entry);
    cpSync(from, path.join(dest, entry), {
      recursive: true,
      dereference: true,
      filter: (src) => {
        const rel = path.relative(standalone, src).split(path.sep).join("/");
        if (rel === "apps/web/node_modules" || rel.startsWith("apps/web/node_modules/")) return false;
        if (path.basename(src) === ".bin") return false;
        return !LITE_EXCLUDES.some((re) => re.test(rel + (lstatSync(src).isDirectory() ? "/" : "")));
      },
    });
  }
  return dest;
}

/** Descarcă un pachet din registrul npm (`npm pack`) și îl pune în `node_modules/<nume>`. */
function fetchPackage(name, version, modules, tmp) {
  const res = spawnSync("npm", ["pack", `${name}@${version}`, "--pack-destination", tmp, "--silent"], { cwd: tmp, encoding: "utf8", shell: process.platform === "win32" });
  if (res.status !== 0) throw new Error(`npm pack ${name}@${version} a eșuat: ${res.stderr}`);
  const tgz = path.join(tmp, res.stdout.trim().split(/\r?\n/).at(-1));
  const out = mkdtempSync(path.join(tmp, "pkg-"));
  // Pe Windows, tar-ul sistemului (bsdtar): cel din Git Bash ar citi `C:\…` ca adresă de server la distanță.
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  run(tar, ["-xzf", tgz, "-C", out], { cwd: tmp, shell: false });
  const dest = path.join(modules, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(path.join(out, "package"), dest, { recursive: true });
}

/**
 * Binarele native ale țintei: pentru fiecare pachet cu dependențe opționale pe platforme (sharp, argon2…), pachetele
 * țintei se aduc la versiunile cerute, iar cele ale altor platforme se scot. Întoarce ce s-a adus.
 */
export function swapNatives(dest, target, { fetch = fetchPackage } = {}) {
  const t = LITE_TARGETS[target];
  if (!t) throw new Error(`țintă necunoscută: ${target}`);
  const modules = path.join(dest, "node_modules");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "gcs-lite-natives-"));
  const fetched = [];
  try {
    // Pachetele native ale țintei deja prezente vin din tracing-ul Next, care ia doar fișierele văzute (ex. `.node`, nu
    // și bibliotecile de lângă: DLL-urile libvips ale lui sharp): se aduc întregi, la aceeași versiune.
    for (const name of packagesIn(modules)) {
      if (!PLATFORM_PACKAGE.test(name) || !t.native(name)) continue;
      const pkgFile = path.join(modules, name, "package.json");
      if (!existsSync(pkgFile)) continue;
      const { version } = JSON.parse(readFileSync(pkgFile, "utf8"));
      fetch(name, version, modules, tmp);
      fetched.push(`${name}@${version}`);
    }
    for (let pass = 0; pass < 4; pass++) {
      const present = new Set(packagesIn(modules));
      let added = 0;
      for (const name of present) {
        const pkgFile = path.join(modules, name, "package.json");
        if (!existsSync(pkgFile)) continue;
        const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
        const deps = { ...(pkg.optionalDependencies ?? {}), ...(PLATFORM_PACKAGE.test(name) ? (pkg.dependencies ?? {}) : {}) };
        // Doar binarele folosite la rulare: build-ul avea varianta unei platforme (ex. sharp, argon2), sau pachetul e
        // el însuși unul nativ al țintei (ex. libvips pentru sharp). Restul (ex. SWC-ul lui Next, doar pentru build) nu.
        const used = (PLATFORM_PACKAGE.test(name) && t.native(name)) || Object.keys(deps).some((d) => PLATFORM_PACKAGE.test(d) && present.has(d));
        if (!used) continue;
        for (const [dep, range] of Object.entries(deps)) {
          if (!PLATFORM_PACKAGE.test(dep) || !t.native(dep) || present.has(dep)) continue;
          fetch(dep, String(range).replace(/^[\^~=]/, ""), modules, tmp);
          fetched.push(`${dep}@${range}`);
          present.add(dep);
          added++;
        }
      }
      if (added === 0) break;
    }
    for (const name of packagesIn(modules)) {
      if (PLATFORM_PACKAGE.test(name) && !t.native(name)) rmSync(path.join(modules, name), { recursive: true, force: true });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return fetched;
}

/** Motoarele Prisma: doar cele ale țintei rămân în clienți (ambele dialecte). */
export function pruneEngines(dest, target) {
  const keep = LITE_TARGETS[target].prisma;
  const dirs = [path.join(dest, "node_modules", ".prisma", "client"), path.join(dest, "packages", "db", "generated", "mysql-client")];
  const missing = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) throw new Error(`lipsește clientul Prisma: ${path.relative(dest, dir)}`);
    for (const name of readdirSync(dir)) {
      const m = /^(?:lib)?query_engine-(.+?)\.(?:so|dll|dylib)\.node$/.exec(name);
      if (m && !keep.includes(m[1])) rmSync(path.join(dir, name));
    }
    for (const t of keep) {
      const file = t === "windows" ? "query_engine-windows.dll.node" : `libquery_engine-${t}.so.node`;
      if (!existsSync(path.join(dir, file))) missing.push(`${path.relative(dest, dir)}/${file}`);
    }
  }
  if (missing.length > 0) throw new Error(`lipsesc motoarele Prisma:\n${missing.join("\n")}`);
}

/**
 * Căile absolute ale mașinii de build (metadatele clientului Prisma, configurarea Next.js din `server.js`) devin
 * `/gcs-build`: nu sunt folosite la rulare și nu au ce căuta în pachetul clientului. Toate formele: `D:\\…` (JSON),
 * `D:\…`, `D:/…`.
 */
export function neutralizeBuildPaths(data, root = ROOT) {
  const text = data.toString("utf8");
  if (text.includes("\u0000")) return data;
  const forms = [root.replace(/\\/g, "\\\\"), root, root.replace(/\\/g, "/")];
  let out = text;
  for (const form of new Set(forms)) {
    const re = new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`), "gi");
    out = out.replace(re, "/gcs-build");
  }
  return out === text ? data : Buffer.from(out, "utf8");
}

/** Numele din bibliotecile incluse care seamănă cu mărci (iconița de brand `faInvision` din Font Awesome), ignorate de gardă. */
export const LITE_BRANDING_ALLOW = [/faInvision/g, /iconName:"invision"/g];

/** Fișierele pachetului Lite (cale → octeți) pornind de la folderul asamblat, cu fișierele de la rădăcină. */
export function liteReleaseFiles(dest, { version, root = ROOT }) {
  const files = new Map();
  for (const rel of walk(dest)) {
    const data = readFileSync(path.join(dest, rel));
    files.set(rel, /\.(m?js|cjs|json|prisma|ts)$/.test(rel) ? neutralizeBuildPaths(data, root) : data);
  }
  const add = (rel, from) => files.set(rel, readFileSync(path.join(root, from)));
  add("app.js", "lite/app.js");
  add("cron.mjs", "lite/cron.mjs");
  add("docs/INSTALL-LITE.md", "docs/INSTALL-LITE.md");
  add("docs/INSTALL-LITE.en.md", "docs/INSTALL-LITE.en.md");
  add("EULA.md", "EULA.md");
  add("THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.md");
  // Migrațiile ambelor dialecte (runner-ul aplicației le aplică la instalare și la pornire).
  for (const dir of ["packages/db/prisma/migrations", "packages/db/prisma/migrations-mysql"]) {
    for (const rel of walk(path.join(root, dir))) files.set(`${dir}/${rel}`, readFileSync(path.join(root, dir, rel)));
  }
  files.set("VERSION", Buffer.from(`${version}\n`, "utf8"));
  files.set("LICENSE", Buffer.from(LICENSE_TEXT(version), "utf8"));
  for (const required of ["apps/web/server.js", "apps/web/.next/BUILD_ID", "node_modules/next/package.json"]) {
    if (!files.has(required)) throw new Error(`lipsește din pachet: ${required}`);
  }
  files.set("CHECKSUMS.sha256", Buffer.from(checksumsFile(files), "utf8"));
  return files;
}

/** Rulează `fn` cu cheile de licență scrise în surse (ca la build-ul VPS) și restaurează fișierul după. */
function withLicenseKeys(licenseKeys, fn) {
  const file = path.join(ROOT, LICENSE_KEYS_FILE);
  const original = readFileSync(file, "utf8");
  if (!original.includes(LICENSE_KEYS_EMPTY)) throw new Error(`nu găsesc lista cheilor de licență în ${LICENSE_KEYS_FILE}`);
  writeFileSync(file, original.replace(LICENSE_KEYS_EMPTY, `export const GCS_LICENSE_KEYS: Record<string, string> = ${JSON.stringify(licenseKeys)};`));
  try {
    return fn();
  } finally {
    writeFileSync(file, original);
  }
}

/** Construiește pachetul Lite și întoarce căile scrise. */
export function buildLiteRelease({ version, out, licenseKeys, target = "linux-x64-gnu", skipBuild = false } = {}) {
  if (!version || !/^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(version)) throw new Error(`versiune invalidă: ${version}`);
  assertLicenseKeys(licenseKeys);
  if (!LITE_TARGETS[target]) throw new Error(`țintă necunoscută: ${target}`);
  const outDir = out ?? path.join(ROOT, "dist", "release", version);
  mkdirSync(outDir, { recursive: true });

  if (!skipBuild) {
    // Clienții Prisma cu motoarele țintei (și cel local, pentru build), apoi build-ul cu cheile de licență.
    const targets = ["native", ...LITE_TARGETS[target].prisma].join(",");
    try {
      run(process.execPath, [path.join(ROOT, "packages/db/scripts/generate.mjs")], { env: { ...process.env, GCS_PRISMA_BINARY_TARGETS: targets } });
      withLicenseKeys(licenseKeys, () => run("pnpm", ["--filter", "@gcs/web", "exec", "next", "build"], { env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } }));
    } finally {
      run(process.execPath, [path.join(ROOT, "packages/db/scripts/generate.mjs")]);
    }
  }

  const staging = mkdtempSync(path.join(os.tmpdir(), "gcs-lite-"));
  try {
    const dest = assembleStandalone(path.join(WEB, ".next", "standalone"), path.join(staging, "app"));
    cpSync(path.join(WEB, ".next", "static"), path.join(dest, "apps", "web", ".next", "static"), { recursive: true });
    if (existsSync(path.join(WEB, "public"))) cpSync(path.join(WEB, "public"), path.join(dest, "apps", "web", "public"), { recursive: true });
    const natives = swapNatives(dest, target);
    pruneEngines(dest, target);

    const files = liteReleaseFiles(dest, { version });
    const checked = new Map([...files].map(([rel, data]) => [rel, /\.(m?js|cjs)$/.test(rel) ? Buffer.from(LITE_BRANDING_ALLOW.reduce((s, re) => s.replace(re, ""), data.toString("utf8")), "utf8") : data]));
    const issues = brandingIssues(checked);
    if (issues.length > 0) throw new Error(`garda de branding a găsit nume interzise în pachet:\n${issues.slice(0, 50).join("\n")}`);
    const top = `gcs-lite-${version}`;
    const entries = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rel, data]) => ({ name: `${top}/${rel}`, data }));
    const zip = path.join(outDir, target === "linux-x64-gnu" ? `${top}.zip` : `${top}-${target}.zip`);
    writeFileSync(zip, writeZip(entries));
    writeFileSync(`${zip}.sha256`, `${sha256(readFileSync(zip))}  ${path.basename(zip)}\n`);
    return { zip, files: files.size, natives, target };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = arg("version") ?? JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
    // Cheile publice de licență, ca la release-ul VPS: `--license-key id=base64` (repetabil) sau `--license-key-file`.
    const keyArgs = process.argv.flatMap((a, i) => (a === "--license-key" ? [process.argv[i + 1]] : []));
    // `--license-key-file` se poate repeta: cheia offline a proprietarului și cea a Data Center-ului (`gcs-lic-dc-2026`).
    const keyFiles = process.argv.flatMap((a, i) => (a === "--license-key-file" ? [process.argv[i + 1]] : []));
    for (const keyFile of keyFiles) keyArgs.push(...readFileSync(keyFile, "utf8").split(/\r?\n/).filter((l) => l.trim()));
    const licenseKeys = keyArgs.length ? parseLicenseKeys(keyArgs) : undefined;
    const result = buildLiteRelease({ version, out: arg("out"), licenseKeys, target: arg("target") ?? "linux-x64-gnu", skipBuild: process.argv.includes("--skip-build") });
    console.log(`release Lite ${version} (${result.target}): ${result.files} fișiere`);
    console.log(`  ${path.relative(ROOT, result.zip)}`);
    for (const n of result.natives) console.log(`  binar nativ: ${n}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
