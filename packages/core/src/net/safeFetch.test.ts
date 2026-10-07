import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { checkFetchUrl, GcsBlockedFetch, isPublicAddress, safeFetchBuffer } from "./safeFetch";

const reason = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof GcsBlockedFetch ? e.reason : `other:${String(e)}`));

describe("isPublicAddress", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2001:db8::1",
    "nu-e-ip",
  ])("%s nu e public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  test.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("%s e public", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe("checkFetchUrl", () => {
  test("doar http/https, fără user/parolă, pe porturile permise", () => {
    expect(checkFetchUrl("https://exemplu.ro/uploads/a.png").hostname).toBe("exemplu.ro");
    expect(() => checkFetchUrl("file:///etc/passwd")).toThrow(GcsBlockedFetch);
    expect(() => checkFetchUrl("ftp://exemplu.ro/a")).toThrow(GcsBlockedFetch);
    expect(() => checkFetchUrl("https://user:pw@exemplu.ro/a")).toThrow(GcsBlockedFetch);
    expect(() => checkFetchUrl("http://exemplu.ro:6379/")).toThrow(GcsBlockedFetch);
    expect(() => checkFetchUrl("nu e url")).toThrow(GcsBlockedFetch);
  });
});

describe("safeFetchBuffer", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/ok") return void res.end("salut");
      if (req.url === "/big") return void res.end(Buffer.alloc(5000, 1));
      if (req.url === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
      if (req.url === "/to-private") return void res.writeHead(302, { location: "http://10.0.0.1/secret" }).end();
      if (req.url === "/to-localhost") return void res.writeHead(302, { location: `http://localhost:${port}/ok` }).end();
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  test("cu garda reală, loopback e refuzat (ca IP scris direct și prin DNS)", async () => {
    const opts = { maxBytes: 1000, ports: [port] };
    expect(await reason(safeFetchBuffer(`http://127.0.0.1:${port}/ok`, opts))).toBe("blocked_address");
    expect(await reason(safeFetchBuffer(`http://localhost:${port}/ok`, opts))).toBe("blocked_address");
    expect(await reason(safeFetchBuffer(`http://[::1]:${port}/ok`, opts))).toBe("blocked_address");
  });

  // Testele de mai jos permit doar 127.0.0.1 (serverul de test), ca să verifice restul regulilor.
  const onlyTestServer = { isAllowedAddress: (ip: string) => ip === "127.0.0.1" };

  test("descarcă un fișier permis", async () => {
    const file = await safeFetchBuffer(`http://127.0.0.1:${port}/ok`, { maxBytes: 1000, ports: [port] }, onlyTestServer);
    expect(file.bytes.toString()).toBe("salut");
  });

  test("limita de mărime, redirecturile infinite și un redirect spre o adresă privată", async () => {
    const opts = { maxBytes: 1000, ports: [port, 80] };
    expect(await reason(safeFetchBuffer(`http://127.0.0.1:${port}/big`, opts, onlyTestServer))).toBe("too_large");
    expect(await reason(safeFetchBuffer(`http://127.0.0.1:${port}/loop`, opts, onlyTestServer))).toBe("too_many_redirects");
    expect(await reason(safeFetchBuffer(`http://127.0.0.1:${port}/to-private`, opts, onlyTestServer))).toBe("blocked_address");
    expect(await reason(safeFetchBuffer(`http://127.0.0.1:${port}/missing`, opts, onlyTestServer))).toBe("http_404");
  });

  test("un redirect spre un nume care se rezolvă într-o adresă nepermisă e refuzat la conectare", async () => {
    const deps = {
      isAllowedAddress: (ip: string) => ip === "127.0.0.1",
      // „localhost” se rezolvă (fals) într-o adresă privată.
      lookup: ((_host: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) =>
        cb(null, [{ address: "192.168.0.10", family: 4 }])) as never,
    };
    expect(await reason(safeFetchBuffer(`http://127.0.0.1:${port}/to-localhost`, { maxBytes: 1000, ports: [port] }, deps))).toBe("blocked_address");
  });
});
