#!/usr/bin/env node
/**
 * Pachetul ediției Lite (găzduire partajată cu „Setup Node.js App”, cPanel / Plesk): `pnpm release -- --edition lite
 * --license-key-file <cheia publică> [--plugin-key-file <cheia pluginurilor>] [--version 1.2.0] [--out <folder>] [--target linux-x64-gnu|win32-x64] [--skip-build]`.
 *
 * Scrie `dist/release/<versiune>/gcs-lite-<versiune>.zip` (+ `.sha256`). În arhivă, folderul `gcs-lite-<versiune>/`:
 * - `server/`: aplicația Next.js gata construită (`apps/web`, build „standalone”, fără sursele TypeScript), cu
 *   `node_modules` de producție plat (fără link-uri simbolice: arhivele se dezarhivează din File Manager-ul gazdei) și
 *   binarele native ale țintei — implicit **linux-x64 (glibc)**: sharp, argon2 și motoarele Prisma ale ambelor dialecte
 *   pentru OpenSSL 1.0 / 1.1 / 3 (fiecare motor distinct o singură dată: `app.js` face la pornire celelalte nume, vezi
 *   `dedupeEngines`); plus migrațiile PostgreSQL și MySQL (`server/packages/db/prisma/migrations*`). Nimic
 *   din `node_modules` la rădăcină: CloudLinux (NodeJS Selector) nu schimbă versiunea Node.js a unei aplicații care are
 *   `node_modules` în rădăcină. La prima pornire, `app.js` creează lângă ele `config/`, `uploads/`, `plugins/` și
 *   `applications/`;
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
import { assertLicenseKeys, assertPluginKeys, brandingIssues, checksumsFile, keyRewrites, LICENSE_TEXT, parseLicenseKeys, pluginKeysFromArgv, sha256, writeZip } from "./release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "apps", "web");

/**
 * Ținta pachetului: motoarele Prisma și potrivirea pachetelor native (`<nume>-<os>-<cpu>[-<libc>]`). Pe Linux, Prisma 6
 * are doar două motoare distincte (OpenSSL 1.x legat static, glibc ≥ 2.17; OpenSSL 3), publicate sub cinci nume, iar
 * numele cerut depinde de cum își vede gazda sistemul: CloudLinux cu CageFS (Namecheap) ascunde `/etc/os-release` și
 * cere `debian-openssl-1.1.x`, CloudLinux 8 fără CageFS `rhel-openssl-1.1.x`, CloudLinux / AlmaLinux 9
 * `rhel-openssl-3.0.x`, Ubuntu 22+ / Debian 12 `debian-openssl-3.0.x`. Toate numele rămân: arhiva are un singur
 * exemplar din fiecare motor (`dedupeEngines`).
 */
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
  // Sursele aplicației (TypeScript, CSS, configurările de build): sunt compilate în `.next`, serverul nu le citește.
  /^apps\/web\/(app|lib)\//,
  /^apps\/web\/[^/]+\.(ts|tsx|mts|cts)$/,
  /^apps\/web\/postcss\.config\.[cm]?js$/,
  /^apps\/web\/\.next\/types\//,
];

/** Sursele TypeScript rămase în pachet (în afara `node_modules`): release-ul se oprește dacă există. */
export const isShippedSource = (rel) => /\.(ts|tsx|mts|cts)$/.test(rel) && !/\.d\.[cm]?ts$/.test(rel) && !/(^|\/)node_modules\//.test(rel);

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

/** Un motor Prisma („library”): `libquery_engine-<țintă>.so.node`, `query_engine-windows.dll.node`. */
const ENGINE_FILE = /^(?:lib)?query_engine-(.+?)\.(?:so|dll|dylib)\.node$/;

/** Motoarele Prisma: doar cele ale țintei rămân în clienți (ambele dialecte). */
export function pruneEngines(dest, target) {
  const keep = LITE_TARGETS[target].prisma;
  const dirs = [path.join(dest, "node_modules", ".prisma", "client"), path.join(dest, "packages", "db", "generated", "mysql-client")];
  const missing = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) throw new Error(`lipsește clientul Prisma: ${path.relative(dest, dir)}`);
    for (const name of readdirSync(dir)) {
      const m = ENGINE_FILE.exec(name);
      if (m && !keep.includes(m[1])) rmSync(path.join(dir, name));
    }
    for (const t of keep) {
      const file = t === "windows" ? "query_engine-windows.dll.node" : `libquery_engine-${t}.so.node`;
      if (!existsSync(path.join(dir, file))) missing.push(`${path.relative(dest, dir)}/${file}`);
    }
  }
  if (missing.length > 0) throw new Error(`lipsesc motoarele Prisma:\n${missing.join("\n")}`);
  // Clientul MySQL e inclus în bundle-ul Next.js, care caută motorul și în `<folderul curent>/generated/mysql-client`
  // (folderul curent e `apps/web`: `server.js` se mută acolo); celelalte căi ale lui (`/ROOT/…`, cea de build) nu există
  // pe gazdă. Motoarele se mută acolo (o singură copie: fiecare are ~20 MB), schema rămâne în ambele locuri.
  const mysqlClient = path.join(dest, "packages", "db", "generated", "mysql-client");
  const besideServer = path.join(dest, "apps", "web", "generated", "mysql-client");
  mkdirSync(besideServer, { recursive: true });
  for (const name of readdirSync(mysqlClient)) {
    if (/\.(so|dll|dylib)\.node$/.test(name)) {
      cpSync(path.join(mysqlClient, name), path.join(besideServer, name));
      rmSync(path.join(mysqlClient, name));
    } else if (name === "schema.prisma") cpSync(path.join(mysqlClient, name), path.join(besideServer, name));
  }
}

/**
 * Fișierele clienților Prisma pe care serverul nu le încarcă: clienții generați folosesc motorul „library” și cer doar
 * `@prisma/client/runtime/library.js`. Ies WebAssembly-ul pentru edge și pentru celelalte baze (~53 MB), motorul
 * „binary”, varianta React Native și intrările `edge` / `wasm` ale clienților.
 */
export const PRISMA_UNUSED = /^(query_engine_bg|query_compiler_bg|wasm-engine-edge|wasm-compiler-edge|edge|edge-esm|react-native|binary|wasm|wasm-edge-light-loader|wasm-worker-loader)\./;

/** Scoate din clienții Prisma fișierele `PRISMA_UNUSED`. Întoarce câte au ieșit. */
export function slimPrismaClients(dest) {
  const dirs = ["node_modules/@prisma/client/runtime", "node_modules/.prisma/client", "apps/web/generated/mysql-client", "packages/db/generated/mysql-client"];
  let removed = 0;
  for (const rel of dirs) {
    const dir = path.join(dest, rel);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!PRISMA_UNUSED.test(name)) continue;
      rmSync(path.join(dir, name), { recursive: true, force: true });
      removed++;
    }
  }
  if (!existsSync(path.join(dest, "node_modules/@prisma/client/runtime/library.js"))) throw new Error("lipsește @prisma/client/runtime/library.js");
  return removed;
}

/**
 * Externele Turbopack (`.next/node_modules/<pachet>-<hash>`, încărcate de bundle cu `require("<pachet>-<hash>")`) sunt
 * în build-ul standalone link-uri spre pachetul din `node_modules`; copiate cu link-urile rezolvate, pachetul apare de
 * două ori (`@prisma/client`: ~57 MB). Când bundle-ul cere doar pachetul (niciun fișier din el) și pachetul e CommonJS
 * la aceeași versiune, folderul devine un pachet de o linie care îl încarcă pe cel din `node_modules`. Întoarce
 * externele înlocuite.
 */
export function shimTurbopackExternals(dest) {
  const externals = path.join(dest, "apps", "web", ".next", "node_modules");
  const candidates = new Map();
  for (const id of packagesIn(externals)) {
    const ownFile = path.join(externals, id, "package.json");
    if (!existsSync(ownFile)) continue;
    const own = JSON.parse(readFileSync(ownFile, "utf8"));
    const realFile = path.join(dest, "node_modules", own.name ?? "", "package.json");
    if (!own.name || own.name === id || !existsSync(realFile)) continue;
    const real = JSON.parse(readFileSync(realFile, "utf8"));
    if (real.version === own.version && real.type !== "module") candidates.set(id, own);
  }
  const serverDir = path.join(dest, "apps", "web", ".next", "server");
  if (candidates.size > 0 && existsSync(serverDir)) {
    for (const rel of walk(serverDir)) {
      if (!/\.[cm]?js$/.test(rel)) continue;
      const code = readFileSync(path.join(serverDir, rel), "utf8");
      for (const id of candidates.keys()) if (code.includes(`${id}/`)) candidates.delete(id);
    }
  }
  for (const [id, own] of candidates) {
    const dir = path.join(externals, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: id, version: own.version, private: true, main: "index.js" })}\n`);
    writeFileSync(path.join(dir, "index.js"), `module.exports = require(${JSON.stringify(own.name)});\n`);
  }
  return [...candidates.keys()];
}

/** Fișierele de trasare ale build-ului (`*.nft.json`, ~50 MB): Next.js a făcut din ele build-ul standalone, serverul nu le citește. */
export function dropTraceFiles(dest) {
  const next = path.join(dest, "apps", "web", ".next");
  if (!existsSync(next)) return 0;
  const traces = walk(next).filter((rel) => rel.endsWith(".nft.json"));
  for (const rel of traces) rmSync(path.join(next, rel));
  return traces.length;
}

/** Fișierul din `server/` cu motoarele Prisma lăsate în afara arhivei (copii identice), făcute de `app.js` la pornire. */
export const LITE_ENGINES_MANIFEST = "prisma-engines.json";

/**
 * Motoarele Prisma identice (același motor sub numele mai multor ținte și în ambii clienți) intră o singură dată în
 * arhivă. Celelalte căi ajung în `prisma-engines.json` (`links`: cale → motorul păstrat; `engines`: motorul păstrat →
 * sha256; căi relative la `server/`), iar `app.js` le face la pornire, ca legături fizice sau copii.
 */
export function dedupeEngines(dest) {
  const dirs = [path.join(dest, "node_modules", ".prisma", "client"), path.join(dest, "apps", "web", "generated", "mysql-client")];
  const kept = new Map();
  const engines = {};
  const links = {};
  for (const dir of dirs) {
    for (const name of readdirSync(dir).sort()) {
      if (!ENGINE_FILE.test(name)) continue;
      const file = path.join(dir, name);
      const rel = path.relative(dest, file).split(path.sep).join("/");
      const sum = sha256(readFileSync(file));
      if (kept.has(sum)) {
        links[rel] = kept.get(sum);
        rmSync(file);
      } else {
        kept.set(sum, rel);
        engines[rel] = sum;
      }
    }
  }
  if (Object.keys(links).length > 0) writeFileSync(path.join(dest, LITE_ENGINES_MANIFEST), `${JSON.stringify({ engines, links }, null, 2)}\n`);
  return { engines: Object.keys(engines), links: Object.keys(links) };
}

/** Fișierele mari (≥ `minBytes`) cu același conținut în pachet: grupuri de căi. */
export function duplicateFiles(files, minBytes = 1024 * 1024) {
  const bySum = new Map();
  for (const [rel, data] of files) {
    if (data.length < minBytes) continue;
    const sum = sha256(data);
    bySum.set(sum, [...(bySum.get(sum) ?? []), rel]);
  }
  return [...bySum.values()].filter((group) => group.length > 1);
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

/** Folderul din pachet cu serverul și dependențele lui (`app.js` îl pornește de acolo). */
export const LITE_SERVER_DIR = "server";

/** Fișierele pachetului Lite (cale → octeți) pornind de la folderul asamblat, cu fișierele de la rădăcină. */
export function liteReleaseFiles(dest, { version, root = ROOT }) {
  const files = new Map();
  const server = (rel) => `${LITE_SERVER_DIR}/${rel}`;
  for (const rel of walk(dest)) {
    const data = readFileSync(path.join(dest, rel));
    files.set(server(rel), /\.(m?js|cjs|json|prisma|ts)$/.test(rel) ? neutralizeBuildPaths(data, root) : data);
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
    for (const rel of walk(path.join(root, dir))) files.set(server(`${dir}/${rel}`), readFileSync(path.join(root, dir, rel)));
  }
  files.set("VERSION", Buffer.from(`${version}\n`, "utf8"));
  files.set("LICENSE", Buffer.from(LICENSE_TEXT(version), "utf8"));
  for (const required of ["apps/web/server.js", "apps/web/.next/BUILD_ID", "node_modules/next/package.json"].map(server)) {
    if (!files.has(required)) throw new Error(`lipsește din pachet: ${required}`);
  }
  const sources = [...files.keys()].filter(isShippedSource);
  if (sources.length > 0) throw new Error(`surse TypeScript în pachet:\n${sources.slice(0, 20).join("\n")}`);
  files.set("CHECKSUMS.sha256", Buffer.from(checksumsFile(files), "utf8"));
  return files;
}

/** Rulează `fn` cu cheile publice (licență, pluginuri) scrise în surse, ca la build-ul VPS, și restaurează fișierele după. */
function withKeys(keys, fn) {
  const originals = new Map();
  try {
    for (const [rel, rewrite] of Object.entries(keyRewrites(keys))) {
      const file = path.join(ROOT, rel);
      const original = readFileSync(file, "utf8");
      const next = rewrite(original);
      originals.set(file, original);
      writeFileSync(file, next);
    }
    return fn();
  } finally {
    for (const [file, original] of originals) writeFileSync(file, original);
  }
}

/** Construiește pachetul Lite și întoarce căile scrise. */
export function buildLiteRelease({ version, out, licenseKeys, pluginKeys, target = "linux-x64-gnu", skipBuild = false } = {}) {
  if (!version || !/^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(version)) throw new Error(`versiune invalidă: ${version}`);
  assertLicenseKeys(licenseKeys);
  assertPluginKeys(pluginKeys);
  if (!LITE_TARGETS[target]) throw new Error(`țintă necunoscută: ${target}`);
  const outDir = out ?? path.join(ROOT, "dist", "release", version);
  mkdirSync(outDir, { recursive: true });

  if (!skipBuild) {
    // Clienții Prisma cu motoarele țintei (și cel local, pentru build), apoi build-ul cu cheile de licență.
    const targets = ["native", ...LITE_TARGETS[target].prisma].join(",");
    try {
      run(process.execPath, [path.join(ROOT, "packages/db/scripts/generate.mjs")], { env: { ...process.env, GCS_PRISMA_BINARY_TARGETS: targets } });
      withKeys({ licenseKeys, pluginKeys }, () => run("pnpm", ["--filter", "@gcs/web", "exec", "next", "build"], { env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } }));
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
    slimPrismaClients(dest);
    const shims = shimTurbopackExternals(dest);
    dropTraceFiles(dest);
    const engines = dedupeEngines(dest);

    const files = liteReleaseFiles(dest, { version });
    const checked = new Map([...files].map(([rel, data]) => [rel, /\.(m?js|cjs)$/.test(rel) ? Buffer.from(LITE_BRANDING_ALLOW.reduce((s, re) => s.replace(re, ""), data.toString("utf8")), "utf8") : data]));
    const issues = brandingIssues(checked);
    if (issues.length > 0) throw new Error(`garda de branding a găsit nume interzise în pachet:\n${issues.slice(0, 50).join("\n")}`);
    // Un fișier mare de două ori înseamnă o copie rămasă (un link rezolvat, un motor): arhiva crește degeaba.
    const duplicates = duplicateFiles(files);
    if (duplicates.length > 0) throw new Error(`fișiere mari identice în pachet:\n${duplicates.map((group) => group.join(" = ")).join("\n")}`);
    const top = `gcs-lite-${version}`;
    const entries = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rel, data]) => ({ name: `${top}/${rel}`, data }));
    const zip = path.join(outDir, target === "linux-x64-gnu" ? `${top}.zip` : `${top}-${target}.zip`);
    writeFileSync(zip, writeZip(entries));
    writeFileSync(`${zip}.sha256`, `${sha256(readFileSync(zip))}  ${path.basename(zip)}\n`);
    const unpacked = [...files.values()].reduce((sum, data) => sum + data.length, 0);
    return { zip, files: files.size, natives, target, bytes: statSync(zip).size, unpacked, engines, shims };
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
    const pluginKeys = pluginKeysFromArgv(process.argv);
    const result = buildLiteRelease({ version, out: arg("out"), licenseKeys, pluginKeys, target: arg("target") ?? "linux-x64-gnu", skipBuild: process.argv.includes("--skip-build") });
    const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    console.log(`release Lite ${version} (${result.target}): ${result.files} fișiere, arhiva ${mb(result.bytes)}, dezarhivat ${mb(result.unpacked)}`);
    console.log(`  ${path.relative(ROOT, result.zip)}`);
    for (const n of result.natives) console.log(`  binar nativ: ${n}`);
    console.log(`  motoare Prisma: ${result.engines.engines.length} în arhivă, ${result.engines.links.length} făcute de app.js la pornire`);
    for (const s of result.shims) console.log(`  extern Turbopack trimis spre node_modules: ${s}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
