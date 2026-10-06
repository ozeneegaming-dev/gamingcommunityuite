import { writeZip } from "@gcs/plugin-sdk/zip";
import { describe, expect, test } from "vitest";
import { GcsPluginPackageError, isSafeArchivePath, PLUGIN_ZIP_LIMITS, readPluginZip } from "./zip";

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GcsPluginPackageError) return e.code;
    throw e;
  }
  return "ok";
};

describe("arhiva unui plugin", () => {
  test("citește fișierele (store și deflate) și ignoră directoarele", () => {
    const zip = writeZip([
      { name: "plugin.json", data: "{}", method: 0 },
      { name: "lang/", data: "", mode: 0o040755 },
      { name: "lang/ro.json", data: '{"a":"b"}'.repeat(20) },
    ]);
    const files = readPluginZip(zip);
    expect([...files.keys()]).toEqual(["plugin.json", "lang/ro.json"]);
    expect(files.get("lang/ro.json")!.toString()).toBe('{"a":"b"}'.repeat(20));
  });

  test("căile nesigure: zip-slip, absolute, unități, backslash, caractere ciudate", () => {
    for (const name of ["../evil.mjs", "a/../../evil", "/etc/passwd", "C:/x.txt", "a\\b.txt", "a//b", "./a", "a/./b", "ș.txt", "a b.txt", "a\u0000b"]) {
      expect(code(() => readPluginZip(writeZip([{ name, data: "x" }])))).toBe("path_unsafe");
    }
    expect(isSafeArchivePath("assets/img/logo.png")).toBe(true);
    expect(isSafeArchivePath("x".repeat(PLUGIN_ZIP_LIMITS.maxPathLength + 1))).toBe(false);
  });

  test("link-urile simbolice și fișierele speciale sunt refuzate", () => {
    expect(code(() => readPluginZip(writeZip([{ name: "server.mjs", data: "/etc/passwd", mode: 0o120777 }])))).toBe("symlink");
    expect(code(() => readPluginZip(writeZip([{ name: "fifo", data: "", mode: 0o010644 }])))).toBe("special_file");
  });

  test("duplicatele (și cu majuscule diferite) sunt refuzate", () => {
    expect(code(() => readPluginZip(writeZip([{ name: "a.txt", data: "1" }, { name: "A.txt", data: "2" }])))).toBe("duplicate_path");
    expect(code(() => readPluginZip(writeZip([{ name: "a.txt", data: "1" }, { name: "a.txt", data: "2" }])))).toBe("duplicate_path");
  });

  test("limitele de mărime și număr", () => {
    const small = { ...PLUGIN_ZIP_LIMITS, maxFiles: 2, maxFileBytes: 100, maxTotalBytes: 150, maxArchiveBytes: 10_000 };
    expect(code(() => readPluginZip(writeZip([{ name: "a", data: "1" }, { name: "b", data: "2" }, { name: "c", data: "3" }]), small))).toBe("too_many_files");
    expect(code(() => readPluginZip(writeZip([{ name: "a", data: "x".repeat(101), method: 0 }]), small))).toBe("file_too_large");
    expect(code(() => readPluginZip(writeZip([{ name: "a", data: "x".repeat(90), method: 0 }, { name: "b", data: "y".repeat(90), method: 0 }]), small))).toBe("total_too_large");
    expect(code(() => readPluginZip(Buffer.alloc(10_001), small))).toBe("archive_too_large");
  });

  test("bomba ZIP: raportul de compresie și mărimea declarată mincinoasă", () => {
    expect(code(() => readPluginZip(writeZip([{ name: "bomb.txt", data: "0".repeat(1_000_000) }])))).toBe("compression_ratio");
    // Declară 10 octeți, dar se dezarhivează 5000: dezarhivarea se oprește la limită.
    expect(code(() => readPluginZip(writeZip([{ name: "lie.txt", data: "a".repeat(5000), declaredSize: 10 }])))).toBe("zip_corrupt");
  });

  test("CRC greșit, criptare și metode necunoscute", () => {
    expect(code(() => readPluginZip(writeZip([{ name: "a.txt", data: "abc", crc: 123 }])))).toBe("zip_crc");
    expect(code(() => readPluginZip(writeZip([{ name: "a.txt", data: "abc", flags: 0x0801 }])))).toBe("zip_encrypted");
    const zip = writeZip([{ name: "a.txt", data: "abc", method: 0 }]);
    // Metoda 12 (bzip2) în directorul central și în antetul local.
    const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt16LE(12, cd + 10);
    zip.writeUInt16LE(12, 8);
    expect(code(() => readPluginZip(zip))).toBe("zip_method");
  });

  test("arhivele stricate", () => {
    expect(code(() => readPluginZip(Buffer.from("nu e un zip, doar text suficient de lung")))).toBe("zip_invalid");
    const zip = writeZip([{ name: "a.txt", data: "abc" }]);
    // Numele din antetul local diferă de cel din directorul central.
    zip.write("b", 30);
    expect(code(() => readPluginZip(zip))).toBe("zip_invalid");
  });
});
