import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { packPlugin } from "@gcs/plugin-sdk/pack";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { extractPlugin, pluginFilesDir } from "./files";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "gcs-plugin-files-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Un folder de versiune terminat (cu marcaj), cu data dată. */
async function version(base: string, name: string, at: Date): Promise<void> {
  await mkdir(path.join(base, name), { recursive: true });
  await writeFile(path.join(base, name, ".gcs-complete"), "x");
  await utimes(path.join(base, name, ".gcs-complete"), at, at);
}

describe("extractPlugin: curățarea versiunilor vechi", () => {
  test("păstrează versiunea anterioară terminată și folderele temporare ale altor procese; șterge doar ce e sigur vechi", async () => {
    const pkg = packPlugin(new Map<string, Buffer | string>([["plugin.json", "{}"], ["server.mjs", "export default {};"]]), {});
    const sha = createHash("sha256").update(pkg).digest("hex");
    const base = path.join(dataDir, "acme.demo");
    const hour = 60 * 60 * 1000;

    await version(base, "a".repeat(16), new Date(Date.now() - 2 * hour));
    await version(base, "b".repeat(16), new Date(Date.now() - 5 * hour));
    // Alt proces scrie acum noua versiune: folderul lui temporar e mai nou decât versiunea anterioară.
    await mkdir(path.join(base, `${sha.slice(0, 16)}.tmp-999-abcd`), { recursive: true });
    // Un folder temporar abandonat (procesul a căzut acum două ore).
    const stale = path.join(base, `${"c".repeat(16)}.tmp-1-dead`);
    await mkdir(stale, { recursive: true });
    await utimes(stale, new Date(Date.now() - 2 * hour), new Date(Date.now() - 2 * hour));
    // O versiune neterminată (fără marcaj) și un folder străin: nu sunt atinse.
    await mkdir(path.join(base, "d".repeat(16)), { recursive: true });
    await mkdir(path.join(base, "altceva"), { recursive: true });

    const dir = await extractPlugin(dataDir, "acme.demo", sha, pkg);
    expect(dir).toBe(path.join(base, sha.slice(0, 16)));
    expect((await readdir(base)).sort()).toEqual(
      [sha.slice(0, 16), "a".repeat(16), `${sha.slice(0, 16)}.tmp-999-abcd`, "d".repeat(16), "altceva"].sort(),
    );
  });
});

describe("pluginFilesDir: aplicațiile premium separat de pluginuri", () => {
  test("cu folderul aplicațiilor: pachetele aplicațiilor premium acolo, restul în plugins; fără el, totul în plugins", () => {
    const dirs = { plugins: "/gcs/plugins", applications: "/gcs/applications" };
    expect(pluginFilesDir("gcs.vip_studio", dirs)).toBe("/gcs/applications");
    expect(pluginFilesDir("gcs.news_bot", dirs)).toBe("/gcs/plugins");
    expect(pluginFilesDir("acme.vip_studio", dirs)).toBe("/gcs/plugins");
    expect(pluginFilesDir("gcs.vip_studio", { plugins: "/gcs/plugins" })).toBe("/gcs/plugins");
  });
});
