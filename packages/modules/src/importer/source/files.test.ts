import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GcsBlockedFetch } from "@gcs/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { folderFiles, memoryFiles, readFirst, safeRelativePath, urlFiles } from "./files";

describe("căile relative", () => {
  test.each(["../etc/passwd", "uploads/../../x", "/etc/passwd", "C:/Windows/win.ini", "uploads//a", "a/./b", "a\u0000b", ""])("%j e refuzată", (p) => {
    expect(safeRelativePath(p)).toBeNull();
  });
  test("o cale normală (și cu backslash) e acceptată", () => {
    expect(safeRelativePath("uploads/monthly_2020_01/a.png")).toBe("uploads/monthly_2020_01/a.png");
    expect(safeRelativePath("data\\avatars\\o\\0\\2.jpg")).toBe("data/avatars/o/0/2.jpg");
  });
});

describe("folderul montat", () => {
  let root: string;
  let outside: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "gcs-import-files-"));
    outside = await mkdtemp(path.join(os.tmpdir(), "gcs-import-outside-"));
    await mkdir(path.join(root, "uploads"), { recursive: true });
    await writeFile(path.join(root, "uploads", "a.txt"), "salut");
    await writeFile(path.join(root, "uploads", "mare.bin"), Buffer.alloc(2000));
    await writeFile(path.join(outside, "secret.txt"), "secret");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  test("citește doar în interiorul folderului; lipsă → null; prea mare → refuzat", async () => {
    const files = folderFiles(root, 1000);
    expect((await files.read("uploads/a.txt"))?.toString()).toBe("salut");
    expect(await files.read("uploads/lipsa.txt")).toBeNull();
    expect(await files.read("../" + path.basename(outside) + "/secret.txt")).toBeNull();
    expect(await files.read("uploads")).toBeNull();
    await expect(files.read("uploads/mare.bin")).rejects.toBeInstanceOf(GcsBlockedFetch);
    expect((await readFirst(files, ["uploads/x.png", "uploads/a.txt"]))?.path).toBe("uploads/a.txt");
  });

  test("un symlink spre afara folderului nu e urmat", async () => {
    const link = path.join(root, "uploads", "scapare.txt");
    try {
      await symlink(path.join(outside, "secret.txt"), link, "file");
    } catch {
      return; // Fără dreptul de a crea symlink-uri (Windows fără drepturi de admin): nimic de verificat.
    }
    expect(await folderFiles(root, 1000).read("uploads/scapare.txt")).toBeNull();
  });
});

describe("adresa web și memoria", () => {
  test("o adresă locală e refuzată de garda anti-SSRF", async () => {
    const files = urlFiles("http://localhost/vechi", 1000);
    await expect(files.read("uploads/a.png")).rejects.toMatchObject({ reason: "blocked_address" });
    expect(() => urlFiles("file:///etc", 1000)).toThrow(GcsBlockedFetch);
  });

  test("fișierele în memorie", async () => {
    const files = memoryFiles({ "a/b.txt": Buffer.from("x") });
    expect((await files.read("a/b.txt"))?.toString()).toBe("x");
    expect(await files.read("../a/b.txt")).toBeNull();
  });
});
