import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { isShipped } from "../../../scripts/release.mjs";
import { assembleStandalone, liteReleaseFiles, PLATFORM_PACKAGE, pruneEngines, swapNatives } from "../../../scripts/release-lite.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "gcs-release-lite-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

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
  pkg(path.join(store, "@prisma+client@6.19.3", "node_modules", "@prisma", "client"), { name: "@prisma/client", version: "6.19.3" });
  // Legătura pnpm spre o dependență (aceeași versiune de `next`, din alt pachet).
  mkdirSync(path.join(store, "react@19.3.0", "node_modules"), { recursive: true });
  symlinkSync(path.join(store, "next@16.3.8", "node_modules", "next"), path.join(store, "react@19.3.0", "node_modules", "next"), "junction");
  write(path.join(root, "apps", "web", "server.js"), "require('next')");
  write(path.join(root, "apps", "web", ".next", "BUILD_ID"), "abc");
  write(path.join(root, "apps", "web", "e2e", "auth.spec.ts"), "test");
  write(path.join(root, "apps", "web", "lib", "x.test.ts"), "test");
  write(path.join(root, "apps", "web", "lib", "x.ts"), "export {}");
  write(path.join(root, "apps", "web", "tsconfig.json"), "{}");
  mkdirSync(path.join(root, "apps", "web", "node_modules"), { recursive: true });
  symlinkSync(path.join(store, "next@16.3.8", "node_modules", "next"), path.join(root, "apps", "web", "node_modules", "next"), "junction");
  // Un extern Turbopack (`.next/node_modules/<pachet>-<hash>`), legat spre pachetul real.
  mkdirSync(path.join(root, "apps", "web", ".next", "node_modules", "@prisma"), { recursive: true });
  symlinkSync(path.join(store, "@prisma+client@6.19.3", "node_modules", "@prisma", "client"), path.join(root, "apps", "web", ".next", "node_modules", "@prisma", "client-10a2"), "junction");
  write(path.join(root, "packages", "db", "generated", "mysql-client", "query_engine-windows.dll.node"), "dll");
  write(path.join(root, "packages", "db", "generated", "mysql-client", "libquery_engine-debian-openssl-3.0.x.so.node"), "so");
  return root;
}

describe("pachetul ediției Lite", () => {
  const dest = path.join(tmp, "app");

  test("node_modules plat, fără link-uri, fără testele și configurările de dezvoltare", () => {
    assembleStandalone(fakeStandalone(), dest);
    for (const rel of ["node_modules/sharp/package.json", "node_modules/next/package.json", "node_modules/@prisma/client/package.json", "node_modules/.prisma/client/query_engine-windows.dll.node", "apps/web/server.js", "apps/web/lib/x.ts", "apps/web/.next/node_modules/@prisma/client-10a2/package.json"]) {
      expect(existsSync(path.join(dest, rel)), rel).toBe(true);
    }
    for (const rel of ["node_modules/.pnpm", "apps/web/node_modules", "apps/web/e2e/auth.spec.ts", "apps/web/lib/x.test.ts", "apps/web/tsconfig.json"]) {
      expect(existsSync(path.join(dest, rel)), rel).toBe(false);
    }
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
    expect(existsSync(path.join(dest, "packages/db/generated/mysql-client/libquery_engine-rhel-openssl-3.0.x.so.node"))).toBe(true);
  });

  test("fișierele de la rădăcină: app.js, cron.mjs, documentația RO / EN, migrațiile ambelor dialecte, sumele de control", () => {
    const files = liteReleaseFiles(dest, { version: "1.2.3" });
    for (const rel of ["app.js", "cron.mjs", "docs/INSTALL-LITE.md", "docs/INSTALL-LITE.en.md", "EULA.md", "LICENSE", "VERSION", "CHECKSUMS.sha256", "packages/db/prisma/migrations-mysql/20261120300000_base/migration.sql", "packages/db/prisma/migrations/migration_lock.toml"]) {
      expect(files.has(rel), rel).toBe(true);
    }
    expect(files.get("VERSION")!.toString()).toBe("1.2.3\n");
    expect(files.get("CHECKSUMS.sha256")!.toString()).toContain("  app.js\n");
    expect(readFileSync(path.join(__dirname, "../../../lite/app.js"), "utf8")).toContain('require(path.join(root, "apps", "web", "server.js"))');
  });

  test("pachetul VPS nu ia fișierele ediției Lite", () => {
    expect(isShipped("lite/app.js")).toBe(false);
    expect(isShipped("docs/INSTALL-LITE.md")).toBe(false);
    expect(isShipped("scripts/release-lite.mjs")).toBe(false);
  });
});
