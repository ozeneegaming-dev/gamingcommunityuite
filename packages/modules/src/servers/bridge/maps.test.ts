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
    expect(await w.bridge.maps.image("cs2", "de_inferno")).toEqual({ url: "/api/servers/maps/art/cs2", generic: true });
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

  it("șablonul de adresă: jobul aduce imaginile lipsă; un eșec se reîncearcă după 1 h × 2^încercări", async () => {
    await w.bridge.maps.seen("cs2", "de_dust2");
    await w.bridge.maps.seen("cs2", "de_train");
    expect(await w.bridge.maps.fetchDue()).toEqual({ fetched: 0, failed: 0 });
    await expect(w.settings.set("servers.map_template_cs2", "ftp://x/{map}.jpg", w.root)).rejects.toMatchObject({ fields: { "servers.map_template_cs2": "invalid_map_template" } });
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
    expect((await w.bridge.maps.image("cs2", "de_dust2")).generic).toBe(false);
    // Un șablon schimbat reîncearcă hărțile fără imagine.
    await w.settings.set("servers.map_template_cs2", "https://alt.exemplu.ro/{map}.png", w.root);
    expect((await w.db.gameMap.findFirstOrThrow({ where: { name: "de_train" } })).attempts).toBe(0);
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
