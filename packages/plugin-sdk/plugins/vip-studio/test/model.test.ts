import { describe, expect, test } from "vitest";
import { bannerLook, nameLook, vars } from "../src/html";
import { LEGACY_NAME_MAP, LEGACY_NAME_STYLES } from "../src/presets";
import { nameFromFile, EFFECTS, inkFor, mediaIdOf, mediaIdsOf, mediaUrl, parseItemData, plainText, youtubeId, type NameStyleData } from "../src/model";
import { ART_KEYS, defaultPresets } from "../src/presets";
import { FRAME_ART } from "../art/frames";
import { SCENES } from "../art/scenes";
import { WEAPON_ART } from "../art/weapons";

const A = "/plugins/gcs.vip_studio/assets";
const M = "/plugins/gcs.vip_studio/media";

describe("catalogul: validarea datelor", () => {
  test("toate presetările sunt valide, cu chei unice pe tip, și au desen", () => {
    const presets = defaultPresets();
    for (const p of presets) expect([p.kind, p.key, parseItemData(p.kind, p.data).ok]).toEqual([p.kind, p.key, true]);
    const keys = presets.map((p) => `${p.kind}/${p.key}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(presets.filter((p) => p.kind === "name_style").length).toBeGreaterThanOrEqual(40);
    // Stilurile de nume au categorii; cheile catalogului nou nu se suprapun cu cele vechi (actualizarea le înlocuiește).
    expect(presets.filter((p) => p.kind === "name_style").every((p) => p.category)).toBe(true);
    const legacy = new Set(LEGACY_NAME_STYLES.map((s) => s.key));
    expect(presets.filter((p) => p.kind === "name_style" && legacy.has(p.key))).toEqual([]);
    // Fiecare stil vechi are un înlocuitor existent.
    for (const s of LEGACY_NAME_STYLES) expect([s.key, keys.includes(`name_style/${LEGACY_NAME_MAP[s.key]?.to}`)]).toEqual([s.key, true]);
    // Efectele folosite sunt toate din lista albă și aproape toate apar în catalog.
    const used = new Set(presets.filter((p) => p.kind === "name_style").map((p) => (p.data as { effect: string }).effect));
    for (const e of used) expect(EFFECTS).toContain(e);
    expect(used.size).toBeGreaterThanOrEqual(30);
    expect(presets.filter((p) => p.kind === "banner").length).toBeGreaterThanOrEqual(60);
    for (const k of ART_KEYS.frames) expect(FRAME_ART.some((a) => a.key === k)).toBe(true);
    for (const k of ART_KEYS.weapons) expect(WEAPON_ART.some((a) => a.key === k)).toBe(true);
    for (const k of [...ART_KEYS.cards, ...ART_KEYS.backgrounds]) expect(SCENES[k]).toBeTypeOf("function");
  });

  test("culorile: doar #RRGGBB; nicio injecție CSS din bannere sau teme", () => {
    const banner = (colors: unknown) => parseItemData("banner", { fill: { colors, angle: 90 } });
    expect(banner(["#ff0044", "#00ff00"])).toEqual({ ok: true, data: { fill: { colors: ["#FF0044", "#00FF00"], angle: 90, animation: "none", speed: "normal" }, text: "#FFFFFF" } });
    expect(banner("#ff0044 #00ff00")).toMatchObject({ ok: true });
    for (const colors of [["red"], ["#fff"], ["#FF0044;}body{display:none"], ["url(x)"], [], Array(6).fill("#000000")]) expect(banner(colors)).toEqual({ ok: false, field: "colors" });
    expect(parseItemData("banner", { fill: { colors: ["#000000"], animation: "spin;position:fixed" } })).toMatchObject({ ok: true, data: { fill: { animation: "none" } } });
    expect(parseItemData("theme", { accent: "var(--x)" })).toEqual({ ok: false, field: "accent" });
    expect(parseItemData("theme", { accent: "#22d3ee", surface: "black" })).toEqual({ ok: true, data: { accent: "#22D3EE", glow: false } });
  });

  test("stilurile de nume: efecte din listă, variante cu chei simple", () => {
    const style = (over: Record<string, unknown>) => parseItemData("name_style", { variants: [{ key: "red", colors: ["#FF0000"] }], ...over });
    expect(style({ effect: "explode" })).toMatchObject({ ok: true, data: { effect: "none" } });
    expect(style({ variants: [{ key: "a b", colors: ["#FF0000"] }] })).toEqual({ ok: false, field: "variants" });
    expect(style({ variants: [{ key: "red", colors: ["#FF0000"] }, { key: "red", colors: ["#00FF00"] }] })).toEqual({ ok: false, field: "variants" });
    expect(style({ variants: [] })).toEqual({ ok: false, field: "variants" });
    expect(style({ variants: [{ key: "red", colors: ["#FF0000"], glow: "red" }] })).toMatchObject({ ok: true, data: { variants: [{ key: "red", colors: ["#FF0000"] }] } });
  });

  test("fișierele: doar ale pluginului, de tipul potrivit", () => {
    expect(mediaUrl(`${A}/frames/ember.png`, "image")).toBe(`${A}/frames/ember.png`);
    expect(mediaUrl(`${M}/ck2l0a1b2c3d4e5f.webp`, "image")).toBe(`${M}/ck2l0a1b2c3d4e5f.webp`);
    expect(mediaUrl(`${M}/ck2l0a1b2c3d4e5f.webm`, "video")).toBe(`${M}/ck2l0a1b2c3d4e5f.webm`);
    for (const bad of ["https://evil.example/a.png", "/plugins/acme.other/assets/a.png", `${A}/../../acme.x/a.png`, `${A}/a.svg`, `${A}/a.png?x`, `${M}/ck2l0a1b2c3d4e5f.mp3`, "javascript:alert(1)"]) {
      expect([bad, mediaUrl(bad, "image")]).toEqual([bad, null]);
    }
    expect(parseItemData("frame", { image: "https://evil.example/f.png" })).toEqual({ ok: false, field: "image" });
    expect(parseItemData("frame", { image: `${A}/frames/x.png`, scale: 999, x: -50 })).toMatchObject({ ok: true, data: { scale: 160, x: -20, y: 0 } });
    expect(parseItemData("background", { image: `${A}/b.webp`, video: "https://evil.example/v.mp4" })).toEqual({ ok: false, field: "video" });
    expect(mediaIdOf(`${M}/ck2l0a1b2c3d4e5f.webp`)).toBe("ck2l0a1b2c3d4e5f");
    expect(mediaIdsOf("background", { image: `${M}/aaaaaaaaaaaa.webp`, video: `${M}/bbbbbbbbbbbb.mp4` })).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });

  test("melodiile: fișier audio sau id YouTube validat", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    for (const bad of ["https://evil.example/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://youtu.be/short", "", "https://youtube.com/watch?v=dQw4w9WgXcQ\"><script>"]) expect([bad, youtubeId(bad)]).toEqual([bad, null]);
    expect(parseItemData("song", { title: "Temă", youtube: "https://youtu.be/dQw4w9WgXcQ" })).toEqual({ ok: true, data: { title: "Temă", artist: "", youtube: "dQw4w9WgXcQ" } });
    expect(parseItemData("song", { title: "Temă" })).toEqual({ ok: false, field: "audio" });
    expect(parseItemData("song", { title: "  ", audio: `${M}/ck2l0a1b2c3d4e5f.mp3` })).toEqual({ ok: false, field: "title" });
  });

  test("textele: fără caractere de control, cu limită", () => {
    expect(plainText(`a${String.fromCharCode(0x202e)}b\n c`, 10)).toBe("a b c");
    expect(plainText("x".repeat(41), 40)).toBeNull();
    expect(inkFor("#FFFFFF")).toBe("#0B0C10");
    expect(inkFor("#111318")).toBe("#FFFFFF");
  });
});

describe("aspectul previzualizărilor", () => {
  test("numele: clase din liste fixe și variabile sigure", () => {
    const d = parseItemData("name_style", { effect: "neon", variants: [{ key: "cyan", colors: ["#22D3EE", "#0E7490"], glow: "#FFFFFF" }], speed: "fast" });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const look = nameLook(d.data as NameStyleData, (d.data as NameStyleData).variants[0]!);
    // Clasele de previzualizare ale GCS (aceleași reguli ca pe site), culorile ca variabile `--nfx-*`.
    expect(look.cls).toBe("gcsp-ns gcs-nfx gcs-nfx--neon gcs-nfx--n2");
    expect(look.style).toBe("--nfx-c1:#22D3EE;--nfx-c2:#0E7490;--nfx-ang:90deg;--nfx-sp:0.55;--nfx-gc:#FFFFFF;--nfx-glow:1");
    // Mai multe culori fără efect = gradient fix; un stil CSS scris de admin primește clasa lui.
    const plain = parseItemData("name_style", { variants: [{ key: "default", colors: ["#FF0000", "#00FF00"] }], bold: false, italic: true });
    if (!plain.ok) throw new Error("invalid");
    expect(nameLook(plain.data as NameStyleData, (plain.data as NameStyleData).variants[0]!).cls).toBe("gcsp-ns gcs-nfx gcs-nfx--gradient gcs-nfx--n2 gcs-nfx--italic gcs-nfx--light");
    const custom = parseItemData("name_style", { variants: [{ key: "default", colors: ["#FFFFFF"] }], custom: true });
    if (!custom.ok) throw new Error("invalid");
    expect(nameLook(custom.data as NameStyleData, (custom.data as NameStyleData).variants[0]!, "flacara_x1").cls).toBe("gcsp-ns gcs-nfx gcs-nfx--none gcs-nfx--n1 gcs-nameStyle--gcs-vip_studio--flacara_x1");
    expect(bannerLook({ fill: { colors: ["#000000"], angle: 90, animation: "none", speed: "normal" }, text: "#FFFFFF", custom: true }, "aur_y2")).toEqual({ cls: "gcsp-pill gcsp-pill--custom gcs-bannerStyle--gcs-vip_studio--aur_y2", style: "" });
  });

  test("numele din fișiere (încărcarea în bloc): fără extensie și sufixe de copie, majuscule pentru coduri", () => {
    expect(nameFromFile("ak47.png", "Armă 1")).toBe("AK47");
    expect(nameFromFile("awp.png", "Armă 1")).toBe("AWP");
    expect(nameFromFile("deagle.png", "Armă 1")).toBe("Deagle");
    expect(nameFromFile("mp5navy.png", "Armă 1")).toBe("MP5NAVY");
    expect(nameFromFile("he_grenade.png", "Armă 1")).toBe("He grenade");
    expect(nameFromFile("0ufCAd8 - Copie.png", "Ramă 1")).toBe("0ufCAd8");
    expect(nameFromFile("rama aurie (2).webp", "Ramă 1")).toBe("Rama aurie");
    expect(nameFromFile("02d111604ea5309ce7dcae5d61cafbb28a61ed57.png", "Ramă 7")).toBe("Ramă 7");
    expect(nameFromFile(undefined, "Ramă 3")).toBe("Ramă 3");
    expect([...nameFromFile(`${"x".repeat(80)}.png`, "R")].length).toBe(40);
  });

  test("datele: amprenta fișierului se păstrează doar ca SHA-256", () => {
    const h = "a".repeat(64);
    expect(parseItemData("frame", { image: `${M}/abcdef123456.webp`, hash: h })).toMatchObject({ ok: true, data: { hash: h } });
    expect(parseItemData("weapon", { icon: `${M}/abcdef123456.webp`, hash: "x" })).toEqual({ ok: true, data: { icon: `${M}/abcdef123456.webp` } });
  });

  test("bannerul: animația ca clasă, culoarea textului din date", () => {
    const look = bannerLook({ fill: { colors: ["#F59E0B", "#B45309"], angle: 135, animation: "shine", speed: "normal" }, text: "#0B0C10" });
    expect(look).toEqual({ cls: "gcsp-pill gcsp-pill--n2 gcsp-pill--shine", style: "--c1:#F59E0B;--c2:#B45309;--ga:135deg;--ink:#0B0C10;--sp:1" });
    expect(vars({ a: 1, b: null, c: "" })).toBe("--a:1");
  });
});
