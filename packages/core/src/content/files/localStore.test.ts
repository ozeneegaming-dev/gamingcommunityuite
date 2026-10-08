import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { GcsLocalFileStore } from "./localStore";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "gcs-local-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Store-ul local (teste, dev fără MinIO): scrierea dintr-un fișier, citirea întreagă / pe bucăți, ștergerea, cheile. */
describe("GcsLocalFileStore", () => {
  test("putFile copiază fișierul local; get îl citește întreg sau pe bucăți", async () => {
    const store = new GcsLocalFileStore(path.join(dir, "files"));
    const source = path.join(dir, "demo.dem");
    await writeFile(source, Buffer.from("HLDEMO\0\0-continut", "latin1"));
    await store.putFile("servers/demos/2026/10/a.dem", source, "application/octet-stream");
    const whole = await store.get("servers/demos/2026/10/a.dem");
    expect(whole?.size).toBe(17);
    expect(Buffer.from(await new Response(whole!.body).arrayBuffer()).toString("latin1")).toBe("HLDEMO\0\0-continut");
    const part = await store.get("servers/demos/2026/10/a.dem", { start: 9, end: 16 });
    expect(Buffer.from(await new Response(part!.body).arrayBuffer()).toString()).toBe("continut");
    await store.delete("servers/demos/2026/10/a.dem");
    expect(await store.get("servers/demos/2026/10/a.dem")).toBeNull();
  });

  test("o cheie care ar ieși din folder e refuzată", async () => {
    const store = new GcsLocalFileStore(path.join(dir, "files"));
    await expect(store.put("../afara.txt", Buffer.from("x"))).rejects.toThrow();
    await expect(store.putFile("../afara.txt", path.join(dir, "x"))).rejects.toThrow();
  });
});
