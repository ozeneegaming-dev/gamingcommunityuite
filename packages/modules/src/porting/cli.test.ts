import { readPluginZip } from "@gcs/core";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { runPortCli } from "./cli";
import { addonJsonFixture, pluginXmlFixture } from "./fixtures";

const tmp = mkdtempSync(path.join(os.tmpdir(), "gcs-port-cli-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
writeFileSync(path.join(tmp, "demo.zip"), addonJsonFixture());
writeFileSync(path.join(tmp, "shout.xml"), pluginXmlFixture());
writeFileSync(path.join(tmp, "bad.zip"), Buffer.from("nu e o arhivă"));

async function run(...argv: string[]) {
  const lines: string[] = [];
  const code = await runPortCli(argv, { cwd: tmp, log: (l) => lines.push(l) });
  return { code, out: lines.join("\n") };
}

describe("CLI-ul gcs:port", () => {
  test("fără arhivă sau fără confirmarea dreptului: refuză, fără să scrie nimic", async () => {
    expect((await run()).code).toBe(2);
    const noRights = await run("demo.zip");
    expect(noRights.code).toBe(2);
    expect(noRights.out).toContain("--rights=author");
    expect((await run("demo.zip", "--rights=maybe")).code).toBe(2);
    expect(existsSync(path.join(tmp, "ported"))).toBe(false);
  });

  test("scrie folderul rezultatului; nu scrie peste unul existent fără --force", async () => {
    const first = await run("demo.zip", "--rights=author");
    expect(first.code).toBe(0);
    expect(first.out).toContain("Demo Tools (addon-json) → acme.demo 1.2.0");
    const dir = path.join(tmp, "ported", "acme.demo");
    expect(JSON.parse(readFileSync(path.join(dir, "acme.demo", "plugin.json"), "utf8")).key).toBe("acme.demo");
    expect(readPluginZip(readFileSync(path.join(dir, "acme.demo-1.2.0.zip"))).has("server.mjs")).toBe(true);
    expect(existsSync(path.join(dir, "ORIGINAL", "upload", "src", "addons", "Acme", "Demo", "Setup.php"))).toBe(true);
    expect(readFileSync(path.join(dir, "PORTING.md"), "utf8")).toContain("sunt autorul pluginului");
    expect(JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")).rights.basis).toBe("author");
    expect((await run("demo.zip", "--rights=author")).code).toBe(1);
    expect((await run("demo.zip", "--rights=author", "--force", "--locale=en")).code).toBe(0);
    expect(readFileSync(path.join(dir, "PORTING.md"), "utf8")).toContain("I am the plugin's author");
  });

  test("cheia și folderul aleși; avertismentul GPL; arhivă invalidă", async () => {
    const xml = await run("shout.xml", "--rights=license", "--key=acme.shout", "--out=out/shout");
    expect(xml.code).toBe(0);
    expect(xml.out).toContain("licență GPL");
    expect(existsSync(path.join(tmp, "out", "shout", "acme.shout", "server.mjs"))).toBe(true);
    const bad = await run("bad.zip", "--rights=author");
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("unknown_archive");
  });
});
