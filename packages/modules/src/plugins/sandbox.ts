import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { PLUGIN_TIMEOUTS, type GcsPluginCallKind } from "@gcs/core";
import { PLUGIN_WORKER_SOURCE } from "./worker-source";

/** Rezultatul maxim al unui apel (JSON, caractere). */
export const PLUGIN_MAX_RESULT = 512 * 1024;
/** Câte apeluri ale contextului poate avea un plugin în curs, simultan. */
const MAX_PENDING_RPC = 64;

export class GcsPluginTimeout extends Error {
  constructor(readonly kind: string, readonly handler: string, readonly ms: number) {
    super(`timeout after ${ms} ms (${kind} ${handler})`);
    this.name = "GcsPluginTimeout";
  }
}

export type GcsSandboxCall = {
  kind: Exclude<GcsPluginCallKind, "init">;
  name: string;
  input: unknown;
  viewer: { userId: string | null } | null;
  token: string | null;
  locale: string;
  timeoutMs?: number;
};

export type GcsSandboxOptions = {
  key: string;
  version: string;
  /** Folderul cu fișierele pluginului (dezarhivat). */
  dir: string;
  settings: Record<string, unknown>;
  langs: Record<string, unknown>;
  /** Handler-ele cerute de manifest (verificate la pornire). */
  required: { kind: string; name: string }[];
  /** Un apel al contextului (`ctx.db.query`…), venit din fir. Rezultatul trebuie să fie JSON. */
  onRpc: (method: string, args: unknown[], token: string | null) => Promise<unknown>;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
  /** Firul s-a oprit singur (eroare, memorie depășită). */
  onExit?: (reason: string) => void;
  memoryMb?: number;
};

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/**
 * Firul izolat al unui plugin (designul pluginurilor §3.1): pornit la cerere, cu limite de memorie, fără variabilele de
 * mediu ale procesului. Fiecare apel are un timeout; dacă după un timeout firul nu mai răspunde nici la ping
 * (ex. o buclă infinită), e oprit și repornit la următorul apel.
 */
export class GcsPluginSandbox {
  private worker: Worker | null = null;
  private starting: Promise<void> | null = null;
  private seq = 0;
  private readonly calls = new Map<number, Pending>();
  private readonly pongs = new Map<number, () => void>();
  private rpcInFlight = 0;
  private stopped = false;
  /** Ultima eroare de pornire (afișată în ACP). */
  lastStartError: string | null = null;

  constructor(private readonly opts: GcsSandboxOptions) {}

  get running(): boolean {
    return this.worker !== null;
  }

  /** Pornește firul și importă `server.mjs` (o singură dată; apelurile simultane așteaptă aceeași pornire). */
  start(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("sandbox_stopped"));
    if (this.worker && !this.starting) return Promise.resolve();
    this.starting ??= this.spawn().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private spawn(): Promise<void> {
    const { opts } = this;
    const root = pathToFileURL(opts.dir.endsWith("/") || opts.dir.endsWith("\\") ? opts.dir : `${opts.dir}/`).href;
    const worker = new Worker(PLUGIN_WORKER_SOURCE, {
      eval: true,
      env: {},
      execArgv: [],
      argv: [],
      stdout: true,
      stderr: true,
      name: `gcs-plugin:${opts.key}`,
      workerData: {
        rootUrl: root.endsWith("/") ? root : `${root}/`,
        entryUrl: new URL("server.mjs", root.endsWith("/") ? root : `${root}/`).href,
        key: opts.key,
        version: opts.version,
        maxResult: PLUGIN_MAX_RESULT,
        settings: opts.settings,
        langs: opts.langs,
      },
      resourceLimits: { maxOldGenerationSizeMb: opts.memoryMb ?? 96, maxYoungGenerationSizeMb: 16, codeRangeSizeMb: 16, stackSizeMb: 4 },
    });
    // Ieșirea standard a firului nu ajunge în log-ul serverului (pluginul scrie prin `ctx.log`).
    worker.stdout.resume();
    worker.stderr.resume();
    this.worker = worker;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          this.lastStartError = error.message;
          void this.kill(error.message);
          reject(error);
        } else {
          this.lastStartError = null;
          resolve();
        }
      };
      const timer = setTimeout(() => done(new Error(`init timeout after ${PLUGIN_TIMEOUTS.init} ms`)), PLUGIN_TIMEOUTS.init);
      worker.on("message", (msg: unknown) => {
        if (!msg || typeof msg !== "object") return;
        const m = msg as Record<string, unknown>;
        if (m.t === "booted") worker.postMessage({ t: "init", required: opts.required });
        else if (m.t === "ready") done();
        else if (m.t === "init-error") done(new Error(String(m.error ?? "init failed").slice(0, 1000)));
        else this.onMessage(worker, m);
      });
      worker.on("error", (error) => {
        done(error);
        this.failAll(`worker error: ${error.message}`);
      });
      worker.on("exit", (code) => {
        if (this.worker === worker) this.worker = null;
        done(new Error(`worker exited (${code})`));
        this.failAll(`worker exited (${code})`);
        if (!this.stopped) opts.onExit?.(`exit ${code}`);
      });
    });
  }

  private onMessage(worker: Worker, m: Record<string, unknown>): void {
    switch (m.t) {
      case "result": {
        const id = Number(m.id);
        const p = this.calls.get(id);
        if (!p) return;
        this.calls.delete(id);
        clearTimeout(p.timer);
        if (m.ok === true && typeof m.json === "string" && m.json.length <= PLUGIN_MAX_RESULT) {
          try {
            p.resolve(JSON.parse(m.json));
          } catch {
            p.reject(new Error("result_not_json"));
          }
        } else p.reject(new Error(typeof m.error === "string" ? m.error.slice(0, 500) : "call_failed"));
        return;
      }
      case "pong": {
        const id = Number(m.id);
        this.pongs.get(id)?.();
        this.pongs.delete(id);
        return;
      }
      case "log": {
        const level = m.level === "error" || m.level === "warn" ? m.level : "info";
        this.opts.onLog(level, String(m.message ?? "").slice(0, 1000));
        return;
      }
      case "rpc": {
        const id = Number(m.id);
        const method = typeof m.method === "string" ? m.method.slice(0, 40) : "";
        const args = Array.isArray(m.args) ? m.args : [];
        const token = typeof m.token === "string" ? m.token : null;
        if (this.rpcInFlight >= MAX_PENDING_RPC) {
          worker.postMessage({ t: "rpc-result", id, ok: false, error: "too_many_requests" });
          return;
        }
        this.rpcInFlight++;
        this.opts
          .onRpc(method, args, token)
          .then(
            (value) => worker.postMessage({ t: "rpc-result", id, ok: true, value: value === undefined ? null : value }),
            (error: unknown) =>
              worker.postMessage({ t: "rpc-result", id, ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "rpc_failed", code: (error as { code?: string })?.code }),
          )
          .catch(() => {})
          .finally(() => this.rpcInFlight--);
        return;
      }
    }
  }

  private failAll(reason: string): void {
    for (const [id, p] of this.calls) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.calls.delete(id);
    }
  }

  /** Apelează un handler al pluginului, cu timeout. */
  async call(c: GcsSandboxCall): Promise<unknown> {
    await this.start();
    const worker = this.worker;
    if (!worker) throw new Error("worker_unavailable");
    const id = ++this.seq;
    const ms = c.timeoutMs ?? PLUGIN_TIMEOUTS[c.kind];
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new GcsPluginTimeout(c.kind, c.name, ms));
        void this.checkAlive(worker);
      }, ms);
      this.calls.set(id, { resolve, reject, timer });
      worker.postMessage({ t: "call", id, kind: c.kind, name: c.name, input: c.input, viewer: c.viewer, token: c.token, locale: c.locale });
    });
  }

  /** După un timeout: dacă firul nu răspunde la ping într-o secundă (ex. buclă infinită), e oprit. */
  private async checkAlive(worker: Worker): Promise<void> {
    const id = ++this.seq;
    const alive = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pongs.delete(id);
        resolve(false);
      }, 1000);
      this.pongs.set(id, () => {
        clearTimeout(timer);
        resolve(true);
      });
      worker.postMessage({ t: "ping", id });
    });
    if (!alive && this.worker === worker) await this.kill("unresponsive");
  }

  updateSettings(settings: Record<string, unknown>): void {
    this.opts.settings = settings;
    this.worker?.postMessage({ t: "settings", settings });
  }

  private async kill(reason: string): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.failAll(reason);
    if (worker) await worker.terminate().catch(() => {});
  }

  /** Oprește definitiv firul (pluginul se descarcă). */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.kill("stopped");
  }
}
