import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GcsPluginSandbox, GcsPluginTimeout, GcsPluginUnavailable, PLUGIN_MAX_PENDING_CALLS, type GcsSandboxCall } from "./sandbox";

const SERVER = `
export default {
  widgets: {
    ok: () => "ok",
    block: (input) => { const end = Date.now() + input.ms; while (Date.now() < end) {} return "gata"; },
    spin: () => { while (true) {} },
    oom: () => { const keep = []; for (;;) keep.push(new Array(1e6).fill(Math.random())); },
  },
};`;

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

/** Un fir de plugin real, dintr-un folder temporar cu `server.mjs`. */
async function sandbox(opts: { memoryMb?: number } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gcs-sandbox-"));
  await writeFile(path.join(dir, "server.mjs"), SERVER);
  const crashes: string[] = [];
  const box = new GcsPluginSandbox({
    key: "acme.box",
    version: "1.0.0",
    dir,
    settings: {},
    langs: {},
    required: [],
    onRpc: async () => null,
    onLog: () => {},
    onCrash: (reason) => crashes.push(reason),
    ...opts,
  });
  cleanup.push(async () => {
    await box.stop();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return { box, crashes };
}

const widget = (name: string, input: unknown = {}, timeoutMs?: number): GcsSandboxCall => ({
  kind: "widget",
  name,
  input,
  viewer: null,
  token: null,
  locale: "ro",
  ...(timeoutMs ? { timeoutMs } : {}),
});

describe("firul pluginului: timeout-uri și căderi", () => {
  test("timpul din coada firului nu e timeout: apelul care n-a început e respins ca indisponibil", async () => {
    const { box, crashes } = await sandbox();
    await box.start();
    const calls = [1, 2, 3].map(() => box.call(widget("block", { ms: 1000 }, 1600)).then((v) => v, (e: unknown) => e));
    const [first, second, third] = await Promise.all(calls);
    expect(first).toBe("gata");
    // A așteptat ~1 s în coadă, apoi a rulat ~1 s: în limita de 1,6 s de când a început.
    expect(second).toBe("gata");
    expect(third).toBeInstanceOf(GcsPluginUnavailable);
    expect((third as Error).message).toBe("busy");
    expect(crashes).toEqual([]);
  }, 20_000);

  test("apelul respins ca ocupat nu mai rulează când firul ajunge la el (termenul trimis firului)", async () => {
    const { box, crashes } = await sandbox();
    await box.start();
    const first = box.call(widget("block", { ms: 1000 }, 1600));
    // Respins ca ocupat la 0,5 s; firul ajunge la el abia la ~1 s și nu îl mai rulează.
    const spin = await box.call(widget("spin", {}, 500)).then((v) => v, (e: unknown) => e);
    expect(spin).toBeInstanceOf(GcsPluginUnavailable);
    expect((spin as Error).message).toBe("busy");
    expect(await first).toBe("gata");
    expect(await box.call(widget("ok", {}, 1000))).toBe("ok");
    expect(crashes).toEqual([]);
  }, 20_000);

  test("apelul respins ca ocupat care totuși începe rulează sub timeout: firul blocat e oprit și repornit", async () => {
    const { box, crashes } = await sandbox();
    await box.start();
    const first = box.call(widget("block", { ms: 1000 }, 1600));
    // Cursa „started” / termen: firul primește un termen mai târziu decât cel al gazdei, deci pornește apelul respins.
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 60_000);
    const spinCall = box.call(widget("spin", {}, 500)).then((v) => v, (e: unknown) => e);
    await new Promise((resolve) => setImmediate(resolve));
    clock.mockRestore();
    const spin = await spinCall;
    expect(spin).toBeInstanceOf(GcsPluginUnavailable);
    expect((spin as Error).message).toBe("busy");
    expect(await first).toBe("gata");
    // Bucla pornită după respingere e prinsă de timeout: firul e oprit, un apel ulterior merge pe un fir nou.
    await vi.waitFor(async () => expect(await box.call(widget("ok", {}, 300))).toBe("ok"), { timeout: 10_000, interval: 100 });
    await box.idle();
    expect(crashes).toEqual([]);
  }, 20_000);

  test("buclă infinită: un singur timeout, firul oprit nu e raportat ca o cădere, apelul următor merge pe un fir nou", async () => {
    const { box, crashes } = await sandbox();
    await expect(box.call(widget("spin", {}, 500))).rejects.toBeInstanceOf(GcsPluginTimeout);
    // Imediat după: apelul așteaptă verificarea firului blocat (nu intră în coada lui) și rulează pe un fir nou.
    expect(await box.call(widget("ok"))).toBe("ok");
    await box.idle();
    expect(crashes).toEqual([]);
  }, 20_000);

  test("căderea firului (memorie depășită) se raportează o dată; apelul în curs e indisponibil", async () => {
    const { box, crashes } = await sandbox({ memoryMb: 32 });
    await expect(box.call(widget("oom", {}, 20_000))).rejects.toBeInstanceOf(GcsPluginUnavailable);
    await vi.waitFor(() => expect(box.running).toBe(false), { timeout: 10_000 });
    expect(crashes).toHaveLength(1);
    expect(await box.call(widget("ok"))).toBe("ok");
    expect(crashes).toHaveLength(1);
  }, 40_000);

  test("prea multe apeluri în așteptare: respinse imediat; oprirea respinge apelurile rămase ca indisponibile", async () => {
    const { box, crashes } = await sandbox();
    await box.start();
    const pending = Array.from({ length: PLUGIN_MAX_PENDING_CALLS }, (_, i) =>
      box.call(widget(i === 0 ? "block" : "ok", { ms: 1500 }, 10_000)).then((v) => v, (e: unknown) => e),
    );
    const extra = await box.call(widget("ok")).then((v) => v, (e: unknown) => e);
    expect(extra).toBeInstanceOf(GcsPluginUnavailable);
    expect((extra as Error).message).toBe("overloaded");
    await box.stop();
    const results = await Promise.all(pending);
    expect(results.every((r) => r instanceof GcsPluginUnavailable && r.message === "stopped")).toBe(true);
    expect(crashes).toEqual([]);
  }, 20_000);
});
