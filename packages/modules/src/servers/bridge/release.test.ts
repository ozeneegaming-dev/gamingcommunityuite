import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileSha256, RELEASE_LAYOUT, sourcesSha256, sourceVersions } from "../../../../../servers-plugins/release.mjs";
import { readPluginRelease, RELEASE_FILES, type GcsReleaseManifest } from "./package";

/**
 * Release-ul pluginurilor din depozit (specul 2026-10-08-servere-plugin-v2 §6): binarele puse în pachetele din ACP sunt
 * cele din manifest, compilate din sursele curente. O sursă schimbată fără un release nou (`servers-plugins/release.ps1`
 * / `release.sh`) face testul roșu, ca un binar vechi să nu ajungă pe servere.
 */
const root = path.resolve(__dirname, "../../../../../servers-plugins");
const dir = path.join(root, "release");
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as GcsReleaseManifest;

describe("release-ul pluginurilor (plugin-v2 §6)", () => {
  it("fiecare fișier are sha256-ul din manifest (și site-ul îl citește verificat)", () => {
    for (const game of ["cs16", "cs2"] as const) {
      expect(Object.keys(manifest.plugins[game].files).sort()).toEqual([...RELEASE_FILES[game]].sort());
      for (const [name, sha] of Object.entries(manifest.plugins[game].files)) expect(fileSha256(readFileSync(path.join(dir, game, name))), `${game}/${name}`).toBe(sha);
    }
    expect(() => readPluginRelease(dir)).not.toThrow();
  });

  it("versiunea din manifest e cea din surse (.sma, .csproj, BridgeClient.cs)", () => {
    const v = sourceVersions(root);
    expect(manifest.plugins.cs16).toMatchObject({ version: v.cs16.version, id: v.cs16.id });
    expect(manifest.plugins.cs2).toMatchObject({ version: v.cs2.version, id: v.cs2.id });
    expect(v.cs2.clientVersion).toBe(v.cs2.version);
    expect(manifest.version).toBe(v.cs16.version);
  });

  it("binarele sunt compilate din sursele curente (hash-ul surselor), iar sursele / configurile copiate sunt identice", () => {
    expect(manifest.plugins.cs16.sourcesSha256, "sursele AMX Mod X s-au schimbat: rulează servers-plugins/release.ps1").toBe(sourcesSha256(root, "cs16"));
    expect(manifest.plugins.cs2.sourcesSha256, "sursele CS2 s-au schimbat: rulează servers-plugins/release.ps1").toBe(sourcesSha256(root, "cs2"));
    for (const game of ["cs16", "cs2"] as const) {
      for (const [name, rel] of Object.entries(RELEASE_LAYOUT[game])) {
        if (/\.(amxx|dll)$/.test(name)) continue;
        expect(readFileSync(path.join(dir, game, name)).equals(readFileSync(path.join(root, rel))), `${game}/${name}`).toBe(true);
      }
    }
  });

  it("binarele sunt mici și fără căile locale ale mașinii de build; fără .pdb", () => {
    const dll = readFileSync(path.join(dir, "cs2", "GcsBridge.dll"));
    const amxx = readFileSync(path.join(dir, "cs16", "gcs_bridge.amxx"));
    expect(dll.length).toBeLessThan(512 * 1024);
    expect(amxx.length).toBeLessThan(512 * 1024);
    for (const bin of [dll, amxx]) expect(bin.toString("latin1")).not.toMatch(/[A-Za-z]:\\(Users|Desktop)|\/home\/|\.pdb/i);
    expect(dll.subarray(0, 2).toString("latin1")).toBe("MZ");
  });
});
