import { describe, expect, test } from "vitest";
import { cleanFileName, contentMatches, extensionAllowed, extensionOf, isText, sniffKind } from "./filetype";
import { categoryOptions, effectiveMaxBytes, isBlockedHost, parseDomainList } from "./options";

const bytes = (...b: number[]) => Buffer.from(b);

describe("tipul real după conținut", () => {
  test("recunoaște arhivele, executabilele, imaginile și fișierele de joc", () => {
    expect(sniffKind(bytes(0x50, 0x4b, 0x03, 0x04, 1, 2))).toBe("zip");
    expect(sniffKind(Buffer.from("Rar!\x1a\x07\x01\x00", "latin1"))).toBe("rar");
    expect(sniffKind(bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0))).toBe("7z");
    expect(sniffKind(bytes(0x1f, 0x8b, 8))).toBe("gzip");
    expect(sniffKind(Buffer.from("MZ\x90\x00", "latin1"))).toBe("exe");
    expect(sniffKind(bytes(0x7f, 0x45, 0x4c, 0x46))).toBe("elf");
    expect(sniffKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffKind(Buffer.from("VBSP\x14\x00\x00\x00", "latin1"))).toBe("bsp");
    expect(sniffKind(Buffer.from("HL2DEMO\0", "latin1"))).toBe("demo");
    expect(sniffKind(Buffer.from("sv_cheats 0\nmp_maxrounds 24\n"))).toBe("text");
    expect(sniffKind(bytes(0, 1, 2, 3, 0xff))).toBe("binary");
  });

  test("tar după antetul `ustar` de la octetul 257", () => {
    const tar = Buffer.alloc(512);
    tar.write("ustar", 257, "latin1");
    expect(sniffKind(tar)).toBe("tar");
  });

  test("textul UTF-8 tăiat la capătul bucății rămâne text; octeții nuli nu", () => {
    const ro = Buffer.from("configurație ăîșț");
    expect(isText(ro.subarray(0, ro.length - 1))).toBe(true);
    expect(isText(Buffer.from([0x61, 0x00, 0x62]))).toBe(false);
  });
});

describe("extensiile și potrivirea cu conținutul", () => {
  test("extensia trebuie să fie în lista categoriei; lista goală = orice extensie", () => {
    expect(extensionAllowed("harta.BSP", ["bsp", "zip"])).toEqual({ ok: true });
    expect(extensionAllowed("tool.exe", ["bsp", "zip"])).toEqual({ ok: false, error: "extension_not_allowed", detail: "exe" });
    expect(extensionAllowed("README", ["zip"])).toEqual({ ok: false, error: "no_extension" });
    expect(extensionAllowed("tool.exe", [])).toEqual({ ok: true });
  });

  test("un executabil deghizat e respins, chiar cu o extensie fără semnătură", () => {
    expect(contentMatches("harta.bsp", "exe")).toEqual({ ok: false, error: "type_mismatch", detail: "exe" });
    expect(contentMatches("mod.nav", "exe")).toEqual({ ok: false, error: "type_mismatch", detail: "exe" });
    expect(contentMatches("poza.jpg", "zip")).toEqual({ ok: false, error: "type_mismatch", detail: "zip" });
    expect(contentMatches("server.cfg", "binary")).toEqual({ ok: false, error: "type_mismatch", detail: "binary" });
  });

  test("conținutul potrivit trece; fișierele de joc fără semnătură trec după extensie", () => {
    expect(contentMatches("pack.zip", "zip")).toEqual({ ok: true });
    expect(contentMatches("plugin.smx", "binary")).toEqual({ ok: true });
    expect(contentMatches("model.mdl", "binary")).toEqual({ ok: true });
    expect(contentMatches("tool.exe", "exe")).toEqual({ ok: true });
  });

  test("numele se curăță de căi, caractere rezervate și puncte de la început", () => {
    expect(cleanFileName("..\\..\\etc/passwd")).toBe("passwd");
    expect(cleanFileName('a<b>:c"|?*.zip')).toBe("abc.zip");
    expect(cleanFileName("...ascuns.cfg")).toBe("ascuns.cfg");
    expect(cleanFileName("")).toBe("file");
    expect(extensionOf(cleanFileName(`${"x".repeat(300)}.zip`))).toBe("zip");
  });
});

describe("limitele și domeniile", () => {
  test("cea mai mică limită dintre categorie (sau site) și grup; 0 / -1 = fără limită", () => {
    expect(effectiveMaxBytes({ siteMb: 200, categoryMb: null, groupMb: -1 })).toBe(200 * 1048576);
    expect(effectiveMaxBytes({ siteMb: 200, categoryMb: 500, groupMb: 50 })).toBe(50 * 1048576);
    expect(effectiveMaxBytes({ siteMb: 200, categoryMb: 0, groupMb: -1 })).toBeNull();
  });

  test("domeniile blocate prind și subdomeniile; intrările greșite sunt raportate", () => {
    const { domains, invalid } = parseDomainList("mega.nz\n*.example.com, nu e domeniu\nMEGA.NZ");
    expect(domains).toEqual(["mega.nz", "example.com"]);
    expect(invalid).toEqual(["nu e domeniu"]);
    expect(isBlockedHost("cdn.mega.nz", domains)).toBe(true);
    expect(isBlockedHost("notmega.nz", domains)).toBe(false);
  });

  test("opțiunile vechi sau incomplete ale unei categorii primesc valorile implicite", () => {
    const o = categoryOptions({ approval: false, extensions: [".ZIP", "bad ext", "bsp"], versioning: "nope", maxFileMb: 50 });
    expect(o.approval).toBe(false);
    expect(o.extensions).toEqual(["zip", "bsp"]);
    expect(o.versioning).toBe("optional");
    expect(o.maxFileMb).toBe(50);
    expect(categoryOptions(null).approval).toBe(true);
  });
});
