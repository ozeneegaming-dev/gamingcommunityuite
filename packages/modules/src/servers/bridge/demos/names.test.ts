import { describe, expect, it } from "vitest";
import { demoDownloadName, gcsDemoBase, isSafeDemoName, localStampToUtc, parseDemoName, pickDemoFiles, type GcsRemoteDemo } from "./names";

const at = (iso: string) => new Date(iso);
const file = (name: string, modifiedAt: string | null = null, size: number | null = 1000): GcsRemoteDemo => ({ name, size, modifiedAt: modifiedAt ? at(modifiedAt) : null });

/**
 * Numele demo-urilor și potrivirea lor cu un meci (specul 2026-10-08-servere-hltv §4.4): numele GCS, numele HLTV
 * (`<prefix>-<AALLZZhhmm>-<hartă>.dem`), numele cu dată, fusul orar, fereastra meciului și demo-urile împărțite.
 */
describe("numele demo-urilor", () => {
  it("doar nume simple `.dem` (fără căi, fără caractere ciudate, max 200)", () => {
    expect(isSafeDemoName("mix-2610082015-de_mirage.dem")).toBe(true);
    expect(isSafeDemoName("auto0-20261008-201500-1234-de_dust2-GCS_(1).DEM")).toBe(true);
    expect(isSafeDemoName("../etc/passwd.dem")).toBe(false);
    expect(isSafeDemoName("a/b.dem")).toBe(false);
    expect(isSafeDemoName("a\\b.dem")).toBe(false);
    expect(isSafeDemoName("demo.dem.exe")).toBe(false);
    expect(isSafeDemoName(".dem")).toBe(false);
    expect(isSafeDemoName("spa ce.dem")).toBe(false);
    expect(isSafeDemoName(`${"a".repeat(197)}.dem`)).toBe(false);
  });

  it("ora locală din nume → UTC după fusul orar, cu trecerile la ora de vară", () => {
    expect(localStampToUtc(2026, 10, 8, 20, 15, "UTC").toISOString()).toBe("2026-10-08T20:15:00.000Z");
    // București: UTC+3 vara, UTC+2 iarna (ora de vară se termină în ultima duminică din octombrie).
    expect(localStampToUtc(2026, 10, 8, 20, 15, "Europe/Bucharest").toISOString()).toBe("2026-10-08T17:15:00.000Z");
    expect(localStampToUtc(2026, 12, 1, 20, 15, "Europe/Bucharest").toISOString()).toBe("2026-12-01T18:15:00.000Z");
    expect(localStampToUtc(2026, 10, 25, 12, 0, "Europe/Bucharest").toISOString()).toBe("2026-10-25T10:00:00.000Z");
    expect(localStampToUtc(2026, 7, 1, 8, 30, "America/New_York").toISOString()).toBe("2026-07-01T12:30:00.000Z");
  });

  it("numele HLTV: prefixul, data (AALLZZhhmm), harta; numele cu dată (AAAALLZZ-hhmmss) și harta din nume", () => {
    expect(parseDemoName("mix-2610082015-de_mirage.dem", "UTC")).toEqual({ prefix: "mix", startedAt: at("2026-10-08T20:15:00Z"), map: "de_mirage", gcs: null });
    expect(parseDemoName("my-mix-server-2610082015-de_dust2_2x2.dem", "Europe/Bucharest")).toEqual({ prefix: "my-mix-server", startedAt: at("2026-10-08T17:15:00Z"), map: "de_dust2_2x2", gcs: null });
    expect(parseDemoName("auto0-20261008-201530-998877-de_inferno-GCS_Mix.dem", "UTC")).toMatchObject({ startedAt: at("2026-10-08T20:15:30Z"), map: null });
    expect(parseDemoName("20261008_2015_de_nuke.dem", "UTC")).toMatchObject({ startedAt: at("2026-10-08T20:15:00Z") });
    // Fără dată recunoscută, o dată imposibilă sau un nume nesigur → null.
    expect(parseDemoName("demo.dem", "UTC")).toBeNull();
    expect(parseDemoName("mix-2613452015-de_mirage.dem", "UTC")).toBeNull();
    expect(parseDemoName("../mix-2610082015-de_mirage.dem", "UTC")).toBeNull();
  });

  it("numele GCS: `gcs-<externalId>.dem` (modulul CS2) și `gcs-m<id>-…` (rcon-ul HLTV)", () => {
    expect(gcsDemoBase("m-1791460000-1234")).toBe("gcs-m-1791460000-1234");
    expect(gcsDemoBase("abc:def.1")).toBe("gcs-abc_def_1");
    expect(parseDemoName("gcs-m-1791460000-1234.dem", "UTC")).toMatchObject({ gcs: "gcs-m-1791460000-1234" });
    expect(parseDemoName("gcs-m42-2610082015-de_mirage.dem", "UTC")).toMatchObject({ gcs: "gcs-m42", map: "de_mirage", startedAt: at("2026-10-08T20:15:00Z") });
  });

  it("numele descărcării: harta, data meciului, id-ul și partea", () => {
    expect(demoDownloadName({ id: 7, map: "de_mirage", startedAt: at("2026-10-08T23:59:00Z") }, 1, 1)).toBe("de_mirage-2026-10-08-m7.dem");
    expect(demoDownloadName({ id: 7, map: "", startedAt: at("2026-10-08T10:00:00Z") }, 2, 3)).toBe("mix-2026-10-08-m7-p2.dem");
  });
});

describe("potrivirea cu meciul", () => {
  // Meciul: încălzire 20:05, live 20:10, final 20:50 (UTC), pe de_mirage.
  const match = { id: 42, externalId: "m-1791460000-1234", map: "de_mirage", startedAt: at("2026-10-08T20:05:00Z"), liveAt: at("2026-10-08T20:10:00Z"), endedAt: at("2026-10-08T20:50:00Z") };
  const opts = { timeZone: "UTC", prefix: "", delaySec: 0 };
  const names = (list: GcsRemoteDemo[]) => list.map((f) => f.name);

  it("înregistrarea continuă: ultimul fișier al hărții început înainte de live (nu cel de pe altă hartă, nici unul mai vechi)", () => {
    const files = [
      file("mix-2610081800-de_mirage.dem"),
      file("mix-2610081930-de_dust2.dem"),
      file("mix-2610082001-de_mirage.dem"),
      file("mix-2610082100-de_mirage.dem"),
      file("notes.txt"),
    ];
    expect(names(pickDemoFiles(files, match, opts))).toEqual(["mix-2610082001-de_mirage.dem"]);
  });

  it("demo-urile împărțite (schimbarea hărții / restartul în meci): toate părțile, în ordine", () => {
    const files = [file("mix-2610082030-de_mirage.dem"), file("mix-2610082008-de_mirage.dem"), file("mix-2610082049-de_mirage.dem"), file("mix-2610082052-de_mirage.dem")];
    expect(names(pickDemoFiles(files, match, opts))).toEqual(["mix-2610082008-de_mirage.dem", "mix-2610082030-de_mirage.dem", "mix-2610082049-de_mirage.dem"]);
  });

  it("minutul din nume: un fișier început în minutul în care meciul a devenit live contează", () => {
    expect(names(pickDemoFiles([file("mix-2610082010-de_mirage.dem")], { ...match, liveAt: at("2026-10-08T20:10:40Z") }, opts))).toEqual(["mix-2610082010-de_mirage.dem"]);
  });

  it("înregistrarea pornită târziu (niciun fișier înainte de live): fișierele din fereastră", () => {
    expect(names(pickDemoFiles([file("mix-2610082012-de_mirage.dem"), file("mix-2610082101-de_mirage.dem")], match, opts))).toEqual(["mix-2610082012-de_mirage.dem"]);
  });

  it("fusul orar: numele în ora Bucureștiului (UTC+3) se potrivește cu meciul din UTC", () => {
    const files = [file("mix-2610082301-de_mirage.dem"), file("mix-2610082001-de_mirage.dem")];
    expect(names(pickDemoFiles(files, match, { ...opts, timeZone: "Europe/Bucharest" }))).toEqual(["mix-2610082301-de_mirage.dem"]);
  });

  it("întârzierea transmisiei mută fereastra (HLTV-ul vede finalul mai târziu)", () => {
    const files = [file("mix-2610082008-de_mirage.dem"), file("mix-2610082051-de_mirage.dem")];
    expect(names(pickDemoFiles(files, match, opts))).toEqual(["mix-2610082008-de_mirage.dem"]);
    expect(names(pickDemoFiles(files, match, { ...opts, delaySec: 90 }))).toEqual(["mix-2610082008-de_mirage.dem", "mix-2610082051-de_mirage.dem"]);
  });

  it("un fișier terminat de scris înainte de live nu are meciul; peste 12 ore înainte nu se ia", () => {
    expect(names(pickDemoFiles([file("mix-2610081500-de_mirage.dem", "2026-10-08T16:00:00Z")], match, opts))).toEqual([]);
    expect(names(pickDemoFiles([file("mix-2610080700-de_mirage.dem", "2026-10-08T21:00:00Z")], match, opts))).toEqual([]);
    expect(names(pickDemoFiles([file("mix-2610081500-de_mirage.dem", "2026-10-08T20:51:00Z")], match, opts))).toEqual(["mix-2610081500-de_mirage.dem"]);
  });

  it("prefixul filtrează numele; harta goală a meciului acceptă orice hartă", () => {
    const files = [file("tv-2610082001-de_mirage.dem"), file("mix-2610082002-de_mirage.dem")];
    expect(names(pickDemoFiles(files, match, { ...opts, prefix: "tv" }))).toEqual(["tv-2610082001-de_mirage.dem"]);
    expect(names(pickDemoFiles([file("mix-2610082002-de_nuke.dem")], { ...match, map: "" }, opts))).toEqual(["mix-2610082002-de_nuke.dem"]);
  });

  it("numele GCS au prioritate: `gcs-<externalId>.dem` sau părțile `gcs-m<id>-…`", () => {
    const files = [file("mix-2610082001-de_mirage.dem"), file("gcs-m-1791460000-1234.dem"), file("gcs-m41-2610081900-de_mirage.dem")];
    expect(names(pickDemoFiles(files, match, opts))).toEqual(["gcs-m-1791460000-1234.dem"]);
    const rcon = [file("gcs-m42-2610082031-de_mirage.dem"), file("gcs-m42-2610082010-de_mirage.dem"), file("mix-2610082001-de_mirage.dem")];
    expect(names(pickDemoFiles(rcon, match, opts))).toEqual(["gcs-m42-2610082010-de_mirage.dem", "gcs-m42-2610082031-de_mirage.dem"]);
  });

  it("numele cu dată (înregistrarea automată): harta trebuie să apară în nume", () => {
    const files = [file("auto0-20261008-200800-1-de_mirage-GCS.dem"), file("auto0-20261008-200900-2-de_nuke-GCS.dem")];
    expect(names(pickDemoFiles(files, match, opts))).toEqual(["auto0-20261008-200800-1-de_mirage-GCS.dem"]);
  });

  it("max 10 părți", () => {
    const files = Array.from({ length: 14 }, (_, i) => file(`mix-26100820${String(10 + i * 2).padStart(2, "0")}-de_mirage.dem`));
    expect(pickDemoFiles(files, match, opts)).toHaveLength(10);
  });
});
