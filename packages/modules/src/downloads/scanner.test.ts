import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { GcsClamdScanner, parseClamVersion, parseScannerAddress, parseScanReply } from "./scanner";

/**
 * Un `clamd` fals pe TCP: răspunde la `zPING` / `zVERSION` și, la `zINSTREAM`, citește bucățile (lungime pe 4 octeți +
 * date, terminate cu 0) și raportează „infectat” dacă fluxul conține `VIRUS`.
 */
function fakeClamd(): Promise<{ server: Server; port: number; received: Buffer[] }> {
  const received: Buffer[] = [];
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    let mode: "cmd" | "stream" = "cmd";
    let data = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (mode === "cmd") {
        const end = buf.indexOf(0);
        if (end === -1) return;
        const cmd = buf.subarray(0, end).toString();
        buf = buf.subarray(end + 1);
        if (cmd === "zPING") return void socket.end("PONG\0");
        if (cmd === "zVERSION") return void socket.end("ClamAV 1.4.1/27450/Mon Nov  3 08:23:01 2026\0");
        if (cmd === "zINSTREAM") mode = "stream";
      }
      while (mode === "stream" && buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          received.push(data);
          return void socket.end(data.includes("VIRUS") ? "stream: Test.Virus-1 FOUND\0" : "stream: OK\0");
        }
        if (buf.length < 4 + len) return;
        data = Buffer.concat([data, buf.subarray(4, 4 + len)]);
        buf = buf.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port, received })));
}

async function* chunks(...parts: string[]) {
  for (const p of parts) yield Buffer.from(p);
}

describe("protocolul clamd", () => {
  test("răspunsurile și versiunea", () => {
    expect(parseScanReply("stream: OK\0")).toEqual({ status: "clean" });
    expect(parseScanReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ status: "infected", signature: "Win.Test.EICAR_HDB-1" });
    expect(parseScanReply("INSTREAM size limit exceeded. ERROR")).toEqual({ status: "error", error: "too_large" });
    expect(parseClamVersion("ClamAV 1.4.1/27450/Mon Nov  3 08:23:01 2026")).toMatchObject({ engine: "ClamAV 1.4.1", signatures: 27450 });
    expect(parseScannerAddress("clamav:3310")).toEqual({ host: "clamav", port: 3310 });
    expect(parseScannerAddress("")).toBeNull();
    expect(parseScannerAddress("http://x:1")).toBeNull();
  });

  let fake: Awaited<ReturnType<typeof fakeClamd>>;
  beforeAll(async () => {
    fake = await fakeClamd();
  });
  afterAll(() => fake.server.close());

  test("starea, un fișier curat și unul infectat, trimise în bucăți", async () => {
    const scanner = new GcsClamdScanner({ host: "127.0.0.1", port: fake.port });
    expect(await scanner.info()).toMatchObject({ available: true, engine: "ClamAV 1.4.1", signatures: 27450 });
    expect(await scanner.scan(chunks("hello ", "world"), 1000)).toEqual({ status: "clean" });
    expect(fake.received.at(-1)?.toString()).toBe("hello world");
    expect(await scanner.scan(chunks("x".repeat(70_000), "VIRUS"), 100_000)).toEqual({ status: "infected", signature: "Test.Virus-1" });
  });

  test("peste limită: eroare `too_large`, fără verdict", async () => {
    const scanner = new GcsClamdScanner({ host: "127.0.0.1", port: fake.port });
    expect(await scanner.scan(chunks("x".repeat(2000)), 1000)).toEqual({ status: "error", error: "too_large" });
  });

  test("serviciul oprit: indisponibil, nu o excepție", async () => {
    const scanner = new GcsClamdScanner({ host: "127.0.0.1", port: 1 });
    expect((await scanner.info()).available).toBe(false);
    expect((await scanner.scan(chunks("a"), 10)).status).toBe("error");
  });
});
