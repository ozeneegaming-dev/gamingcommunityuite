import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeDemo } from "../../../../test/demoServers";
import { createBridgeWorld, GAME_SERVER_IP, type GcsBridgeWorld } from "../../../../test/bridgeWorld";
import { BRIDGE_BASE_PATH } from "../signing";

/**
 * Verificarea încrucișată (specul 2026-10-08-servere-hltv §9): clientul real al pluginului CS2 (`BridgeClient.cs`,
 * `DemoUploader.cs`, compilate de `servers-plugins/cs2/crosscheck`) încarcă un demo pe codul real al site-ului, prin
 * HTTP: heartbeat-ul semnat cu modulul „demos”, încărcarea întreruptă și reluată, lipirea, `done`, fișierul local șters.
 * Opțional: rulează doar cu `GCS_DOTNET=<calea spre dotnet>` (.NET SDK 8; pachetele NuGet din `NUGET_PACKAGES`).
 */
const dotnet = process.env.GCS_DOTNET;
const project = path.resolve(__dirname, "../../../../../../servers-plugins/cs2/crosscheck/GcsBridgeCrossCheck.csproj");

let w: GcsBridgeWorld;
let tmp: string;
beforeEach(async () => {
  w = await createBridgeWorld();
  tmp = await mkdtemp(path.join(os.tmpdir(), "gcs-crosscheck-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe.skipIf(!dotnet)("clientul CS2 real contra site-ului (încărcarea demo-urilor)", () => {
  it("heartbeat, încărcarea întreruptă și reluată, lipirea, done; fișierul local șters", async () => {
    const { id, token } = await w.bridgeServer({ game: "cs2", isMix: true });
    await w.bridge.tv.save(w.root, id, { address: "", delay: null, source: "plugin", host: "", port: null, username: "", remoteDir: "/", tlsInsecure: false, hostKey: "", httpTemplate: "", namePrefix: "", timeZone: "UTC", record: true });
    const mock = w.mock(token, "cs2");
    const ctx = await mock.startMix();
    await mock.finishMix(ctx);
    const demo = fakeDemo("cs2", 1_400_000);
    const file = path.join(tmp, `gcs-${ctx.matchId}.dem`);
    await writeFile(file, demo);

    // Site-ul pe HTTP: aceeași rută ca în Next.js (calea de după baza protocolului, corpul brut).
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        const url = new URL(req.url ?? "/", "http://x");
        const out = await w.bridge.api.handle({
          method: req.method ?? "GET",
          path: url.pathname.slice(BRIDGE_BASE_PATH.length) + url.search,
          header: (name) => {
            const v = req.headers[name.toLowerCase()];
            return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
          },
          body: Buffer.concat(chunks),
          ip: GAME_SERVER_IP,
        });
        res.writeHead(out.status, out.headers);
        res.end(out.body ?? undefined);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Jobul de lipire (în producție gcs-worker) rulează când apare.
    const ingested: number[] = [];
    const worker = setInterval(() => {
      for (const job of w.enqueued.splice(0)) {
        if (job.name === "servers.demos.ingest" && typeof job.data.demoId === "number") void w.bridge.demos.ingest(job.data.demoId).then(() => ingested.push(job.data.demoId as number));
      }
    }, 100);
    try {
      const child = spawn(dotnet!, ["run", "--project", project, "-c", "Release", "--", url, token, ctx.matchId, file], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
      const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
      const steps = stdout
        .split(/\r?\n/)
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
      expect(steps.find((s) => s.step === "heartbeat")).toEqual({ step: "heartbeat", status: 200, demos: true, upload: true, chunkSize: 524_288 });
      // Pauza după prima bucată (meciul de pe server), apoi reluarea; fișierul local șters după `done`.
      const done = steps.find((s) => s.step === "done")!;
      expect(done).toMatchObject({ remaining: 0, fileExists: false });
      // Cel puțin: runda întreruptă, runda reluată (până la ultima bucată) și runda care primește `done`.
      expect(done.rounds as number).toBeGreaterThanOrEqual(3);
      const row = await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id } });
      expect(row).toMatchObject({ status: "AVAILABLE", size: demo.length, source: "plugin" });
      expect(ingested).toEqual([row.id]);
      const opened = await w.bridge.demos.open(w.guest, row.id, "crosscheck");
      expect(Buffer.from(await new Response(opened.body).arrayBuffer()).equals(demo)).toBe(true);
      expect((await w.bridge.store.roster(id))?.tv).toEqual({ enabled: true, delay: 105, port: 27020, recording: false });
    } finally {
      clearInterval(worker);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 300_000);
});
