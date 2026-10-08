import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readZip } from "@gcs/plugin-sdk/zip";
import { beforeEach, describe, expect, it } from "vitest";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { buildPluginPackage, cs16Config, cs2Config, installNote, packageSiteUrl, readPluginRelease, RELEASE_FILES } from "./package";
import { parseBridgeKey, signBridgeRequest } from "./signing";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const CFG = `// configul\ngcs_url "https://comunitate.exemplu.ro"\ngcs_key ""\ngcs_allow_manage 1\n`;
const JSON_CFG = `{\n  "Url": "",\n  "Key": "",\n  "AllowManage": true,\n  "ConfigVersion": 1\n}\n`;

/** Un release fals (binare false, aceleași nume ca pasul de release), cu manifestul calculat. */
function fakeRelease(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gcs-release-"));
  const content: Record<string, Record<string, string>> = {
    cs16: { "gcs_bridge.amxx": "AMXX-BINAR", "gcs_bridge.sma": "// sursa", "gcs_bridge.inc": "// inc", "gcs_bridge.cfg": CFG, LICENSE: "GPL" },
    cs2: { "GcsBridge.dll": "MZ-DLL", "GcsBridge.json": JSON_CFG, LICENSE: "MIT" },
  };
  const plugins: Record<string, unknown> = {};
  for (const [game, files] of Object.entries(content)) {
    mkdirSync(path.join(dir, game));
    for (const [name, data] of Object.entries(files)) writeFileSync(path.join(dir, game, name), data);
    plugins[game] = { id: `gcs-${game === "cs16" ? "amxx" : "cs2"}/1.1.0`, version: "1.1.0", sourcesSha256: "0".repeat(64), files: Object.fromEntries(Object.entries(files).map(([n, d]) => [n, sha(d)])) };
  }
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ version: "1.1.0", builtAt: "2026-10-08T00:00:00Z", tools: {}, plugins }));
  return dir;
}

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
  w.site.releaseDir = fakeRelease();
});

describe("pachetele pluginului (plugin-v2 §4–6)", () => {
  it("release-ul se verifică: fiecare fișier are sha256-ul din manifest; un fișier schimbat sau lipsă → refuzat", () => {
    const dir = fakeRelease();
    expect(readPluginRelease(dir).manifest.version).toBe("1.1.0");
    writeFileSync(path.join(dir, "cs2", "GcsBridge.dll"), "ALT BINAR");
    expect(() => readPluginRelease(dir)).toThrow();
    expect(() => readPluginRelease(path.join(dir, "nu-exista"))).toThrow();
    expect(RELEASE_FILES.cs2).not.toContain("GcsBridge.pdb");
  });

  it("pachetul unui server CS 1.6: o cheie nouă (jurnal, sursa package), configul completat, încărcarea automată, sursa și licența", async () => {
    const server = await w.bridgeServer({ game: "cs16" });
    const out = await w.bridge.packages.forServer(w.root, server.id);
    expect(out.filename).toMatch(/^gcs-bridge-cs16-server-\d+\.zip$/);
    const files = readZip(out.bytes);
    expect([...files.keys()].sort()).toEqual([
      "INSTALARE.txt",
      "LICENSE.txt",
      "addons/amxmodx/configs/gcs_bridge.cfg",
      "addons/amxmodx/configs/plugins-gcs.ini",
      "addons/amxmodx/plugins/gcs_bridge.amxx",
      "addons/amxmodx/scripting/gcs_bridge.sma",
      "addons/amxmodx/scripting/include/gcs_bridge.inc",
    ]);
    expect(files.get("addons/amxmodx/plugins/gcs_bridge.amxx")!.toString()).toBe("AMXX-BINAR");
    expect(files.get("addons/amxmodx/configs/plugins-gcs.ini")!.toString()).toContain("gcs_bridge.amxx");
    const cfg = files.get("addons/amxmodx/configs/gcs_bridge.cfg")!.toString();
    expect(cfg).toContain('gcs_url "https://comunitate.gcs.test"');
    const token = /gcs_key "([^"]+)"/.exec(cfg)![1]!;
    expect(parseBridgeKey(token)).not.toBeNull();
    expect(cfg).toContain("gcs_allow_manage 1");

    // Cheia e nouă, a acestui server, în jurnal cu eticheta și sursa; secretul nu e nicăieri altundeva.
    const keys = await w.bridge.keys.list(w.root, server.id);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatchObject({ keyId: parseBridgeKey(token)!.keyId, label: expect.stringMatching(/^Pachet descărcat \d{4}-\d{2}-\d{2}$/), active: true });
    const audit = await w.db.auditLog.findFirstOrThrow({ where: { action: "servers.key.create" }, orderBy: { createdAt: "desc" } });
    expect(audit).toMatchObject({ actorId: w.root.userId, after: expect.objectContaining({ source: "package" }) });
    expect(JSON.stringify(audit)).not.toContain(parseBridgeKey(token)!.secret);

    // Cheia din arhivă merge pe protocol (zero editare: încarcă, repornește, gata).
    const body = JSON.stringify({ plugin: "gcs-amxx/1.1.0", map: "de_dust2", players: [] });
    const h = Object.fromEntries(Object.entries(signBridgeRequest({ token, method: "POST", path: "/heartbeat", body, timestamp: Math.floor(w.clock.now / 1000), alg: "sha256-env" })).map(([k, v]) => [k.toLowerCase(), v]));
    expect((await w.bridge.api.handle({ method: "POST", path: "/heartbeat", header: (n) => h[n.toLowerCase()] ?? null, body, ip: "198.51.100.1" })).status).toBe(200);

    const note = files.get("INSTALARE.txt")!.toString();
    expect(note).toContain("DOAR COLECTEAZĂ DATE");
    expect(note).toContain("Instalarea în 3 pași");
    expect(note).toContain("Module opționale (oprite implicit)");
    expect(note).not.toContain(token);
  });

  it("pachetul unui server CS2: DLL-ul (fără .pdb) și configul JSON completat", async () => {
    const server = await w.bridgeServer({ game: "cs2" });
    const files = readZip((await w.bridge.packages.forServer(w.root, server.id)).bytes);
    expect([...files.keys()].sort()).toEqual(["INSTALARE.txt", "LICENSE.txt", "addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json", "addons/counterstrikesharp/plugins/GcsBridge/GcsBridge.dll"]);
    const config = JSON.parse(files.get("addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json")!.toString()) as Record<string, unknown>;
    expect(config).toMatchObject({ Url: "https://comunitate.gcs.test", AllowManage: true, ConfigVersion: 1 });
    expect(parseBridgeKey(config.Key as string)).not.toBeNull();
  });

  it("pachetul general: adresa site-ului, fără cheie (nicio cheie creată); nota cere aprobarea în ACP", async () => {
    const out = await w.bridge.packages.general(w.root, "cs16");
    expect(out.filename).toBe("gcs-bridge-cs16-general.zip");
    const files = readZip(out.bytes);
    expect(files.get("addons/amxmodx/configs/gcs_bridge.cfg")!.toString()).toContain('gcs_key ""');
    expect(files.get("addons/amxmodx/configs/gcs_bridge.cfg")!.toString()).toContain('gcs_url "https://comunitate.gcs.test"');
    expect(files.get("INSTALARE.txt")!.toString()).toContain("Servere noi detectate");
    expect(await w.db.gameServerKey.count()).toBe(0);
    const cs2 = readZip((await w.bridge.packages.general(w.root, "cs2")).bytes);
    expect(JSON.parse(cs2.get("addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json")!.toString())).toMatchObject({ Url: "https://comunitate.gcs.test", Key: "" });
  });

  it("dreptul (ca la chei), limita de 10 pe oră, jocurile fără punte, adresa invalidă, release-ul lipsă", async () => {
    const server = await w.bridgeServer({ game: "cs16" });
    await expect(w.bridge.packages.forServer(w.member, server.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(w.bridge.packages.general(w.member, "cs16")).rejects.toMatchObject({ code: "forbidden" });
    const mc = await w.addServer({ game: "minecraft", port: 25565 });
    await expect(w.bridge.packages.forServer(w.root, mc.id)).rejects.toMatchObject({ fields: { game: "unsupported_game" } });
    await expect(w.bridge.packages.general(w.root, "minecraft")).rejects.toMatchObject({ fields: { game: "unsupported_game" } });
    w.site.url = 'https://x.test/"; quit';
    await expect(w.bridge.packages.general(w.root, "cs16")).rejects.toMatchObject({ fields: { siteUrl: "invalid" } });
    w.site.url = "https://comunitate.gcs.test/";
    w.site.releaseDir = path.join(os.tmpdir(), "gcs-nu-exista");
    await expect(w.bridge.packages.general(w.root, "cs16")).rejects.toMatchObject({ fields: { release: "missing" } });
    w.site.releaseDir = fakeRelease();
    // 4 cereri numărate deja (limita se consumă după drept, înaintea celorlalte verificări): încă 6 până la 10.
    for (let i = 0; i < 6; i++) await w.bridge.packages.general(w.root, "cs16");
    await expect(w.bridge.packages.general(w.root, "cs16")).rejects.toMatchObject({ code: "rate_limited" });
    // Doar cheia serverului de test: refuzurile nu au creat chei.
    expect(await w.db.gameServerKey.count()).toBe(1);
  });

  it("configurile și nota: doar liniile adresei și cheii se schimbă; nota generică cere adresa; trei pași în toate", () => {
    expect(cs16Config(CFG, "https://a.test", "gcs1.x")).toBe(`// configul\ngcs_url "https://a.test"\ngcs_key "gcs1.x"\ngcs_allow_manage 1\n`);
    expect(JSON.parse(cs2Config(JSON_CFG, null, null))).toEqual({ Url: "https://adresa-comunitatii", Key: "", AllowManage: true, ConfigVersion: 1 });
    expect(packageSiteUrl(" https://site.test/// ")).toBe("https://site.test");
    expect(() => packageSiteUrl("ftp://site.test")).toThrow();
    for (const game of ["cs16", "cs2"] as const) {
      for (const variant of ["server", "general", "generic"] as const) {
        const note = installNote(game, variant, { version: "1.1.0", url: variant === "generic" ? null : "https://site.test" });
        expect(note.match(/^\d\. /gm)).toEqual(["1. ", "2. ", "3. "]);
      }
    }
    expect(installNote("cs16", "generic", { version: "1.1.0", url: null })).toContain("Scrie adresa site-ului");
    const zip = readZip(buildPluginPackage(readPluginRelease(fakeRelease()), "cs16", "generic", { url: null, key: null }));
    expect(zip.get("addons/amxmodx/configs/gcs_bridge.cfg")!.toString()).toContain('gcs_url "https://adresa-comunitatii"');
  });
});
