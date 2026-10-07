import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { PLUGIN_TIMEOUTS, type GcsPluginCallKind } from "@gcs/core";
import { PLUGIN_WORKER_SOURCE } from "./worker-source";

/** Rezultatul maxim al unui apel (JSON, caractere): încape o pagină de plugin la limita sanitizer-ului (900 KB). */
export const PLUGIN_MAX_RESULT = 1536 * 1024;
/** Câte apeluri ale contextului poate avea un plugin în curs, simultan. */
const MAX_PENDING_RPC = 64;
/**
 * Câte apeluri ale handler-elor pot aștepta simultan un fir (inclusiv cele respinse ca ocupate, încă în coada lui);
 * peste limită sunt respinse imediat.
 */
export const PLUGIN_MAX_PENDING_CALLS = 256;

/** Handler-ul a rulat mai mult decât îi era permis (timpul se măsoară de când a început să ruleze, nu din coadă). */
export class GcsPluginTimeout extends Error {
  constructor(readonly kind: string, readonly handler: string, readonly ms: number) {
    super(`timeout after ${ms} ms (${kind} ${handler})`);
    this.name = "GcsPluginTimeout";
  }
}

/**
 * Apelul nu a ajuns să ruleze sau a fost întrerupt din afara lui: firul ocupat (coada), prea multe apeluri, firul oprit,
 * repornit sau căzut din cauza altui apel. Nu e un eșec al acestui handler (nu se numără la dezactivarea automată).
 */
export class GcsPluginUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "GcsPluginUnavailable";
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
  /**
   * Firul a căzut singur (pornire eșuată, memorie depășită, ieșire neașteptată): cel mult o dată pe fir, niciodată
   * pentru un fir oprit de gazdă (`stop`, firul blocat oprit după un timeout, deja numărat ca timeout).
   */
  onCrash?: (reason: string, phase: "init" | "run") => void;
  memoryMb?: number;
};

type Pending = {
  worker: Worker;
  kind: string;
  name: string;
  ms: number;
  started: boolean;
  /** Respins deja ca ocupat: rămâne urmărit până la `result`, ca un handler care totuși începe să aibă timeout. */
  abandoned: boolean;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Firul izolat al unui plugin (designul pluginurilor §3.1): pornit la cerere, cu limite de memorie, fără variabilele de
 * mediu ale procesului. Fiecare apel are un timeout, măsurat de când handler-ul începe să ruleze (firul confirmă
 * începutul); un apel care nu începe în același interval (firul e ocupat) e respins ca indisponibil, iar firul nu îl
 * mai rulează după acest termen. Dacă totuși începe (cursa cu termenul), rulează tot sub timeout. Dacă după un
 * timeout firul nu mai răspunde nici la ping (ex. o buclă infinită), e oprit și repornit la următorul apel.
 */
export class GcsPluginSandbox {
  private worker: Worker | null = null;
  private starting: Promise<void> | null = null;
  /** Verificarea de viață în curs (după un timeout): apelurile noi o așteaptă, ca să nu ajungă în coada unui fir blocat. */
  private probing: Promise<void> | null = null;
  private seq = 0;
  private readonly calls = new Map<number, Pending>();
  private readonly pongs = new Map<number, () => void>();
  /** Firele oprite de gazdă: ieșirea lor nu e o cădere a pluginului. */
  private readonly killed = new WeakSet<Worker>();
  /** Operațiile interne în curs (verificări de viață, opriri), pentru `idle()`. */
  private readonly ops = new Set<Promise<unknown>>();
  private rpcInFlight = 0;
  private stopped = false;
  /** Ultima eroare de pornire (afișată în ACP). */
  lastStartError: string | null = null;

  constructor(private readonly opts: GcsSandboxOptions) {}

  get running(): boolean {
    return this.worker !== null;
  }

  /** Are operații interne în curs (verificare de viață, oprirea unui fir)? */
  get busy(): boolean {
    return this.ops.size > 0;
  }

  /** Așteaptă operațiile interne în curs; pentru teste și oprire. */
  async idle(): Promise<void> {
    while (this.ops.size > 0) await Promise.allSettled([...this.ops]);
  }

  private op<T>(p: Promise<T>): Promise<T> {
    const tracked = p.finally(() => this.ops.delete(tracked));
    this.ops.add(tracked);
    return tracked;
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
      // O cădere se raportează o singură dată pe fir ('error' e urmat de 'exit'), și doar dacă nu gazda l-a oprit.
      let crashed = false;
      const crash = (reason: string) => {
        if (crashed || this.stopped || this.killed.has(worker)) return;
        crashed = true;
        opts.onCrash?.(reason, settled ? "run" : "init");
      };
      const done = (error?: Error) => {
        if (settled) return;
        if (error) crash(error.message);
        settled = true;
        clearTimeout(timer);
        if (error) {
          this.lastStartError = error.message;
          void this.kill(worker, error.message);
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
      // Evenimentele unui fir vechi (deja înlocuit) ating doar apelurile lui, nu pe cele ale firului nou.
      worker.on("error", (error) => {
        crash(`worker error: ${error.message}`);
        done(error);
        this.failAll(worker, `worker error: ${error.message}`);
      });
      worker.on("exit", (code) => {
        if (this.worker === worker) this.worker = null;
        crash(`exit ${code}`);
        done(new Error(`worker exited (${code})`));
        this.failAll(worker, `worker exited (${code})`);
      });
    });
  }

  private onMessage(worker: Worker, m: Record<string, unknown>): void {
    switch (m.t) {
      case "started": {
        // Handler-ul a început să ruleze: de acum curge timeout-ul lui. Și pentru un apel deja respins ca ocupat
        // (apelantul nu mai află nimic, nu se numără), ca un handler blocat să nu țină firul ocupat pentru totdeauna.
        const id = Number(m.id);
        const p = this.calls.get(id);
        if (!p || p.worker !== worker || p.started) return;
        p.started = true;
        clearTimeout(p.timer);
        p.timer = setTimeout(() => {
          this.calls.delete(id);
          if (!p.abandoned) p.reject(new GcsPluginTimeout(p.kind, p.name, p.ms));
          void this.checkAlive(worker);
        }, p.ms);
        return;
      }
      case "result": {
        const id = Number(m.id);
        const p = this.calls.get(id);
        if (!p || p.worker !== worker) return;
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

  /** Respinge apelurile în curs ale unui fir (sau toate, fără fir), ca indisponibile. */
  private failAll(worker: Worker | null, reason: string): void {
    for (const [id, p] of this.calls) {
      if (worker && p.worker !== worker) continue;
      clearTimeout(p.timer);
      p.reject(new GcsPluginUnavailable(reason));
      this.calls.delete(id);
    }
  }

  /** Apelează un handler al pluginului, cu timeout. */
  async call(c: GcsSandboxCall): Promise<unknown> {
    while (this.probing) await this.probing;
    try {
      await this.start();
    } catch (error) {
      // Căderea la pornire e raportată o dată, prin `onCrash`; apelul doar n-a putut rula.
      throw new GcsPluginUnavailable(error instanceof Error ? error.message : String(error));
    }
    const worker = this.worker;
    if (!worker) throw new GcsPluginUnavailable("worker_unavailable");
    if (this.calls.size >= PLUGIN_MAX_PENDING_CALLS) throw new GcsPluginUnavailable("overloaded");
    const id = ++this.seq;
    const ms = c.timeoutMs ?? PLUGIN_TIMEOUTS[c.kind];
    return new Promise<unknown>((resolve, reject) => {
      // Până la confirmarea începutului, apelul stă în coada firului (ocupat cu alt handler sincron). Respins ca
      // ocupat, rămâne urmărit: firul îl refuză după `deadline` (`expired`), iar dacă totuși începe, are timeout.
      const timer = setTimeout(() => {
        const p = this.calls.get(id);
        if (p) p.abandoned = true;
        reject(new GcsPluginUnavailable("busy"));
      }, ms);
      this.calls.set(id, { worker, kind: c.kind, name: c.name, ms, started: false, abandoned: false, resolve, reject, timer });
      const deadline = Date.now() + ms;
      worker.postMessage({ t: "call", id, kind: c.kind, name: c.name, input: c.input, viewer: c.viewer, token: c.token, locale: c.locale, deadline });
    });
  }

  /** După un timeout: dacă firul nu răspunde la ping într-o secundă (ex. buclă infinită), e oprit. */
  private checkAlive(worker: Worker): Promise<void> {
    if (this.probing) return this.probing;
    const probe = (async () => {
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
      if (!alive && this.worker === worker) await this.kill(worker, "unresponsive");
    })().finally(() => {
      this.probing = null;
    });
    this.probing = probe;
    return this.op(probe);
  }

  updateSettings(settings: Record<string, unknown>): void {
    this.opts.settings = settings;
    this.worker?.postMessage({ t: "settings", settings });
  }

  /** Oprește un fir (gazda l-a oprit: ieșirea lui nu se mai raportează ca o cădere). */
  private kill(worker: Worker, reason: string): Promise<void> {
    if (this.worker === worker) this.worker = null;
    this.killed.add(worker);
    this.failAll(worker, reason);
    return this.op(worker.terminate().then(
      () => {},
      () => {},
    ));
  }

  /** Oprește definitiv firul (pluginul se descarcă). */
  async stop(): Promise<void> {
    this.stopped = true;
    const worker = this.worker;
    if (worker) await this.kill(worker, "stopped");
    this.failAll(null, "stopped");
  }
}
