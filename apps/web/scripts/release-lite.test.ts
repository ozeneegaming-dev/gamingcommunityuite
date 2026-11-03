import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { GCS_PREMIUM_APPS } from "@gcs/core";
import { afterAll, describe, expect, test } from "vitest";
import { isShipped } from "../../../scripts/release.mjs";
import {
  assembleStandalone,
  dedupeEngines,
  dropTraceFiles,
  duplicateFiles,
  isShippedSource,
  LITE_ENGINES_MANIFEST,
  LITE_SERVER_DIR,
  LITE_TARGETS,
  liteReleaseFiles,
  PLATFORM_PACKAGE,
  pruneEngines,
  shimTurbopackExternals,
  slimPrismaClients,
  swapNatives,
} from "../../../scripts/release-lite.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "gcs-release-lite-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const APP_JS = path.join(__dirname, "../../../lite/app.js");

/** Mediul unei găzduiri: folderele instalării le alege `app.js`, nu procesul de test. */
function appEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GCS_SECRET: "test" };
  for (const key of ["GCS_CONFIG_DIR", "GCS_UPLOADS_DIR", "GCS_PLUGINS_DIR", "GCS_APPLICATIONS_DIR", "GCS_MIGRATIONS_DIR"]) delete env[key];
  return env;
}

/** Rulează `app.js` ca modul CommonJS, cu un `process` fals (versiunea Node.js) și un `require` care notează ce i se cere. */
function runAppJs(nodeVersion: string) {
  const required: string[] = [];
  let stderr = "";
  let exitCode: number | undefined;
  const fakeProcess = {
    versions: { node: nodeVersion },
    env: {},
    stderr: {
      write: (text: string) => {
        stderr += text;
        return true;
      },
    },
    exit: (code: number) => {
      exitCode = code;
      throw new Error("exit");
    },
  };
  const fakeRequire = (id: string) => {
    required.push(id);
    throw new Error("require");
  };
  const wrapper = vm.runInThisContext(`(function (exports, require, module, __filename, __dirname, process) {${readFileSync(APP_JS, "utf8")}\n})`) as (...args: unknown[]) => void;
  try {
    wrapper({}, fakeRequire, {}, path.join(tmp, "app.js"), tmp, fakeProcess);
  } catch {
    // `process.exit` sau primul `require` opresc rularea.
  }
  return { required, stderr, exitCode };
}

const write = (file: string, content: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const pkg = (dir: string, json: Record<string, unknown>) => write(path.join(dir, "package.json"), JSON.stringify(json));

/** Un build standalone ca al Next.js cu pnpm: pachetele în `.pnpm`, legate prin link-uri (aici, junction-uri / symlink-uri). */
function fakeStandalone(): string {
  const root = path.join(tmp, "standalone");
  const store = path.join(root, "node_modules", ".pnpm");
  pkg(path.join(store, "sharp@0.35.5", "node_modules", "sharp"), { name: "sharp", version: "0.35.5", optionalDependencies: { "@img/sharp-linux-x64": "0.35.5", "@img/sharp-win32-x64": "0.35.5", "@img/sharp-linuxmusl-x64": "0.35.5" } });
  pkg(path.join(store, "@img+sharp-win32-x64@0.35.5", "node_modules", "@img", "sharp-win32-x64"), { name: "@img/sharp-win32-x64", version: "0.35.5" });
  // SWC-ul lui Next (doar pentru build): nicio variantă instalată, deci nu se aduce.
  pkg(path.join(store, "next@16.3.8", "node_modules", "next"), { name: "next", version: "16.3.8", optionalDependencies: { "@next/swc-linux-x64-gnu": "16.3.8", "@next/swc-win32-x64-msvc": "16.3.8" } });
  write(path.join(store, "@prisma+client@6.19.3", "node_modules", ".prisma", "client", "query_engine-windows.dll.node"), "dll");
  write(path.join(store, "@prisma+client@6.19.3", "node_modules", ".prisma", "client", "libquery_engine-debian-openssl-3.0.x.so.node"), "so");
  const prismaClient = path.join(store, "@prisma+client@6.19.3", "node_modules", "@prisma", "client");
  pkg(prismaClient, { name: "@prisma/client", version: "6.19.3", main: "default.js" });
  write(path.join(prismaClient, "default.js"), "module.exports = { client: 'real' };");
  // Runtime-ul clientului: `library.js` (motorul folosit) și variantele edge / WebAssembly / binary, nefolosite.
  for (const name of ["library.js", "query_engine_bg.mysql.wasm-base64.js", "query_compiler_bg.postgresql.js", "binary.js", "edge.js", "wasm-engine-edge.mjs"]) write(path.join(prismaClient, "runtime", name), "//");
  for (const name of ["index.js", "default.js", "edge.js", "wasm.js", "query_engine_bg.wasm", "wasm-worker-loader.mjs"]) write(path.join(store, "@prisma+client@6.19.3", "node_modules", ".prisma", "client", name), "//");
  // Legătura pnpm spre o dependență (aceeași versiune de `next`, din alt pachet).
  mkdirSync(path.join(store, "react@19.3.0", "node_modules"), { recursive: true });
  symlinkSync(path.join(store, "next@16.3.8", "node_modules", "next"), path.join(store, "react@19.3.0", "node_modules", "next"), "junction");
  write(path.join(root, "apps", "web", "server.js"), "require('next')");
  write(path.join(root, "apps", "web", ".next", "BUILD_ID"), "abc");
  write(path.join(root, "apps", "web", "e2e", "auth.spec.ts"), "test");
  write(path.join(root, "apps", "web", "lib", "x.test.ts"), "test");
  write(path.join(root, "apps", "web", "lib", "x.ts"), "export {}");
  write(path.join(root, "apps", "web", "app", "page.tsx"), "export default function Page() {}");
  write(path.join(root, "apps", "web", "app", "globals.css"), "body {}");
  write(path.join(root, "apps", "web", "instrumentation.ts"), "export {}");
  write(path.join(root, "apps", "web", "postcss.config.mjs"), "export default {}");
  write(path.join(root, "apps", "web", "messages", "ro.json"), "{}");
  write(path.join(root, "apps", "web", "package.json"), "{}");
  write(path.join(root, "apps", "web", "tsconfig.json"), "{}");
  mkdirSync(path.join(root, "apps", "web", "node_modules"), { recursive: true });
  symlinkSync(path.join(store, "next@16.3.8", "node_modules", "next"), path.join(root, "apps", "web", "node_modules", "next"), "junction");
  // Un extern Turbopack (`.next/node_modules/<pachet>-<hash>`), legat spre pachetul real.
  mkdirSync(path.join(root, "apps", "web", ".next", "node_modules", "@prisma"), { recursive: true });
  symlinkSync(path.join(store, "@prisma+client@6.19.3", "node_modules", "@prisma", "client"), path.join(root, "apps", "web", ".next", "node_modules", "@prisma", "client-10a2"), "junction");
  // Un extern din care bundle-ul cere și un fișier (`sharp-77ab/lib/…`): rămâne copie întreagă.
  symlinkSync(path.join(store, "sharp@0.35.5", "node_modules", "sharp"), path.join(root, "apps", "web", ".next", "node_modules", "sharp-77ab"), "junction");
  write(path.join(root, "apps", "web", ".next", "server", "chunks", "a.js"), 'e.x("@prisma/client-10a2",()=>require("@prisma/client-10a2"));e.x("sharp-77ab/lib/index.js",()=>require("sharp-77ab/lib/index.js"))');
  write(path.join(root, "apps", "web", ".next", "server", "app", "page.js"), "//");
  write(path.join(root, "apps", "web", ".next", "server", "app", "page.js.nft.json"), '{"files":[]}');
  write(path.join(root, "packages", "db", "generated", "mysql-client", "query_engine-windows.dll.node"), "dll");
  write(path.join(root, "packages", "db", "generated", "mysql-client", "libquery_engine-debian-openssl-3.0.x.so.node"), "so");
  return root;
}

describe("pachetul ediției Lite", () => {
  const dest = path.join(tmp, "app");

  test("node_modules plat, fără link-uri, fără sursele TypeScript, testele și configurările de dezvoltare", () => {
    assembleStandalone(fakeStandalone(), dest);
    for (const rel of ["node_modules/sharp/package.json", "node_modules/next/package.json", "node_modules/@prisma/client/package.json", "node_modules/.prisma/client/query_engine-windows.dll.node", "apps/web/server.js", "apps/web/package.json", "apps/web/messages/ro.json", "apps/web/.next/node_modules/@prisma/client-10a2/package.json"]) {
      expect(existsSync(path.join(dest, rel)), rel).toBe(true);
    }
    for (const rel of ["node_modules/.pnpm", "apps/web/node_modules", "apps/web/e2e/auth.spec.ts", "apps/web/lib", "apps/web/app", "apps/web/instrumentation.ts", "apps/web/postcss.config.mjs", "apps/web/tsconfig.json"]) {
      expect(existsSync(path.join(dest, rel)), rel).toBe(false);
    }
    expect(isShippedSource("server/apps/web/lib/x.ts")).toBe(true);
    expect(isShippedSource("server/apps/web/.next/node_modules/sharp-1/dist/index.d.mts")).toBe(false);
    expect(isShippedSource("server/node_modules/zod/index.ts")).toBe(false);
  });

  test("binarele native: cele ale țintei vin din registru (versiunea cerută), celelalte platforme ies", () => {
    const fetched: string[] = [];
    const fake = (name: string, version: string, modules: string) => {
      fetched.push(`${name}@${version}`);
      pkg(path.join(modules, name), { name, version, ...(name === "@img/sharp-linux-x64" ? { optionalDependencies: { "@img/sharp-libvips-linux-x64": "1.3.0" } } : {}) });
    };
    swapNatives(dest, "linux-x64-gnu", { fetch: fake });
    expect(fetched).toEqual(["@img/sharp-linux-x64@0.35.5", "@img/sharp-libvips-linux-x64@1.3.0"]);
    expect(existsSync(path.join(dest, "node_modules/@img/sharp-win32-x64"))).toBe(false);
    expect(existsSync(path.join(dest, "node_modules/@img/sharp-linuxmusl-x64"))).toBe(false);
    expect(PLATFORM_PACKAGE.test("@node-rs/argon2-linux-x64-gnu")).toBe(true);
    expect(PLATFORM_PACKAGE.test("@img/sharp-linuxmusl-x64")).toBe(true);
    expect(PLATFORM_PACKAGE.test("sharp")).toBe(false);
  });

  test("motoarele Prisma: doar ale țintei; lipsa unuia oprește release-ul", () => {
    expect(() => pruneEngines(dest, "linux-x64-gnu")).toThrow(/rhel-openssl-1.0.x/);
    for (const t of ["debian-openssl-1.1.x", "rhel-openssl-1.0.x", "rhel-openssl-1.1.x", "rhel-openssl-3.0.x"]) {
      write(path.join(dest, "node_modules/.prisma/client", `libquery_engine-${t}.so.node`), "so");
      write(path.join(dest, "packages/db/generated/mysql-client", `libquery_engine-${t}.so.node`), "so");
    }
    pruneEngines(dest, "linux-x64-gnu");
    expect(existsSync(path.join(dest, "node_modules/.prisma/client/query_engine-windows.dll.node"))).toBe(false);
    // Motoarele MySQL stau lângă server (bundle-ul Next.js le caută în `apps/web/generated/mysql-client`), o singură copie.
    expect(existsSync(path.join(dest, "packages/db/generated/mysql-client/libquery_engine-rhel-openssl-3.0.x.so.node"))).toBe(false);
    expect(existsSync(path.join(dest, "apps/web/generated/mysql-client/libquery_engine-rhel-openssl-3.0.x.so.node"))).toBe(true);
    expect(existsSync(path.join(dest, "apps/web/generated/mysql-client/query_engine-windows.dll.node"))).toBe(false);
  });

  test("clienții Prisma: ies WebAssembly-ul edge / al altor baze și motorul binary, rămâne runtime/library.js", () => {
    expect(slimPrismaClients(dest)).toBe(9);
    for (const rel of ["node_modules/@prisma/client/runtime/library.js", "node_modules/.prisma/client/index.js", "node_modules/.prisma/client/default.js"]) {
      expect(existsSync(path.join(dest, rel)), rel).toBe(true);
    }
    expect(readdirSync(path.join(dest, "node_modules/@prisma/client/runtime"))).toEqual(["library.js"]);
    expect(readdirSync(path.join(dest, "node_modules/.prisma/client")).filter((n) => !n.endsWith(".node")).sort()).toEqual(["default.js", "index.js"]);
  });

  test("externele Turbopack: un pachet cerut doar după nume devine o trimitere spre node_modules", () => {
    expect(shimTurbopackExternals(dest)).toEqual(["@prisma/client-10a2"]);
    const shim = path.join(dest, "apps/web/.next/node_modules/@prisma/client-10a2");
    expect(readdirSync(shim).sort()).toEqual(["index.js", "package.json"]);
    // Rezolvarea din bundle urcă până la `node_modules/@prisma/client`: același modul, o singură copie.
    expect(createRequire(path.join(dest, "apps/web/.next/server/chunks/a.js"))("@prisma/client-10a2")).toEqual({ client: "real" });
    // Din `sharp-77ab` bundle-ul cere și un fișier: copia rămâne întreagă.
    expect(JSON.parse(readFileSync(path.join(dest, "apps/web/.next/node_modules/sharp-77ab/package.json"), "utf8")).name).toBe("sharp");
  });

  test("fișierele de trasare (*.nft.json) ies, fișierele serverului rămân", () => {
    expect(dropTraceFiles(dest)).toBe(1);
    expect(existsSync(path.join(dest, "apps/web/.next/server/app/page.js.nft.json"))).toBe(false);
    expect(existsSync(path.join(dest, "apps/web/.next/server/app/page.js"))).toBe(true);
  });

  test("motoarele identice intră o singură dată în arhivă; celelalte nume ajung în prisma-engines.json", () => {
    // Ca în Prisma 6: un motor OpenSSL 1.x (legat static) sub trei nume, unul OpenSSL 3 sub două, în ambii clienți.
    for (const dir of ["node_modules/.prisma/client", "apps/web/generated/mysql-client"]) {
      for (const t of LITE_TARGETS["linux-x64-gnu"].prisma) write(path.join(dest, dir, `libquery_engine-${t}.so.node`), t.endsWith("3.0.x") ? "openssl3" : "openssl1");
    }
    const res = dedupeEngines(dest);
    expect(res.engines).toEqual(["node_modules/.prisma/client/libquery_engine-debian-openssl-1.1.x.so.node", "node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node"]);
    expect(res.links).toHaveLength(8);
    const manifest = JSON.parse(readFileSync(path.join(dest, LITE_ENGINES_MANIFEST), "utf8")) as { engines: Record<string, string>; links: Record<string, string> };
    expect(manifest.links["node_modules/.prisma/client/libquery_engine-rhel-openssl-1.0.x.so.node"]).toBe("node_modules/.prisma/client/libquery_engine-debian-openssl-1.1.x.so.node");
    expect(manifest.links["apps/web/generated/mysql-client/libquery_engine-rhel-openssl-3.0.x.so.node"]).toBe("node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node");
    expect(Object.keys(manifest.engines)).toEqual(res.engines);
    expect(readdirSync(path.join(dest, "apps/web/generated/mysql-client")).filter((n) => n.endsWith(".node"))).toEqual([]);
  });

  test("garda copiilor: fișierele mari identice din pachet ies la iveală", () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 7);
    const files = new Map([
      ["a/engine.node", big],
      ["b/engine.node", Buffer.from(big)],
      ["c/mic.js", Buffer.from("x")],
      ["d/mic.js", Buffer.from("x")],
    ]);
    expect(duplicateFiles(files)).toEqual([["a/engine.node", "b/engine.node"]]);
  });

  test("la rădăcină: app.js, cron.mjs, documentația RO / EN, sumele de control; serverul, dependențele și migrațiile în server/", () => {
    const files = liteReleaseFiles(dest, { version: "1.2.3" });
    for (const rel of ["app.js", "cron.mjs", "docs/INSTALL-LITE.md", "docs/INSTALL-LITE.en.md", "EULA.md", "LICENSE", "VERSION", "CHECKSUMS.sha256", "server/apps/web/server.js", "server/node_modules/next/package.json", "server/packages/db/prisma/migrations-mysql/20261120300000_base/migration.sql", "server/packages/db/prisma/migrations/migration_lock.toml", `server/${LITE_ENGINES_MANIFEST}`]) {
      expect(files.has(rel), rel).toBe(true);
    }
    // CloudLinux (NodeJS Selector) nu schimbă versiunea Node.js cât timp rădăcina aplicației conține `node_modules`.
    expect([...files.keys()].filter((rel) => !rel.startsWith(`${LITE_SERVER_DIR}/`) && /(^|\/)(node_modules|apps|packages)\//.test(rel))).toEqual([]);
    expect(files.get("VERSION")!.toString()).toBe("1.2.3\n");
    expect(files.get("CHECKSUMS.sha256")!.toString()).toContain("  app.js\n");
  });

  test("app.js pornește serverul din server/ (dependențele din server/node_modules) și creează structura instalării", () => {
    const app = path.join(tmp, "lite-app");
    write(path.join(app, "app.js"), readFileSync(APP_JS, "utf8"));
    write(path.join(app, "server", "node_modules", "next", "index.js"), "module.exports = 'next din server/node_modules';");
    write(path.join(app, "server", "apps", "web", "server.js"), "process.stdout.write(require('next') + ' | ' + process.env.GCS_MIGRATIONS_DIR);");
    const res = spawnSync(process.execPath, ["app.js"], { cwd: app, env: appEnv(), encoding: "utf8" });
    expect(res.stderr).toBe("");
    expect(res.stdout).toBe(`next din server/node_modules | ${path.join(app, "server", "packages", "db", "prisma", "migrations")}`);
    for (const dir of ["config", "uploads", "plugins", "applications"]) expect(existsSync(path.join(app, dir)), dir).toBe(true);
  });

  test("app.js mută o instalare cu structura veche (fișierele, pachetele, codul) fără să suprascrie sau să șteargă ceva", () => {
    const app = path.join(tmp, "lite-upgrade");
    write(path.join(app, "app.js"), readFileSync(APP_JS, "utf8"));
    write(path.join(app, "server", "apps", "web", "server.js"), "");
    // Structura pachetului din 2026-10-30: fișierele membrilor și pachetele în config/, codul în rădăcină.
    write(path.join(app, "config", "license.token"), "GCS1.test");
    write(path.join(app, "config", "files", "avatars", "a.png"), "avatar");
    write(path.join(app, "config", "files", "dublu.txt"), "vechi");
    write(path.join(app, "uploads", "dublu.txt"), "nou");
    write(path.join(app, "config", "plugins", "gcs.news_bot", "abc", "plugin.json"), "{}");
    write(path.join(app, "config", "plugins", "gcs.vip_studio", "def", "plugin.json"), "{}");
    write(path.join(app, "apps", "web", "server.js"), "vechi");
    write(path.join(app, "node_modules", "next", "package.json"), "{}");
    write(path.join(app, "packages", "db", "schema.prisma"), "");

    const res = spawnSync(process.execPath, ["app.js"], { cwd: app, env: appEnv(), encoding: "utf8" });
    expect(res.status).toBe(0);
    const read = (rel: string) => readFileSync(path.join(app, rel), "utf8");
    expect(read("uploads/avatars/a.png")).toBe("avatar");
    // Un fișier care există deja în destinație nu se suprascrie: rămâne pe loc și apare în jurnal.
    expect(read("uploads/dublu.txt")).toBe("nou");
    expect(read("config/files/dublu.txt")).toBe("vechi");
    expect(res.stderr).toContain("1 fișiere din structura veche au rămas pe loc");
    expect(read("plugins/gcs.news_bot/abc/plugin.json")).toBe("{}");
    expect(read("applications/gcs.vip_studio/def/plugin.json")).toBe("{}");
    expect(existsSync(path.join(app, "config", "plugins"))).toBe(false);
    expect(read("config/license.token")).toBe("GCS1.test");
    // Codul vechi iese din rădăcină (CloudLinux), dar nu se șterge.
    for (const name of ["node_modules", "apps", "packages"]) {
      expect(existsSync(path.join(app, name)), name).toBe(false);
      expect(existsSync(path.join(app, "old-version", name)), name).toBe(true);
    }
    expect(res.stderr).toContain("old-version/");

    // A doua pornire nu mai are cod vechi de mutat.
    const again = spawnSync(process.execPath, ["app.js"], { cwd: app, env: appEnv(), encoding: "utf8" });
    expect(again.status).toBe(0);
    expect(again.stderr).not.toContain("old-version/");
  });

  test("app.js face la pornire motoarele din prisma-engines.json (legături fizice), apoi le sare până se schimbă lista", () => {
    const app = path.join(tmp, "lite-engines");
    write(path.join(app, "app.js"), readFileSync(APP_JS, "utf8"));
    write(path.join(app, "server", "apps", "web", "server.js"), "");
    const at = (rel: string) => path.join(app, "server", rel);
    const source = "node_modules/.prisma/client/libquery_engine-debian-openssl-1.1.x.so.node";
    const links = {
      "node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node": source,
      "apps/web/generated/mysql-client/libquery_engine-debian-openssl-1.1.x.so.node": source,
    };
    write(at(source), "openssl1");
    const manifest = (sum: string) => write(at(LITE_ENGINES_MANIFEST), JSON.stringify({ engines: { [source]: sum }, links }));
    manifest("a1");
    // Un motor al unei versiuni vechi rămas sub unul dintre nume (actualizare prin suprascriere): se înlocuiește.
    write(at("apps/web/generated/mysql-client/libquery_engine-debian-openssl-1.1.x.so.node"), "vechi");
    const start = () => spawnSync(process.execPath, ["app.js"], { cwd: app, env: appEnv(), encoding: "utf8" });

    expect(start().stderr).toBe("");
    for (const rel of Object.keys(links)) {
      expect(readFileSync(at(rel), "utf8"), rel).toBe("openssl1");
      expect(statSync(at(rel)).ino, rel).toBe(statSync(at(source)).ino);
    }
    expect(statSync(at(source)).nlink).toBe(3);
    expect(readdirSync(at("apps/web/generated/mysql-client"))).toEqual(["libquery_engine-debian-openssl-1.1.x.so.node"]);

    // Marcajul e la zi: pornirile următoare nu mai ating motoarele.
    const one = at("node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node");
    rmSync(one);
    write(one, "neatins");
    expect(start().stderr).toBe("");
    expect(readFileSync(one, "utf8")).toBe("neatins");
    // O listă nouă (alt motor în pachet) le reface.
    manifest("b2");
    expect(start().stderr).toBe("");
    expect(readFileSync(one, "utf8")).toBe("openssl1");
  });

  test("app.js știe pachetele aplicațiilor premium ale aplicației", () => {
    const list = /PREMIUM_APP_PACKAGES = (\[[^\]]*\])/.exec(readFileSync(APP_JS, "utf8"))![1]!;
    expect(JSON.parse(list)).toEqual(GCS_PREMIUM_APPS.map((key) => `gcs.${key}`));
  });

  test("app.js oprește un Node.js sub 20.9 cu un mesaj pe stderr, înaintea oricărui require", () => {
    for (const version of ["14.21.3", "18.20.4", "20.8.1"]) {
      const run = runAppJs(version);
      expect(run.exitCode, version).toBe(1);
      expect(run.required, version).toEqual([]);
      expect(run.stderr).toContain(`[GCS] Node.js ${version} e prea vechi`);
      expect(run.stderr).toContain("Node.js 20.9 sau mai nou");
      expect(run.stderr).toContain(`Node.js ${version} is too old`);
    }
    for (const version of ["20.9.0", "22.11.0", "26.0.0"]) {
      const run = runAppJs(version);
      expect(run.exitCode, version).toBeUndefined();
      expect(run.stderr, version).toBe("");
      expect(run.required[0], version).toBe("node:crypto");
    }
  });

  test("pachetul VPS nu ia fișierele ediției Lite", () => {
    expect(isShipped("lite/app.js")).toBe(false);
    expect(isShipped("docs/INSTALL-LITE.md")).toBe(false);
    expect(isShipped("scripts/release-lite.mjs")).toBe(false);
  });
});
