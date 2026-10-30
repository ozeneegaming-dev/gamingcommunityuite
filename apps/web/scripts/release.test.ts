import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPluginZip, verifyPluginSignature } from "@gcs/core";
import { afterAll, describe, expect, test } from "vitest";
import { brandingIssues, buildRelease, checksumsFile, CLIENT_REWRITES, isShipped, keyRewrites, parseLicenseKeys, PLUGIN_KEYS_FILE, pluginKeysFromArgv, sha256, writeZip } from "../../../scripts/release.mjs";
import { signRelease } from "../../../scripts/release-sign.mjs";

const ROOT = path.resolve(__dirname, "../../..");
/** O cheie publică Ed25519 de test (32 de octeți, base64). */
const TEST_LICENSE_PUB = (() => {
  const der = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32).toString("base64");
})();
const tmp = mkdtempSync(path.join(os.tmpdir(), "gcs-release-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("lista de fișiere a pachetului", () => {
  test("intră aplicația și fișierele clientului; nu intră testele, configurările noastre, cheile și uneltele interne", () => {
    for (const rel of ["install.sh", "docker-compose.yml", ".env.example", "docs/INSTALL.md", "EULA.md", "apps/web/app/layout.tsx", "packages/core/src/index.ts", "servers-plugins/release/manifest.json", "gcs"]) {
      expect(isShipped(rel), rel).toBe(true);
    }
    for (const rel of [
      ".git/config",
      "node_modules/x/index.js",
      "apps/web/node_modules/next/package.json",
      ".env",
      ".env.local",
      "docker-compose.override.yml",
      "keys/gcs-2026.pem",
      "apps/web/e2e/forum-v2.spec.ts",
      "packages/core/src/install/license.test.ts",
      "packages/modules/test/world.ts",
      "apps/web/vitest.config.ts",
      "apps/web/playwright.config.ts",
      "docs/superpowers/specs/x.md",
      "gcs-mockups/project/Main.html",
      "gcs-briefs/forum-v2.md",
      "gcs-shots/a.png",
      "tools/blingmodels/a.glb",
      "themes/build.mjs",
      "servers-plugins/cs2/src/Plugin.cs",
      "scripts/runner.ps1",
      "scripts/release.mjs",
      "AGENTS.md",
      ".github/workflows/ci.yml",
    ]) {
      expect(isShipped(rel), rel).toBe(false);
    }
  });

  test("copia clientului: proiectul Docker și pachetul rădăcină se numesc GCS", () => {
    expect(CLIENT_REWRITES["docker-compose.yml"]!("name: altceva\nservices:\n")).toBe("name: gcs\nservices:\n");
    expect(JSON.parse(CLIENT_REWRITES["package.json"]!('{"name":"altceva","private":true}')).name).toBe("gamingcommunitysuite");
  });

  test("sumele de control: `<sha256>  <cale>`, sortate, fără fișierul lor", () => {
    const files = new Map<string, Buffer>([
      ["b.txt", Buffer.from("b")],
      ["a/x.txt", Buffer.from("x")],
      ["CHECKSUMS.sha256", Buffer.from("vechi")],
    ]);
    expect(checksumsFile(files)).toBe(`${sha256("x")}  a/x.txt\n${sha256("b")}  b.txt\n`);
  });

  test("garda de branding: numele vechi al proiectului și alte platforme sunt găsite; adresele IP nu", () => {
    const files = new Map<string, Buffer>([
      ["docs/a.md", Buffer.from("Instalarea Red-Line\nok")],
      ["x.ts", Buffer.from("// limita de IPs pe cont")],
      ["y.css", Buffer.from("/* stil inspirat din xenforo */")],
      ["img.png", Buffer.from("redline")],
      ["chunk.js", Buffer.from("const { lineNumber, isErroredLine } = parsedLine")],
      ["logo.tsx", Buffer.from("<span>RED<span className=\"x\">-</span>LINE</span>")],
    ]);
    expect(brandingIssues(files)).toEqual(["docs/a.md:1: Instalarea Red-Line", "y.css:1: /* stil inspirat din xenforo */", "logo.tsx:1: <span>RED<span className=\"x\">-</span>LINE</span>"]);
  });
});

describe("release-ul (fum): construit, dezarhivat și verificat", () => {
  test(
    "pachetul standard: tar.gz + zip cu sume, conținutul complet, sumele verificate, nimic exclus, brandul GCS",
    () => {
      const out = path.join(tmp, "out");
      const result = buildRelease({ root: ROOT, version: "9.9.9", out, premium: false, licenseKeys: { "test-lic": TEST_LICENSE_PUB }, pluginKeys: { "test-plg": TEST_LICENSE_PUB } });
      for (const file of [result.tarGz, result.zip]) {
        expect(readFileSync(`${file}.sha256`, "utf8")).toBe(`${sha256(readFileSync(file))}  ${path.basename(file)}\n`);
      }

      // Tar-ul se dezarhivează cu `tar`-ul sistemului (arhiva pe stdin: căile Windows nu încurcă `tar`).
      const unpack = path.join(tmp, "unpack");
      mkdirSync(unpack);
      const res = spawnSync("tar", ["-xzf", "-", "-C", "."], { cwd: unpack, input: readFileSync(result.tarGz) });
      expect(res.status, String(res.stderr)).toBe(0);
      const top = path.join(unpack, "gcs-9.9.9");
      const read = (rel: string) => readFileSync(path.join(top, rel));
      expect(read("VERSION").toString()).toBe("9.9.9\n");
      for (const rel of ["install.sh", "docker-compose.yml", ".env.example", "docs/INSTALL.md", "EULA.md", "THIRD-PARTY-NOTICES.md", "LICENSE", "CHECKSUMS.sha256"]) {
        expect(read(rel).length, rel).toBeGreaterThan(0);
      }
      const lines = read("CHECKSUMS.sha256").toString().trim().split("\n");
      expect(lines.length).toBe(result.files - 1);
      for (const line of lines) {
        const [sum, rel] = line.split("  ");
        expect(sha256(read(rel!)), rel).toBe(sum);
        expect(isShipped(rel!), rel).toBe(true);
      }
      expect(read("docker-compose.yml").toString()).toMatch(/^name: gcs$/m);
      // Cheia publică de licență e inclusă în copia clientului (sursele rămân cu lista goală).
      expect(read("packages/core/src/install/license.ts").toString()).toContain(`export const GCS_LICENSE_KEYS: Record<string, string> = {"test-lic":"${TEST_LICENSE_PUB}"};`);
      expect(readFileSync(path.join(ROOT, "packages/core/src/install/license.ts"), "utf8")).toContain("export const GCS_LICENSE_KEYS: Record<string, string> = {};");
      // La fel cheia pluginurilor: pachetele premium semnate sunt de încredere la client fără GCS_PLUGIN_TRUSTED_KEYS.
      expect(read("packages/core/src/plugins/signature.ts").toString()).toContain(`export const MARKETPLACE_PLUGIN_KEYS: Record<string, string> = {"test-plg":"${TEST_LICENSE_PUB}"};`);
      expect(readFileSync(path.join(ROOT, "packages/core/src/plugins/signature.ts"), "utf8")).toContain("export const MARKETPLACE_PLUGIN_KEYS: Record<string, string> = {};");
      expect(brandingIssues(lines.map((l) => l.split("  ")[1]!).map((rel) => [rel, read(rel)] as [string, Buffer]))).toEqual([]);

      // Zip-ul: directorul central are aceleași fișiere (numărul și căile), toate sub `gcs-9.9.9/`.
      const zipBuf = readFileSync(result.zip);
      const eocd = zipBuf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      expect(eocd).toBeGreaterThan(0);
      expect(zipBuf.readUInt16LE(eocd + 10)).toBe(result.files);
      const names: string[] = [];
      for (let at = zipBuf.readUInt32LE(eocd + 16); zipBuf.readUInt32LE(at) === 0x02014b50; ) {
        const nameLen = zipBuf.readUInt16LE(at + 28);
        names.push(zipBuf.subarray(at + 46, at + 46 + nameLen).toString("utf8"));
        at += 46 + nameLen + zipBuf.readUInt16LE(at + 30) + zipBuf.readUInt16LE(at + 32);
      }
      expect(names).toHaveLength(result.files);
      expect(names).toContain("gcs-9.9.9/VERSION");
      expect(names.every((n) => n.startsWith("gcs-9.9.9/"))).toBe(true);
    },
    180_000,
  );
});

describe("cheia publică de licență a release-ului", () => {
  test("fără cheie sau cu o cheie invalidă, release-ul e refuzat (un pachet fără ea ar respinge orice licență)", () => {
    expect(() => buildRelease({ root: ROOT, version: "9.9.8", out: path.join(tmp, "no-key"), premium: false })).toThrow(/cheia publică de licență/);
    expect(() => buildRelease({ root: ROOT, version: "9.9.8", out: path.join(tmp, "bad-key"), premium: false, licenseKeys: { "x y": TEST_LICENSE_PUB } })).toThrow(/cheie de licență invalidă/);
    expect(() => buildRelease({ root: ROOT, version: "9.9.8", out: path.join(tmp, "bad-key2"), premium: false, licenseKeys: { ok: "scurt" } })).toThrow(/cheie de licență invalidă/);
  });
  test("forma din fișierul .pub.txt (`id=base64`) se citește ca hartă", () => {
    expect(parseLicenseKeys([`gcs-lic-2026=${TEST_LICENSE_PUB}`, ` second=${TEST_LICENSE_PUB} `])).toEqual({ "gcs-lic-2026": TEST_LICENSE_PUB, second: TEST_LICENSE_PUB });
  });
});

describe("cheia publică a pluginurilor", () => {
  test("se scrie în lista marketplace-ului doar când e dată; o cheie invalidă e refuzată", () => {
    const source = "a\nexport const MARKETPLACE_PLUGIN_KEYS: Record<string, string> = {};\nb";
    expect(Object.keys(keyRewrites({ licenseKeys: { l: TEST_LICENSE_PUB } }))).toEqual(["packages/core/src/install/license.ts"]);
    const rewrite = keyRewrites({ licenseKeys: { l: TEST_LICENSE_PUB }, pluginKeys: { "gcs-2026": TEST_LICENSE_PUB } })[PLUGIN_KEYS_FILE]!;
    expect(rewrite(source)).toBe(`a\nexport const MARKETPLACE_PLUGIN_KEYS: Record<string, string> = {"gcs-2026":"${TEST_LICENSE_PUB}"};\nb`);
    expect(() => rewrite("fără listă")).toThrow(/cheilor pluginurilor/);
    expect(() => buildRelease({ root: ROOT, version: "9.9.8", out: path.join(tmp, "bad-plg"), premium: false, licenseKeys: { l: TEST_LICENSE_PUB }, pluginKeys: { ok: "scurt" } })).toThrow(/cheie de plugin invalidă/);
  });
  test("din linia de comandă: --plugin-key și --plugin-key-file", () => {
    const file = path.join(tmp, "plugins.pub.txt");
    writeFileSync(file, `gcs-2026=${TEST_LICENSE_PUB}\n`);
    expect(pluginKeysFromArgv(["node", "release.mjs", "--plugin-key", `a=${TEST_LICENSE_PUB}`, "--plugin-key-file", file])).toEqual({ a: TEST_LICENSE_PUB, "gcs-2026": TEST_LICENSE_PUB });
  });
});

describe("semnarea pachetelor premium (cheie de test, generată aici)", () => {
  test(
    "fiecare .gcs primește semnătura Ed25519 în formatul pluginurilor și o sumă nouă; fără cheie → eroare",
    () => {
      const dir = path.join(tmp, "signed");
      mkdirSync(path.join(dir, "premium"), { recursive: true });
      const pkg = path.join(dir, "premium", "gcs.demo-1.0.0.gcs");
      writeFileSync(pkg, writeZip([{ name: "plugin.json", data: Buffer.from('{"key":"gcs.demo"}') }, { name: "server.mjs", data: Buffer.from("export {}") }]));

      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const keyFile = path.join(tmp, "throwaway.pem");
      writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
      expect(() => signRelease({ root: ROOT, dir, key: path.join(tmp, "nu-exista.pem") })).toThrow(/--key/);

      expect(signRelease({ root: ROOT, dir, key: keyFile, keyId: "test-key" })).toEqual([pkg]);
      const files = readPluginZip(readFileSync(pkg));
      expect([...files.keys()].sort()).toEqual(["gcs-signature.json", "plugin.json", "server.mjs"]);
      const trusted = new Map([["test-key", publicKey]]);
      expect(verifyPluginSignature(files, trusted)).toEqual({ status: "signed", keyId: "test-key" });
      expect(readFileSync(`${pkg}.sha256`, "utf8")).toBe(`${sha256(readFileSync(pkg))}  gcs.demo-1.0.0.gcs\n`);
    },
    180_000,
  );
});
