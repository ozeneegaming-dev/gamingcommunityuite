import { GcsBlockedFetch, safeFetchBuffer } from "@gcs/core";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { mapArtSvg } from "./mapArt";
import { mapNameFromFile } from "./maps";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

const png = () => sharp({ create: { width: 64, height: 36, channels: 3, background: "#336699" } }).png().toBuffer();

describe("hărțile (§13)", () => {
  it("arta generică: SVG original, fără text, imagini externe sau scripturi; o paletă pe joc", () => {
    const svg = mapArtSvg("cs16");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<text|<image|<script|href=|url\(http/i);
    expect(mapArtSvg("cs2")).not.toBe(svg);
    expect(mapArtSvg("necunoscut")).toContain("<svg");
  });

  it("numele hărții din fișier", () => {
    expect(mapNameFromFile("de_dust2.jpg")).toBe("de_dust2");
    expect(mapNameFromFile("C:\\poze\\AIM_Map.v2.PNG")).toBe("aim_map.v2");
    expect(mapNameFromFile("../../etc/passwd")).toBe("passwd");
    expect(mapNameFromFile("hartă cu spații.jpg")).toBeNull();
  });

  it("catalogul: hărțile văzute; imaginea lipsă = arta generică; încărcarea în masă din ACP", async () => {
    await w.bridge.maps.seen("cs2", "de_inferno");
    await w.bridge.maps.seen("cs2", "DE_INFERNO");
    await w.bridge.maps.seen("minecraft", "lume");
    expect(await w.bridge.maps.image("cs2", "de_inferno")).toEqual({ url: "/api/servers/maps/art/cs2", generic: true, kind: "art", external: false, fallback: "/api/servers/maps/art/cs2" });
    const res = await w.bridge.maps.upload(w.root, "cs2", [
      { name: "de_inferno.png", bytes: await png() },
      { name: "de_nuke.png", bytes: await png() },
      { name: "rau.png", bytes: Buffer.from("nu e o imagine") },
      { name: "spațiu greșit.png", bytes: await png() },
    ]);
    expect(res.saved).toEqual(["de_inferno", "de_nuke"]);
    expect(res.errors.map((e) => e.error)).toEqual(["unsupported_type", "invalid_map_name"]);
    const image = await w.bridge.maps.image("cs2", "de_inferno");
    expect(image.generic).toBe(false);
    const att = await w.db.attachment.findUniqueOrThrow({ where: { id: image.url.replace("/files/", "") } });
    expect(att).toMatchObject({ contentType: "servers.map", mime: "image/webp" });
    // O imagine nouă o înlocuiește pe cea veche (și fișierul ei).
    await w.bridge.maps.upload(w.root, "cs2", [{ name: "de_inferno.png", bytes: await png() }]);
    expect(await w.db.attachment.count({ where: { contentType: "servers.map" } })).toBe(2);
    await expect(w.bridge.maps.upload(w.member, "cs2", [{ name: "x.png", bytes: await png() }])).rejects.toMatchObject({ code: "forbidden" });
    expect((await w.bridge.maps.list(w.root, { game: "cs2" })).items.map((m) => m.name)).toEqual(["de_inferno", "de_nuke"]);
  });

  it("modul `copy`: jobul aduce imaginile lipsă; un eșec se reîncearcă după 1 h × 2^încercări", async () => {
    await w.bridge.maps.seen("cs2", "de_dust2");
    await w.bridge.maps.seen("cs2", "de_train");
    expect(await w.bridge.maps.fetchDue()).toEqual({ fetched: 0, failed: 0 });
    await expect(w.settings.set("servers.map_template_cs2", "ftp://x/{map}.jpg", w.root)).rejects.toMatchObject({ fields: { "servers.map_template_cs2": "map_template_https" } });
    await expect(w.settings.set("servers.map_mode_cs2", "altceva", w.root)).rejects.toMatchObject({ fields: { "servers.map_mode_cs2": "invalid_choice" } });
    await w.settings.set("servers.map_mode_cs2", "copy", w.root);
    await w.settings.set("servers.map_template_cs2", "https://imagini.exemplu.ro/cs/{map}.jpg", w.root);
    w.remote.set("https://imagini.exemplu.ro/cs/de_dust2.jpg", { bytes: await png(), contentType: "image/png", finalUrl: "https://imagini.exemplu.ro/cs/de_dust2.jpg" });
    w.remote.set("https://imagini.exemplu.ro/cs/de_train.jpg", new GcsBlockedFetch("blocked_address"));
    expect(await w.bridge.maps.fetchDue()).toEqual({ fetched: 1, failed: 1 });
    const train = await w.db.gameMap.findFirstOrThrow({ where: { name: "de_train" } });
    expect(train).toMatchObject({ attempts: 1, fetchError: "blocked_address", nextFetchAt: new Date(w.clock.now + 3_600_000) });
    expect(await w.bridge.maps.fetchDue()).toEqual({ fetched: 0, failed: 0 });
    w.clock.now += 3_600_000;
    await w.bridge.maps.fetchDue();
    expect((await w.db.gameMap.findFirstOrThrow({ where: { name: "de_train" } })).nextFetchAt).toEqual(new Date(w.clock.now + 2 * 3_600_000));
    expect(await w.bridge.maps.image("cs2", "de_dust2")).toMatchObject({ generic: false, kind: "copy", external: false });
    expect((await w.bridge.maps.image("cs2", "de_dust2")).url).toMatch(/^\/files\//);
    // Fără imagine adusă încă: arta generică (în modul `copy`, browserul nu încarcă nimic din afară).
    expect(await w.bridge.maps.image("cs2", "de_train")).toMatchObject({ kind: "art", url: "/api/servers/maps/art/cs2" });
    // Un șablon schimbat reîncearcă hărțile fără imagine.
    await w.settings.set("servers.map_template_cs2", "https://alt.exemplu.ro/{map}.png", w.root);
    expect((await w.db.gameMap.findFirstOrThrow({ where: { name: "de_train" } })).attempts).toBe(0);
    // Și trecerea în modul `copy` (din `direct`).
    await w.bridge.maps.fetchDue();
    await w.settings.set("servers.map_mode_cs2", "direct", w.root);
    await w.db.gameMap.updateMany({ where: { name: "de_train" }, data: { attempts: 3 } });
    await w.settings.set("servers.map_mode_cs2", "copy", w.root);
    expect((await w.db.gameMap.findFirstOrThrow({ where: { name: "de_train" } })).attempts).toBe(0);
  });

  it("modul `direct` (implicit): browserul încarcă imaginea de la adresă; nimic nu se descarcă sau stochează", async () => {
    await w.bridge.maps.seen("cs16", "de_dust2");
    expect(await w.settings.get("servers.map_mode_cs16")).toBe("direct");
    expect(await w.settings.get("servers.map_template_cs16")).toBe("");
    // Fără șablon: arta generică.
    expect(await w.bridge.maps.image("cs16", "de_dust2")).toMatchObject({ kind: "art", generic: true });
    await w.settings.set("servers.map_template_cs16", "https://exemplu.com/harti/{map}.jpg", w.root);
    expect(await w.bridge.maps.image("cs16", "de_dust2")).toEqual({ url: "https://exemplu.com/harti/de_dust2.jpg", generic: false, kind: "direct", external: true, fallback: "/api/servers/maps/art/cs16" });
    // Și pentru o hartă care nu e (încă) în catalog; numele e validat și codat.
    expect((await w.bridge.maps.image("cs16", "AIM_Map.v2")).url).toBe("https://exemplu.com/harti/aim_map.v2.jpg");
    expect(await w.bridge.maps.image("cs16", "../secret")).toMatchObject({ kind: "art" });
    // Jobul nu aduce nimic în modul direct.
    expect(await w.bridge.maps.fetchDue()).toEqual({ fetched: 0, failed: 0 });
    expect(w.fetched).toEqual([]);
    expect(await w.db.attachment.count({ where: { contentType: "servers.map" } })).toBe(0);
    // Lista din ACP arată imaginea directă.
    const [row] = (await w.bridge.maps.list(w.root, { game: "cs16" })).items;
    expect(row?.image).toMatchObject({ kind: "direct", url: "https://exemplu.com/harti/de_dust2.jpg" });
  });

  it("ordinea: imaginea încărcată în ACP > șablonul (direct sau copiat) > arta generică", async () => {
    await w.settings.set("servers.map_mode_cs2", "copy", w.root);
    await w.settings.set("servers.map_template_cs2", "https://exemplu.com/cs2/{map}.jpg", w.root);
    await w.bridge.maps.seen("cs2", "de_copied");
    w.remote.set("https://exemplu.com/cs2/de_copied.jpg", { bytes: await png(), contentType: "image/png", finalUrl: "https://exemplu.com/cs2/de_copied.jpg" });
    expect(await w.bridge.maps.fetchDue()).toEqual({ fetched: 1, failed: 0 });
    await w.bridge.maps.upload(w.root, "cs2", [{ name: "de_uploaded.png", bytes: await png() }]);
    const copy = await w.bridge.maps.images("cs2", ["de_uploaded", "de_copied", "de_new"]);
    expect([...copy.values()].map((i) => i.kind)).toEqual(["upload", "copy", "art"]);
    // În modul direct, adresa externă înlocuiește copia, dar nu imaginea încărcată în ACP.
    await w.settings.set("servers.map_mode_cs2", "direct", w.root);
    const direct = await w.bridge.maps.images("cs2", ["de_uploaded", "de_copied", "de_new"]);
    expect([...direct.values()].map((i) => i.kind)).toEqual(["upload", "direct", "direct"]);
    expect(direct.get("de_new")?.url).toBe("https://exemplu.com/cs2/de_new.jpg");
    // Șablonul golit: copia rămâne mai bună decât arta.
    await w.settings.set("servers.map_template_cs2", "", w.root);
    expect([...(await w.bridge.maps.images("cs2", ["de_uploaded", "de_copied", "de_new"])).values()].map((i) => i.kind)).toEqual(["upload", "copy", "art"]);
  });

  it("CSP: originile șabloanelor directe (din setări), niciodată `*`", async () => {
    expect(await w.bridge.maps.cspImageOrigins()).toEqual([]);
    await w.settings.set("servers.map_template_cs16", "https://img.exemplu.com/cs/{map}.jpg", w.root);
    await w.settings.set("servers.map_template_cs2", "https://img.exemplu.com/cs2/{map}.jpg", w.root);
    expect(await w.bridge.maps.cspImageOrigins()).toEqual(["https://img.exemplu.com"]);
    await w.settings.set("servers.map_template_cs2", "https://alt.exemplu.com:8443/{map}.png", w.root);
    expect(await w.bridge.maps.cspImageOrigins()).toEqual(["https://alt.exemplu.com:8443", "https://img.exemplu.com"]);
    // Modul `copy`: imaginile vin de pe site, deci originea lui nu mai trebuie permisă.
    await w.settings.set("servers.map_mode_cs16", "copy", w.root);
    expect(await w.bridge.maps.cspImageOrigins()).toEqual(["https://alt.exemplu.com:8443"]);
  });

  it("descărcarea gardată refuză adresele interne și porturile neobișnuite (SSRF)", async () => {
    const opts = { maxBytes: 1024, timeoutMs: 2000, ports: [80, 443] };
    await expect(safeFetchBuffer("http://127.0.0.1/de_dust2.jpg", opts)).rejects.toMatchObject({ reason: "blocked_address" });
    await expect(safeFetchBuffer("http://[::1]/de_dust2.jpg", opts)).rejects.toMatchObject({ reason: "blocked_address" });
    await expect(safeFetchBuffer("http://10.0.0.5/a.jpg", opts)).rejects.toMatchObject({ reason: "blocked_address" });
    await expect(safeFetchBuffer("https://imagini.exemplu.ro:8443/a.jpg", opts)).rejects.toMatchObject({ reason: "port" });
    await expect(safeFetchBuffer("file:///etc/passwd", opts)).rejects.toMatchObject({ reason: "protocol" });
    const lookup = ((_h: string, _o: unknown, cb: (e: Error | null, a: { address: string; family: number }[]) => void) => cb(null, [{ address: "192.168.1.10", family: 4 }])) as never;
    await expect(safeFetchBuffer("http://rebinding.exemplu.ro/a.jpg", opts, { lookup })).rejects.toMatchObject({ reason: "blocked_address" });
  });
});
