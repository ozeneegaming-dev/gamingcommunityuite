import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeDemo, startFtpDemoServer, startHttpDemoServer, startSftpDemoServer, type DemoFiles } from "../../../../test/demoServers";
import { parseAllowNets } from "../../net";
import { connectDemoSource, parseIndexLinks, sshFingerprint, type GcsDemoSourceConfig } from "./sources";

const guard = { allow: parseAllowNets("127.0.0.1/32"), production: false };
let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "gcs-demo-src-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const base: GcsDemoSourceConfig = { source: "http", host: null, port: null, username: null, password: null, privateKey: null, remoteDir: "/demos", tlsInsecure: false, hostKey: null, httpTemplate: null };
const files = (): DemoFiles =>
  new Map([
    ["mix-2610082001-de_mirage.dem", { bytes: fakeDemo("cs16", 50_000), modifiedAt: new Date("2026-10-08T20:55:00Z") }],
    ["mix-2610081930-de_dust2.dem", { bytes: fakeDemo("cs16", 3000) }],
    ["notite.txt", { bytes: Buffer.from("nu") }],
  ]);

/** Sursele demo-urilor (specul 2026-10-08-servere-hltv §4.1–4.2) pe servere locale reale: HTTP, FTP, SFTP. */
describe("sursele demo-urilor", () => {
  it("pagina de index: doar legăturile `.dem` din același folder, cu nume sigure", () => {
    const html = `<a href="../">..</a><a href="mix-1.dem">1</a><a href='mix%202.dem'>2</a><a href="/demos/mix-3.dem">3</a><a href="/alt/mix-4.dem">4</a><a href="http://alt.test/demos/mix-5.dem">5</a><a href="sub/mix-6.dem">6</a><a href="mix-7.dem?x=1">7</a><a href=mix-8.dem>8</a>`;
    expect(parseIndexLinks(html, "http://demos.test/demos/")).toEqual(["mix-1.dem", "mix-3.dem", "mix-7.dem", "mix-8.dem"]);
  });

  it("HTTP: lista din pagina de index, descărcarea identică, limita de mărime, 404 → not_found", async () => {
    const f = files();
    const srv = await startHttpDemoServer(f, { redirectTo: "http://altundeva.test/x.dem" });
    try {
      const conn = await connectDemoSource({ ...base, httpTemplate: `${srv.url}{file}` }, { guard });
      expect((await conn.list()).map((x) => x.name).sort()).toEqual(["mix-2610081930-de_dust2.dem", "mix-2610082001-de_mirage.dem"]);
      const dest = path.join(tmp, "a.dem");
      expect(await conn.download("mix-2610082001-de_mirage.dem", dest, 1_000_000)).toBe(50_000);
      expect((await readFile(dest)).equals(f.get("mix-2610082001-de_mirage.dem")!.bytes)).toBe(true);
      await expect(conn.download("mix-2610082001-de_mirage.dem", path.join(tmp, "b.dem"), 10_000)).rejects.toMatchObject({ code: "too_large" });
      await expect(conn.download("lipsa-2610082001-de_mirage.dem", path.join(tmp, "c.dem"), 1_000_000)).rejects.toMatchObject({ code: "not_found" });
      // Un redirect spre altă origine e refuzat; un nume nesigur nici nu pleacă.
      await expect(conn.download("redirect.dem", path.join(tmp, "d.dem"), 1_000_000)).rejects.toMatchObject({ code: "redirect" });
      await expect(conn.download("../secret.dem", path.join(tmp, "e.dem"), 1_000_000)).rejects.toMatchObject({ code: "invalid_name" });
      await conn.close();
    } finally {
      await srv.close();
    }
  });

  it("garda: loopback refuzat în producție, privat fără excepție refuzat", async () => {
    const srv = await startHttpDemoServer(files());
    try {
      await expect(connectDemoSource({ ...base, httpTemplate: `${srv.url}{file}` }, { guard: { ...guard, production: true } })).rejects.toMatchObject({ code: "blocked" });
      await expect(connectDemoSource({ ...base, httpTemplate: `${srv.url}{file}` }, { guard: { allow: null, production: false } })).rejects.toMatchObject({ code: "blocked" });
      await expect(connectDemoSource({ ...base, source: "ftp", host: "10.0.0.8", port: 21, username: "u", password: "p" }, { guard })).rejects.toMatchObject({ code: "blocked" });
      await expect(connectDemoSource({ ...base, source: "sftp", host: "169.254.169.254", port: 22, username: "u", password: "p" }, { guard: { allow: parseAllowNets("0.0.0.0/0"), production: false } })).rejects.toMatchObject({ code: "blocked" });
    } finally {
      await srv.close();
    }
  });

  it("FTP: MLSD (cu datele), descărcarea prin PASV doar la IP-ul conexiunii de control, parola greșită → auth", async () => {
    const f = files();
    const srv = await startFtpDemoServer(f);
    try {
      const cfg = { ...base, source: "ftp" as const, host: "127.0.0.1", port: srv.port, username: srv.user, password: srv.pass, remoteDir: srv.dir };
      const conn = await connectDemoSource(cfg, { guard });
      const list = await conn.list();
      expect(list.map((x) => x.name).sort()).toEqual(["mix-2610081930-de_dust2.dem", "mix-2610082001-de_mirage.dem"]);
      expect(list.find((x) => x.name.includes("mirage"))).toMatchObject({ size: 50_000, modifiedAt: new Date("2026-10-08T20:55:00Z") });
      const dest = path.join(tmp, "f.dem");
      expect(await conn.download("mix-2610082001-de_mirage.dem", dest, 1_000_000)).toBe(50_000);
      expect((await readFile(dest)).equals(f.get("mix-2610082001-de_mirage.dem")!.bytes)).toBe(true);
      await conn.close();
      expect(srv.log).toContain("PASS ***");
      expect(srv.log.join("\n")).not.toContain(srv.pass);
      await expect(connectDemoSource({ ...cfg, password: "gresit" }, { guard })).rejects.toMatchObject({ code: "auth" });
    } finally {
      await srv.close();
    }
  });

  it("FTP fără MLSD (LIST): numele și mărimile; un fișier prea mare se oprește din flux", async () => {
    const srv = await startFtpDemoServer(files(), { mlsd: false });
    try {
      const conn = await connectDemoSource({ ...base, source: "ftp", host: "127.0.0.1", port: srv.port, username: srv.user, password: srv.pass, remoteDir: srv.dir }, { guard });
      const list = await conn.list();
      expect(list.find((x) => x.name.includes("mirage"))).toMatchObject({ size: 50_000, modifiedAt: null });
      await expect(conn.download("mix-2610082001-de_mirage.dem", path.join(tmp, "g.dem"), 10_000)).rejects.toMatchObject({ code: "too_large" });
      await conn.close();
    } finally {
      await srv.close();
    }
  });

  it("SFTP: parola, lista cu datele, descărcarea; amprenta cheii reținută, una schimbată → host_key_mismatch", async () => {
    const f = files();
    const srv = await startSftpDemoServer(f);
    try {
      const cfg = { ...base, source: "sftp" as const, host: "127.0.0.1", port: srv.port, username: srv.user, password: srv.pass, remoteDir: srv.dir };
      const conn = await connectDemoSource(cfg, { guard });
      expect(conn.hostKey).toBe(sshFingerprint(srv.publicBlob));
      const list = await conn.list();
      expect(list.map((x) => x.name).sort()).toEqual(["mix-2610081930-de_dust2.dem", "mix-2610082001-de_mirage.dem"]);
      expect(list.find((x) => x.name.includes("mirage"))).toMatchObject({ size: 50_000, modifiedAt: new Date("2026-10-08T20:55:00Z") });
      const dest = path.join(tmp, "s.dem");
      expect(await conn.download("mix-2610082001-de_mirage.dem", dest, 1_000_000)).toBe(50_000);
      expect((await readFile(dest)).equals(f.get("mix-2610082001-de_mirage.dem")!.bytes)).toBe(true);
      await conn.close();
      const pinned = await connectDemoSource({ ...cfg, hostKey: sshFingerprint(srv.publicBlob) }, { guard });
      await pinned.close();
      // Amprenta altei chei (a unui server care s-ar da drept acesta).
      await expect(connectDemoSource({ ...cfg, hostKey: sshFingerprint(Buffer.from("alta-cheie")) }, { guard })).rejects.toMatchObject({ code: "host_key_mismatch" });
      await expect(connectDemoSource({ ...cfg, password: "gresit" }, { guard })).rejects.toMatchObject({ code: "auth" });
    } finally {
      await srv.close();
    }
  });
});
