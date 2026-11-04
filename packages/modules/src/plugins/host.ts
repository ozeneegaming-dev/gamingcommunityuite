import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  GcsError,
  GcsValidationError,
  isSafeArchivePath,
  PLUGIN_DEFAULT_PRIORITY,
  PLUGIN_EVENTS,
  PLUGIN_JOB,
  PLUGIN_LOCALES,
  PLUGIN_MAX_FAILURES_DEFAULT,
  PLUGIN_TIMEOUTS,
  pluginCssScope,
  pluginRegistryKey,
  sanitizePluginHtml,
  scopePluginCss,
  type GcsActor,
  type GcsEvent,
  type GcsEventBus,
  type GcsForumListSlots,
  type GcsJobQueue,
  type GcsSlotItem,
  type GcsSlotStyle,
  type GcsModule,
  type GcsModuleRegistry,
  type GcsPermissionService,
  type GcsMemberAppearanceService,
  type GcsPluginDatabase,
  type GcsPluginDbCredentials,
  type GcsPluginLoadable,
  type GcsPluginManifest,
  type GcsPluginMediaInfo,
  type GcsPluginMediaService,
  type GcsPluginRow,
  type GcsPluginService,
  type GcsKv,
} from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsBotContent, GcsCommunityBot } from "../bot/service";
import { pluginBotFeature } from "../bot/settings";
import type Redis from "ioredis";
import type { GcsPluginPublicApi } from "./api";
import { extractPlugin, pluginFilesDir } from "./files";
import { pluginFetch } from "./http";
import { GcsPluginTexts, pluginIcon, pluginModule, type GcsPluginForumBridge, type GcsPluginLangs } from "./module";
import { GcsPluginSandbox, GcsPluginTimeout, GcsPluginUnavailable, type GcsSandboxCall } from "./sandbox";

/** Canalul Redis pe care procesele află că starea pluginurilor s-a schimbat. */
export const PLUGINS_CHANNEL = "gcs:plugins";
const RECONCILE_EVERY_MS = 60_000;
const METRICS_EVERY_MS = 10_000;
const LOGS_PER_MINUTE = 60;
const CACHE_MAX_BYTES = 64 * 1024;

type CallKind = GcsSandboxCall["kind"];

type Loaded = {
  row: GcsPluginRow;
  sha: string;
  settingsHash: string;
  dir: string;
  texts: GcsPluginTexts;
  module: GcsModule;
  sandbox: GcsPluginSandbox;
  /** CSS-ul declarat, deja închis în containerul pluginului (cale → CSS). */
  css: Map<string, string>;
  creds: GcsPluginDbCredentials | null | undefined;
  failing: boolean;
  logWindow: number;
  logCount: number;
};

type Metric = { count: number; failures: number; totalMs: number; maxMs: number };

export type GcsPluginHookMetrics = Record<string, Metric>;

export type GcsPluginRenderedHtml = { html: string; styles: string[]; scripts: string[] };

export type GcsPluginPageResult =
  | { status: 200; title: string; icon: string; html: string; styles: string[]; scripts: string[] }
  | { status: 403 | 404 | 500 }
  | { status: 302; redirect: string };

export type GcsPluginMenuEntry = { key: string; label: string; href: string; icon: string };

/** Randarea unui șablon de plugin (`{ template, data }`); o furnizează motorul de șabloane, când există. */
export type GcsPluginTemplateRenderer = (plugin: string, template: string, data: Record<string, unknown>) => Promise<string>;

export type GcsPluginHostDeps = {
  db: PrismaClient;
  /** Cheile scurte (cache-ul pluginurilor, eșecurile, metricile): Redis în VPS, baza de date în Lite. */
  kv: GcsKv;
  /** Anunțul între procese (`PUBLISH`, doar VPS); lipsă = procesele află la reconcilierea periodică. */
  publish?: (channel: string, message: string) => Promise<unknown>;
  bus: GcsEventBus;
  registry: GcsModuleRegistry;
  permissions: GcsPermissionService;
  jobs: Pick<GcsJobQueue, "enqueue">;
  plugins: GcsPluginService;
  database: GcsPluginDatabase;
  api: GcsPluginPublicApi;
  /** Aspectul membrilor publicat de pluginuri (capabilitatea `appearance`). */
  appearance: GcsMemberAppearanceService;
  /** Fișierele media ale pluginurilor (capabilitatea `media`). */
  media: GcsPluginMediaService;
  /** Folderul în care se dezarhivează pluginurile (în afara codului aplicației). */
  dataDir: string;
  /** Folderul aplicațiilor premium instalate ca pachete (ex. Studio VIP); lipsă = același cu `dataDir`. */
  applicationsDir?: string;
  /** SVG-ul unei iconițe Font Awesome (pentru `<gcs-icon>` din HTML-ul pluginurilor). */
  iconSvg: (name: string) => string | null;
  /** Limba site-ului (evenimente, joburi). */
  siteLocale: () => Promise<string>;
  /** Botul comunității (capabilitatea `bot.post`); citit la apel, fiindcă se construiește după gazdă. */
  bot?: () => GcsCommunityBot;
  /** `GCS_PLUGINS_SAFE_MODE=1`: procesul nu încarcă niciun plugin. */
  safeMode?: boolean;
  maxFailures?: number;
  /** Conexiunea Redis pentru abonare (lipsă = fără anunțuri între procese, ex. în teste). */
  subscriber?: () => Redis;
};

const errorText = (error: unknown): string => {
  if (error instanceof GcsValidationError) return Object.values(error.fields).join(", ") || error.code;
  if (error instanceof GcsError) return error.params?.reason ?? error.code;
  return error instanceof Error ? error.message : String(error);
};

/**
 * Doar câmpurile simple din payload-ul unui eveniment (fără obiecte imbricate). O listă de obiecte simple devine câte o
 * listă pe câmp, la plural: `posts: [{ postId, authorId }]` → `postIds: […]`, `authorIds: […]`.
 */
export function plainPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const simple = (v: unknown) => v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  const clip = (v: unknown) => (typeof v === "string" ? v.slice(0, 500) : v);
  for (const [k, v] of Object.entries(payload)) {
    if (simple(v)) out[k] = clip(v);
    else if (Array.isArray(v) && v.length <= 100 && v.every(simple)) out[k] = v;
    else if (Array.isArray(v) && v.length <= 100 && v.every(record)) {
      for (const field of new Set(v.flatMap((item) => Object.keys(item)))) {
        const values = v.map((item) => item[field] ?? null);
        const name = `${field}s`;
        if (values.every(simple) && !(name in payload) && !(name in out)) out[name] = values.map(clip);
      }
    }
  }
  return out;
}

/**
 * O redirecționare a pluginului rămâne în spațiul lui (`prefix`, ex. `/p/<cheie>`): doar caractere sigure, fără `..`
 * și fără `.`, `/` sau `\` codate în cale (`%2e`, `%2f`, `%5c`), pe care browserul le-ar interpreta ca segmente.
 */
export function isPluginRedirect(target: string, prefix: string): boolean {
  if (!(target === prefix || target.startsWith(`${prefix}/`) || target.startsWith(`${prefix}?`))) return false;
  if (!/^[A-Za-z0-9._~/?=&%:-]+$/.test(target) || target.includes("..")) return false;
  return !/%(?:2e|2f|5c)/i.test(target.split("?")[0]!);
}

/** Potrivește o cale cu rutele declarate (`/`, `/stats`, `/item/:id`); rutele fixe au prioritate. */
export function matchPluginRoute(patterns: string[], rawPath: string): { pattern: string; params: Record<string, string> } | null {
  const segments = rawPath.split("/").filter(Boolean);
  if (segments.some((s) => s.length > 100)) return null;
  const sorted = [...patterns].sort((a, b) => (a.match(/:/g)?.length ?? 0) - (b.match(/:/g)?.length ?? 0));
  for (const pattern of sorted) {
    const parts = pattern.split("/").filter(Boolean);
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const seg = segments[i]!;
      if (part.startsWith(":")) {
        if (!/^[A-Za-z0-9_.~-]+$/.test(seg)) {
          ok = false;
          break;
        }
        params[part.slice(1)] = seg;
      } else if (part !== seg) {
        ok = false;
        break;
      }
    }
    if (ok) return { pattern, params };
  }
  return null;
}

/** Handler-ele cerute de manifest (verificate în fir la pornire). */
function requiredHandlers(m: GcsPluginManifest): { kind: string; name: string }[] {
  return [
    ...m.widgets.map((w) => ({ kind: "widget", name: w.key })),
    ...m.routes.pages.map((r) => ({ kind: "page", name: r.path })),
    ...m.routes.acp.map((r) => ({ kind: "acp", name: r.path })),
    ...m.routes.api.map((r) => ({ kind: "api", name: r.path })),
    ...m.events.map((e) => ({ kind: "event", name: e })),
    ...m.filters.map((f) => ({ kind: "filter", name: f.point })),
    ...m.hooks.map((h) => ({ kind: "hook", name: h.point })),
    ...m.jobs.map((j) => ({ kind: "job", name: j.key })),
  ];
}

/** Id-ul hook-ului (pagina Hook-uri, comutatoarele, metricile) pentru un apel. */
function hookId(kind: CallKind, name: string): string {
  switch (kind) {
    case "event":
    case "filter":
    case "hook":
      return name;
    default:
      return `${kind}:${name}`;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
};

/**
 * Gazda pluginurilor într-un proces (web sau `gcs-worker`), designul pluginurilor §3: încarcă pluginurile active
 * (registry + fir izolat), le ține la zi cu baza de date (anunțuri Redis + reconciliere periodică) și rulează hook-urile
 * cu timeout, metrici și dezactivare automată după prea multe eșecuri la rând.
 */
export class GcsPluginHost {
  private readonly loaded = new Map<string, Loaded>();
  private hookSettings = new Map<string, { enabled: boolean; priority: number | null }>();
  /** Jetoanele apelurilor în curs: userul și dacă apelul vine dintr-o rută / pagină ACP a pluginului (poarta ACP trecută). */
  private readonly tokens = new Map<string, { key: string; actor: GcsActor; expires: number; acp: boolean }>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly metrics = new Map<string, Map<string, Metric>>();
  private reconciling: Promise<void> | null = null;
  private reconcileAgain = false;
  private started: Promise<void> | null = null;
  private timers: NodeJS.Timeout[] = [];
  private subscriber: Redis | null = null;
  private guest: GcsActor | null = null;
  private templateRenderer: GcsPluginTemplateRenderer | null = null;

  constructor(private readonly deps: GcsPluginHostDeps) {
    // Evenimentele publice ajung la pluginuri asincron: emiterea (și cererea care a produs-o) nu le așteaptă.
    for (const name of PLUGIN_EVENTS) {
      deps.bus.on(name, async (e) => {
        this.dispatchEvent(e);
      });
    }
    // Aspectul membrilor contează doar pentru pluginurile încărcate acum, în ordinea priorității.
    deps.appearance.setActiveProvider(() => this.appearancePlugins());
  }

  /** Pluginurile încărcate cu `appearance` (și hook-ul `appearance` pornit), în ordinea priorității. */
  appearancePlugins(): string[] {
    return [...this.loaded.values()]
      .filter((l) => l.row.capabilities.includes("appearance") && this.hookEnabled(l.row.key, "appearance"))
      .sort((a, b) => this.priority(a.row.key, "appearance") - this.priority(b.row.key, "appearance") || a.row.key.localeCompare(b.row.key))
      .map((l) => l.row.key);
  }

  // ─── Pornire, oprire, reconciliere ───

  /** Pornește gazda: abonarea Redis, prima reconciliere și cea periodică. Idempotent. */
  start(): Promise<void> {
    this.started ??= (async () => {
      if (this.deps.subscriber) {
        try {
          const sub = this.deps.subscriber();
          sub.on("error", () => {});
          sub.on("message", (channel: string) => {
            if (channel === PLUGINS_CHANNEL) void this.reconcile();
          });
          await sub.subscribe(PLUGINS_CHANNEL);
          this.subscriber = sub;
        } catch (error) {
          console.error("[GCS] Pluginuri: abonarea Redis a eșuat", error);
        }
      }
      this.timers.push(setInterval(() => void this.reconcile(), RECONCILE_EVERY_MS).unref());
      this.timers.push(setInterval(() => void this.flushMetrics(), METRICS_EVERY_MS).unref());
      await this.reconcile();
    })();
    return this.started;
  }

  /** Așteaptă prima încărcare (cel mult `timeoutMs`), ca primele cereri să vadă pluginurile. */
  async ready(timeoutMs = 3000): Promise<void> {
    if (!this.started) return;
    await Promise.race([this.started.catch(() => {}), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.subscriber?.quit().catch(() => {});
    this.subscriber = null;
    await this.flushMetrics();
    for (const key of [...this.loaded.keys()]) await this.unload(key);
    await this.deps.database.close();
    this.started = null;
  }

  /** Anunță toate procesele (și pe acesta) că starea pluginurilor s-a schimbat. */
  async notify(): Promise<void> {
    await this.deps.publish?.(PLUGINS_CHANNEL, String(Date.now())).catch(() => 0);
    await this.reconcile();
  }

  /** Aduce pluginurile încărcate la starea din baza de date. Apelurile simultane se comasează. */
  reconcile(): Promise<void> {
    if (this.reconciling) {
      this.reconcileAgain = true;
      return this.reconciling;
    }
    this.reconciling = (async () => {
      const before = this.appearancePlugins().join(",");
      do {
        this.reconcileAgain = false;
        try {
          await this.doReconcile();
        } catch (error) {
          console.error("[GCS] Pluginuri: reconcilierea a eșuat", error);
        }
      } while (this.reconcileAgain);
      // Alt set de pluginuri cu aspect (activat, dezactivat, alt hook): CSS-ul numelor primește o versiune nouă.
      if (this.appearancePlugins().join(",") !== before) await this.deps.appearance.bump().catch(() => {});
    })().finally(() => {
      this.reconciling = null;
    });
    return this.reconciling;
  }

  private async doReconcile(): Promise<void> {
    const { plugins } = this.deps;
    if (this.deps.safeMode) {
      for (const key of [...this.loaded.keys()]) await this.unload(key);
      return;
    }
    const [states, hooks] = await Promise.all([plugins.states(), plugins.hookSettings()]);
    this.hookSettings = new Map(hooks.map((h) => [`${h.pluginKey}|${h.hook}`, { enabled: h.enabled, priority: h.priority }]));
    const desired = new Map(states.filter((s) => s.enabled && s.status === "installed" && s.sha).map((s) => [s.key, s]));
    for (const [key, l] of [...this.loaded]) {
      const want = desired.get(key);
      if (!want || want.sha !== l.sha) await this.unload(key);
      else if (want.settingsHash !== l.settingsHash) {
        const row = await plugins.get(key);
        if (row) {
          l.row = { ...l.row, settings: row.settings };
          l.settingsHash = want.settingsHash;
          l.sandbox.updateSettings(row.settings);
        }
      }
    }
    const missing = [...desired.keys()].filter((k) => !this.loaded.has(k));
    if (missing.length === 0) return;
    for (const row of await plugins.loadable(missing)) {
      try {
        await this.load(row, desired.get(row.key)!.settingsHash);
      } catch (error) {
        await plugins.log(row.key, "error", `load failed: ${errorText(error)}`, "init");
      }
    }
  }

  private async readLangs(dir: string): Promise<GcsPluginLangs> {
    const langs: GcsPluginLangs = {};
    for (const locale of PLUGIN_LOCALES) {
      try {
        langs[locale] = JSON.parse(await readFile(path.join(dir, "lang", `${locale}.json`), "utf8")) as Record<string, unknown>;
      } catch {
        // Limba lipsește: se folosesc engleza, apoi româna.
      }
    }
    return langs;
  }

  private async load(row: GcsPluginLoadable, settingsHash: string): Promise<void> {
    const key = row.key;
    const base = pluginFilesDir(key, { plugins: this.deps.dataDir, applications: this.deps.applicationsDir });
    const dir = await extractPlugin(base, key, row.packageSha256!, row.package);
    const langs = await this.readLangs(dir);
    const texts = new GcsPluginTexts(key, row.manifest, langs);
    const module = pluginModule(key, row.manifest, texts, this.forumBridge(key));
    const css = new Map<string, string>();
    for (const style of row.manifest.client.styles) {
      const scoped = scopePluginCss(await readFile(path.join(dir, ...style.split("/")), "utf8"), { pluginKey: key, file: style });
      if (scoped.ok) css.set(style, scoped.css);
    }
    const sandbox = new GcsPluginSandbox({
      key,
      version: row.version,
      dir,
      settings: row.settings,
      langs,
      required: requiredHandlers(row.manifest),
      onRpc: (method, args, token) => this.rpc(key, method, args, token),
      onLog: (level, message) => this.pluginLog(key, level, message),
      // O cădere a firului se numără o dată, și doar pentru firul versiunii încărcate acum.
      onCrash: (reason, phase) => {
        if (this.loaded.get(key)?.sandbox === sandbox) this.track(this.recordFailure(key, phase === "init" ? "init" : "worker", reason, null, true));
      },
    });
    this.deps.registry.unregister(module.key);
    this.deps.registry.register(module);
    this.loaded.set(key, { row, sha: row.packageSha256!, settingsHash, dir, texts, module, sandbox, css, creds: undefined, failing: false, logWindow: 0, logCount: 0 });
    await this.deps.kv.del(this.failKey(key)).catch(() => 0);
    // Firul pornește acum; o eroare de pornire ajunge prin `onCrash` (se numără ca eșec și apare în jurnalul pluginului).
    this.track(sandbox.start());
  }

  private async unload(key: string): Promise<void> {
    const l = this.loaded.get(key);
    if (!l) return;
    this.loaded.delete(key);
    this.deps.registry.unregister(l.module.key);
    for (const [token, t] of this.tokens) if (t.key === key) this.tokens.delete(token);
    await l.sandbox.stop();
    await this.deps.database.closePool(key);
  }

  // ─── Apelurile ───

  private failKey(key: string): string {
    return `gcs:plugin:fail:${key}`;
  }

  private hookEnabled(key: string, hook: string): boolean {
    return this.hookSettings.get(`${key}|${hook}`)?.enabled ?? true;
  }

  private priority(key: string, hook: string, fallback = PLUGIN_DEFAULT_PRIORITY): number {
    return this.hookSettings.get(`${key}|${hook}`)?.priority ?? fallback;
  }

  private async guestActor(): Promise<GcsActor> {
    if (!this.guest) {
      const group = await this.deps.db.group.findUnique({ where: { key: "guest" }, select: { id: true } });
      this.guest = { userId: null, groupIds: group ? [group.id] : [], primaryGroupId: group?.id ?? 0, isBanned: false, ip: "plugin" };
    }
    return this.guest;
  }

  private issueToken(key: string, actor: GcsActor, acp = false): string {
    const token = randomBytes(16).toString("hex");
    this.tokens.set(token, { key, actor, expires: Date.now() + 90_000, acp });
    return token;
  }

  /** Apelul vine dintr-o rută API sau o pagină ACP a pluginului (jetonul ei), deci de la staff cu acces ACP. */
  private acpCall(key: string, token: string | null): GcsActor | null {
    const entry = token ? this.tokens.get(token) : undefined;
    return entry && entry.key === key && entry.acp && entry.expires > Date.now() ? entry.actor : null;
  }

  private async actorFor(key: string, token: string | null): Promise<GcsActor> {
    const entry = token ? this.tokens.get(token) : undefined;
    if (entry && entry.key === key && entry.expires > Date.now()) return entry.actor;
    return this.guestActor();
  }

  private record(key: string, hook: string, ms: number, ok: boolean): void {
    let byHook = this.metrics.get(key);
    if (!byHook) this.metrics.set(key, (byHook = new Map()));
    const m = byHook.get(hook) ?? { count: 0, failures: 0, totalMs: 0, maxMs: 0 };
    m.count++;
    if (!ok) m.failures++;
    m.totalMs += ms;
    m.maxMs = Math.max(m.maxMs, ms);
    byHook.set(hook, m);
  }

  /**
   * Un apel al unui handler, cu timeout, metrici și numărarea eșecurilor. Vizitatorul (dacă există) primește un jeton
   * opac, valabil doar pe durata apelului: cu el, `ctx.api` și `ctx.permissions` citesc cu drepturile lui.
   */
  private async invoke(l: Loaded, kind: CallKind, name: string, input: unknown, opts: { actor: GcsActor | null; locale: string; timeoutMs?: number; acp?: boolean }): Promise<unknown> {
    // Pluginul a fost descărcat (sau înlocuit de altă versiune) între alegerea țintelor și apel: nu mai rulează.
    if (this.loaded.get(l.row.key) !== l) throw new GcsPluginUnavailable("plugin_unloaded");
    const hook = hookId(kind, name);
    const token = opts.actor ? this.issueToken(l.row.key, opts.actor, opts.acp === true) : null;
    const started = performance.now();
    try {
      const value = await l.sandbox.call({
        kind,
        name,
        input,
        viewer: opts.actor ? { userId: opts.actor.userId } : null,
        token,
        locale: opts.locale,
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      });
      this.record(l.row.key, hook, performance.now() - started, true);
      if (l.failing) {
        l.failing = false;
        await this.deps.kv.del(this.failKey(l.row.key)).catch(() => 0);
      }
      return value;
    } catch (error) {
      // Apelurile prinse de o descărcare sau reîncărcare nu sunt eșecuri ale pluginului (nici în metrici, nici în jurnal).
      if (this.loaded.get(l.row.key) !== l) throw error;
      const ms = performance.now() - started;
      this.record(l.row.key, hook, ms, false);
      if (error instanceof GcsPluginUnavailable) this.logLimited(l.row.key, "warn", errorText(error), hook, ms);
      else await this.recordFailure(l.row.key, hook, errorText(error), ms, error instanceof GcsPluginTimeout);
      throw error;
    } finally {
      if (token) this.tokens.delete(token);
    }
  }

  /**
   * Un eșec al pluginului, în jurnalul lui (limitat pe minut). Dezactivarea automată numără doar eșecurile care consumă
   * resursele procesului (`counted`): timeout-ul unui handler care chiar rula și căderea firului (pornire, memorie).
   * O eroare aruncată de handler se jurnalizează și apare în metrici, dar nu se numără: ea vine adesea din datele unei
   * cereri (un vizitator poate trimite oricând date pe care pluginul nu le așteaptă), iar altfel câteva cereri ar opri
   * pluginul pe tot site-ul. Apelurile respinse fără să ruleze (fir ocupat, supraîncărcat, oprit) nu ajung aici.
   */
  private async recordFailure(key: string, hook: string, message: string, ms: number | null, counted: boolean): Promise<void> {
    const l = this.loaded.get(key);
    this.logLimited(key, "error", message, hook, ms);
    if (!counted) return;
    if (l) l.failing = true;
    const count = await this.deps.kv.incr(this.failKey(key)).catch(() => 0);
    await this.deps.kv.expire(this.failKey(key), 86_400_000).catch(() => 0);
    const max = this.deps.maxFailures ?? PLUGIN_MAX_FAILURES_DEFAULT;
    if (count >= max) {
      await this.deps.kv.del(this.failKey(key)).catch(() => 0);
      if (await this.deps.plugins.autoDisable(key, count, `${hook}: ${message}`)) {
        console.error(`[GCS] Pluginul ${key} a fost dezactivat automat după ${count} eșecuri la rând (${hook}: ${message})`);
      }
    }
  }

  private pluginLog(key: string, level: "info" | "warn" | "error", message: string): void {
    this.logLimited(key, level, message, "log", null);
  }

  /** O intrare în jurnalul pluginului, cel mult `LOGS_PER_MINUTE` pe minut (și eșecurile: cererile nu inundă baza). */
  private logLimited(key: string, level: "info" | "warn" | "error", message: string, hook: string, ms: number | null): void {
    const l = this.loaded.get(key);
    if (!l) return;
    const now = Date.now();
    if (now - l.logWindow > 60_000) {
      l.logWindow = now;
      l.logCount = 0;
    }
    if (++l.logCount > LOGS_PER_MINUTE) return;
    this.track(this.deps.plugins.log(key, level, message, hook, ms === null ? null : Math.round(ms)));
  }

  private track<T>(p: Promise<T>): void {
    const tracked = p.catch(() => {}).finally(() => this.tasks.delete(tracked));
    this.tasks.add(tracked);
  }

  /**
   * Așteaptă tot ce rulează asincron și poate schimba starea: livrările, jurnalul, eșecurile numărate (cu dezactivarea
   * automată), reconcilierea, verificările și opririle firelor. Pentru teste și oprire.
   */
  async idle(): Promise<void> {
    for (;;) {
      const pending: Promise<unknown>[] = [...this.tasks];
      if (this.reconciling) pending.push(this.reconciling);
      for (const l of this.loaded.values()) if (l.sandbox.busy) pending.push(l.sandbox.idle());
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  // ─── Contextul pluginului (apelurile venite din fir) ───

  private async credsFor(l: Loaded): Promise<GcsPluginDbCredentials> {
    if (l.creds === undefined) l.creds = await this.deps.plugins.credentials(l.row.key);
    if (!l.creds) throw new Error("db_unavailable");
    return l.creds;
  }

  private async rpc(key: string, method: string, args: unknown[], token: string | null): Promise<unknown> {
    const l = this.loaded.get(key);
    if (!l) throw new Error("plugin_unloaded");
    const caps = new Set(l.row.capabilities);
    const need = (cap: string) => {
      if (!caps.has(cap as never)) throw new Error(`capability_required: ${cap}`);
    };
    try {
      switch (method) {
        case "db.query":
          need("db");
          return await this.deps.database.query(key, await this.credsFor(l), args[0] as string, (args[1] ?? []) as unknown[]);
        case "db.batch":
          need("db");
          return await this.deps.database.batch(key, await this.credsFor(l), args[0] as { sql: string; params?: unknown[] }[]);
        case "permissions.can": {
          const perm = String(args[0] ?? "");
          if (!l.row.manifest.permissions.some((p) => p.key === perm && p.scope === "group")) return false;
          return await this.deps.permissions.can(await this.actorFor(key, token), `${pluginRegistryKey(key)}.${perm}`);
        }
        case "api.users.get":
        case "api.topics.get":
        case "api.topics.recent":
        case "api.posts.get":
        case "api.posts.recent":
        case "api.forums.list":
        case "api.groups.list":
        case "api.stats":
        case "api.vip.plans":
        case "api.vip.status":
        case "api.vip.members":
        case "api.servers.byForums":
          return await this.deps.api.call(method, args, await this.actorFor(key, token));
        case "members.appearance.set":
          need("appearance");
          try {
            await this.deps.appearance.set(key, args[0], args[1] ?? null);
          } catch (error) {
            // Pluginul primește câmpurile greșite cu calea lor (`name.fill.colors.0: invalid_color`).
            if (error instanceof GcsValidationError) throw new Error(`invalid_appearance: ${Object.entries(error.fields).map(([k, v]) => `${k}: ${v}`).join(", ")}`.slice(0, 500));
            throw error;
          }
          return null;
        case "members.appearance.get":
          need("appearance");
          return await this.deps.appearance.get(key, args[0]);
        case "members.appearance.clear":
          need("appearance");
          return await this.deps.appearance.clear(key);
        case "members.appearance.styles.check":
          need("appearance");
          return this.deps.appearance.checkStyle(key, args[0], args[1], args[2]);
        case "members.appearance.styles.list":
          need("appearance");
          return await this.deps.appearance.listStyles(key, args[0] ?? undefined);
        case "members.appearance.styles.set": {
          need("appearance");
          // Stilurile CSS le scrie doar staff-ul, din ACP-ul pluginului: apelul trebuie să vină dintr-o rută ACP.
          const admin = this.acpCall(key, token);
          if (!admin) throw new Error("acp_required");
          return await this.deps.appearance.setStyle(key, args[0], args[1], args[2] === undefined ? null : args[2], { userId: admin.userId, ip: admin.ip ?? null });
        }
        case "media.keep":
          need("media");
          return await this.deps.media.keep(key, args[0]);
        case "media.get":
          need("media");
          return await this.deps.media.get(key, args[0]);
        case "media.list":
          need("media");
          return await this.deps.media.list(key, args[0]);
        case "media.delete":
          need("media");
          return await this.deps.media.delete(key, args[0]);
        case "media.usage":
          need("media");
          return await this.deps.media.usage(key);
        case "cache.get":
        case "cache.set":
        case "cache.delete":
          return await this.cache(key, method, args);
        case "jobs.enqueue": {
          need("jobs");
          const job = String(args[0] ?? "");
          if (!l.row.manifest.jobs.some((j) => j.key === job)) throw new Error("unknown_job");
          const data = args[1] && typeof args[1] === "object" ? args[1] : {};
          if (JSON.stringify(data).length > 16_384) throw new Error("data_too_large");
          await this.deps.jobs.enqueue(PLUGIN_JOB, { plugin: key, job, data: data as Record<string, unknown> });
          return null;
        }
        case "http.fetch":
          need("http-out");
          return await pluginFetch(args[0], args[1]);
        case "bot.post":
        case "bot.reply":
        case "bot.pm":
        case "bot.chat":
          need("bot.post");
          return await this.botCall(key, method, args[0]);
        default:
          throw new Error("unknown_method");
      }
    } catch (error) {
      throw new Error(errorText(error));
    }
  }

  /**
   * Botul comunității pentru un plugin (`bot.post`): funcția `plugin:<cheie>` (comutatorul din ACP), cheile de deduplicare
   * prefixate cu cheia pluginului, conținutul HTML curățat de nucleu. `null` = funcția e oprită din ACP.
   */
  private async botCall(key: string, method: string, raw: unknown): Promise<unknown> {
    const bot = this.deps.bot?.();
    if (!bot) throw new Error("bot_unavailable");
    const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const feature = pluginBotFeature(key);
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : Number.NaN);
    const content = (): GcsBotContent => {
      const c = (input.content ?? {}) as Record<string, unknown>;
      if (typeof c.html === "string") return { html: c.html.slice(0, 200_000) };
      if (typeof c.text === "string") return { text: c.text.slice(0, 50_000) };
      throw new GcsValidationError({ content: "required" });
    };
    const meta = (input.meta ?? {}) as Record<string, unknown>;
    const botMeta = {
      label: str(meta.label, 40) || null,
      sourceName: str(meta.sourceName, 120) || null,
      sourceUrl: str(meta.sourceUrl, 2000) || null,
      importEveryMinutes: Number.isSafeInteger(meta.importEveryMinutes) ? (meta.importEveryMinutes as number) : null,
    };
    const translateFrom = typeof input.translateFrom === "string" && /^[a-z]{2}$/.test(input.translateFrom) ? input.translateFrom : null;
    if (method === "bot.post") {
      return bot.post(feature, {
        forumId: int(input.forumId),
        title: str(input.title, 150),
        content: content(),
        prefixId: Number.isSafeInteger(input.prefixId) ? (input.prefixId as number) : null,
        ...(Array.isArray(input.tags) ? { tags: input.tags.filter((t): t is string => typeof t === "string").slice(0, 20) } : {}),
        lock: input.lock === true,
        pin: input.pin === true,
        dedupeKey: typeof input.dedupeKey === "string" && input.dedupeKey ? `${key}:${input.dedupeKey}` : null,
        meta: botMeta,
        translateFrom,
      });
    }
    if (method === "bot.reply") return bot.reply(feature, { topicId: int(input.topicId), content: content(), meta: botMeta, translateFrom });
    if (method === "bot.pm") {
      const to = Array.isArray(input.to) ? input.to.filter((t): t is string => typeof t === "string").slice(0, 20) : [];
      return bot.pm(feature, { to, title: str(input.title, 150), content: content() });
    }
    return bot.chat(feature, { channelKey: str(input.channelKey, 80), text: str(input.text, 2000) });
  }

  private async cache(key: string, method: string, args: unknown[]): Promise<unknown> {
    const name = String(args[0] ?? "");
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(name)) throw new Error("invalid_key");
    const redisKey = `gcs:plugin:cache:${key}:${name}`;
    if (method === "cache.get") {
      const raw = await this.deps.kv.get(redisKey);
      return raw === null ? null : (JSON.parse(raw) as unknown);
    }
    if (method === "cache.delete") {
      await this.deps.kv.del(redisKey);
      return null;
    }
    const json = JSON.stringify(args[1] ?? null);
    if (json.length > CACHE_MAX_BYTES) throw new Error("value_too_large");
    const ttl = Number.isInteger(args[2]) ? Math.min(Math.max(args[2] as number, 1), 86_400) : 300;
    await this.deps.kv.set(redisKey, json, { ttlMs: ttl * 1000 });
    return null;
  }

  // ─── HTML ───

  /** Pentru motorul de șabloane: randarea `{ template, data }` a pluginurilor. */
  setTemplateRenderer(renderer: GcsPluginTemplateRenderer | null): void {
    this.templateRenderer = renderer;
  }

  /**
   * HTML-ul unui plugin: normalizat, sanitizat și închis în containerul lui (`contain: paint`, clasa pluginului).
   * Paginile (`page`) pot avea formulare și elemente media, doar spre pluginul însuși.
   */
  private async html(l: Loaded, value: unknown, opts: { page?: boolean } = {}): Promise<string> {
    let raw = "";
    if (typeof value === "string") raw = value;
    else if (value && typeof value === "object" && typeof (value as { html?: unknown }).html === "string") raw = (value as { html: string }).html;
    else if (value && typeof value === "object" && typeof (value as { template?: unknown }).template === "string") {
      const v = value as { template: string; data?: unknown };
      if (!this.templateRenderer) {
        this.pluginLog(l.row.key, "warn", "templates are not available yet");
        return "";
      }
      raw = await this.templateRenderer(l.row.key, v.template, v.data && typeof v.data === "object" ? (v.data as Record<string, unknown>) : {});
    }
    const clean = sanitizePluginHtml(raw, { icon: this.deps.iconSvg, pluginKey: l.row.key, page: opts.page === true });
    if (!clean.trim()) return "";
    return `<div class="gcsp ${pluginCssScope(l.row.key)}" data-gcs-plugin="${l.row.key}">${clean}</div>`;
  }

  private styleUrls(l: Loaded): string[] {
    return [...l.css.keys()].map((p) => `/plugins/${l.row.key}/${p}?v=${l.sha.slice(0, 10)}`);
  }

  /** Scripturile unui plugin semnat cu `client-js` (pe site: paginile lui și unde apare un widget al lui; nu în ACP). */
  private scriptUrls(l: Loaded): string[] {
    if (!l.row.signed || !l.row.capabilities.includes("client-js")) return [];
    return l.row.manifest.client.scripts.map((p) => `/plugins/${l.row.key}/${p}?v=${l.sha.slice(0, 10)}`);
  }

  // ─── Hook-urile, pentru restul aplicației ───

  /** Livrează un eveniment public pluginurilor abonate (asincron, fără să întârzie emiterea). */
  dispatchEvent(e: GcsEvent): void {
    if (!(PLUGIN_EVENTS as readonly string[]).includes(e.name) || this.loaded.size === 0) return;
    const payload = plainPayload(e.payload);
    const targets = [...this.loaded.values()].filter((l) => (l.row.manifest.events as string[]).includes(e.name) && this.hookEnabled(l.row.key, e.name));
    if (targets.length === 0) return;
    this.track(
      (async () => {
        const locale = await this.deps.siteLocale().catch(() => "ro");
        targets.sort((a, b) => this.priority(a.row.key, e.name) - this.priority(b.row.key, e.name));
        await Promise.allSettled(targets.map((l) => this.invoke(l, "event", e.name, { name: e.name, payload }, { actor: null, locale })));
      })(),
    );
  }

  /**
   * Filtrul `post.before_save`: pluginurile, în ordinea priorității, pot modifica titlul și conținutul sau pot respinge
   * postarea (`GcsValidationError` pe `content`). O eroare sau un timeout sare pluginul (postarea nu se blochează).
   */
  async filterPost<T extends { title: string | null; content: unknown }>(data: T & { kind: string; forumId: number; topicId: number | null; authorId: string | null }, actor: GcsActor): Promise<T> {
    const point = "post.before_save";
    const targets = [...this.loaded.values()]
      .filter((l) => l.row.manifest.filters.some((f) => f.point === point) && this.hookEnabled(l.row.key, point))
      .sort((a, b) => this.priority(a.row.key, point, a.row.manifest.filters.find((f) => f.point === point)?.priority) - this.priority(b.row.key, point, b.row.manifest.filters.find((f) => f.point === point)?.priority));
    let current = data;
    for (const l of targets) {
      let result: unknown;
      try {
        result = await this.invoke(l, "filter", point, current, { actor, locale: await this.deps.siteLocale().catch(() => "ro") });
      } catch {
        continue;
      }
      if (result === null || result === undefined) continue;
      if (typeof result !== "object") continue;
      const r = result as { reject?: unknown; title?: unknown; content?: unknown };
      if (typeof r.reject === "string") {
        // Mesajul (tradus de plugin) apare ca atare lângă câmpul conținutului.
        throw new GcsValidationError({ content: `${l.row.manifest.name}: ${r.reject.slice(0, 300)}` }, { plugin: l.row.key });
      }
      const title = typeof r.title === "string" ? r.title : current.title;
      const content = r.content && typeof r.content === "object" ? r.content : current.content;
      // Câmpurile de context nu se pot schimba.
      current = { ...current, title: current.title === null ? null : title, content };
    }
    return current;
  }

  private parseWidget(type: string): { l: Loaded; widget: string } | null {
    for (const l of this.loaded.values()) {
      const prefix = `${pluginRegistryKey(l.row.key)}.`;
      if (type.startsWith(prefix)) {
        const widget = type.slice(prefix.length);
        return l.row.manifest.widgets.some((w) => w.key === widget) ? { l, widget } : null;
      }
    }
    return null;
  }

  /** Titlul unui widget al pluginului, în limba cerută. */
  widgetTitle(type: string, locale: string): string | null {
    const found = this.parseWidget(type);
    if (!found) return null;
    const w = found.l.row.manifest.widgets.find((x) => x.key === found.widget)!;
    return found.l.texts.text(w.label, locale);
  }

  /** Randează un widget de plugin; `null` dacă pluginul nu e încărcat, hook-ul e oprit sau apelul eșuează. */
  async renderWidget(type: string, input: { config: Record<string, unknown>; actor: GcsActor; locale: string; page: string; zone: string }): Promise<GcsPluginRenderedHtml | null> {
    const found = this.parseWidget(type);
    if (!found || !this.hookEnabled(found.l.row.key, `widget:${found.widget}`)) return null;
    try {
      const value = await this.invoke(found.l, "widget", found.widget, { config: input.config, page: input.page, zone: input.zone }, { actor: input.actor, locale: input.locale });
      return { html: await this.html(found.l, value), styles: this.styleUrls(found.l), scripts: this.scriptUrls(found.l) };
    } catch {
      return null;
    }
  }

  /** O pagină a pluginului pe site (`/p/<cheie>/…`) sau în ACP (`/admin/plugins/<cheie>/…`). */
  async renderPage(key: string, rawPath: string, input: { actor: GcsActor; locale: string; query: Record<string, string>; area: "site" | "acp" }): Promise<GcsPluginPageResult> {
    const l = this.loaded.get(key);
    if (!l) return { status: 404 };
    const routes = input.area === "site" ? l.row.manifest.routes.pages : l.row.manifest.routes.acp;
    const match = matchPluginRoute(routes.map((r) => r.path), rawPath);
    if (!match) return { status: 404 };
    const kind: CallKind = input.area === "site" ? "page" : "acp";
    if (!this.hookEnabled(key, `${kind}:${match.pattern}`)) return { status: 404 };
    const route = routes.find((r) => r.path === match.pattern)!;
    const permission = "permission" in route ? route.permission : undefined;
    if (permission && !(await this.deps.permissions.can(input.actor, `${pluginRegistryKey(key)}.${permission}`))) return { status: 403 };
    let value: unknown;
    try {
      value = await this.invoke(l, kind, match.pattern, { path: rawPath, params: match.params, query: input.query }, { actor: input.actor, locale: input.locale, acp: kind === "acp" });
    } catch {
      return { status: 500 };
    }
    const r = (value && typeof value === "object" ? value : {}) as { title?: unknown; html?: unknown; status?: unknown; redirect?: unknown };
    if (typeof r.redirect === "string") {
      const prefix = input.area === "site" ? `/p/${key}` : `/admin/plugins/${key}`;
      if (isPluginRedirect(r.redirect, prefix)) return { status: 302, redirect: r.redirect };
    }
    if (r.status === 403 || r.status === 404) return { status: r.status };
    const fallbackTitle = "title" in route && typeof route.title === "string" ? l.texts.text(route.title, input.locale) : "label" in route ? l.texts.text(route.label, input.locale) : l.row.name;
    const title = typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 200) : fallbackTitle;
    const scripts = input.area === "site" ? this.scriptUrls(l) : [];
    const icon = pluginIcon("icon" in route && typeof route.icon === "string" ? route.icon : l.row.manifest.icon);
    return { status: 200, title, icon, html: await this.html(l, r.html ?? "", { page: true }), styles: this.styleUrls(l), scripts };
  }

  /**
   * Ruta API potrivită (înaintea citirii corpului): dreptul ACP cerut (`acp`), declarația `media` (formularele
   * `multipart`) sau eroarea (404 / 405).
   */
  apiRoute(key: string, method: string, path: string): { status: 404 | 405 } | { status: 200; acp: "view" | "edit" | "delete" | null; media: GcsPluginManifest["media"] | null } {
    const l = this.loaded.get(key);
    if (!l) return { status: 404 };
    const match = matchPluginRoute(l.row.manifest.routes.api.map((r) => r.path), path);
    if (!match || !this.hookEnabled(key, `api:${match.pattern}`)) return { status: 404 };
    const route = l.row.manifest.routes.api.find((r) => r.path === match.pattern)!;
    if (!(route.methods as string[]).includes(method)) return { status: 405 };
    return { status: 200, acp: route.acp ?? null, media: l.row.capabilities.includes("media") ? (l.row.manifest.media ?? null) : null };
  }

  /**
   * Un fișier din formularul unei rute API, verificat și salvat de nucleu (capabilitatea `media`), în așteptare.
   * `opts.acp`: ruta e una ACP, verificată de ruta web (limita de rată a încărcărilor din ACP).
   */
  async uploadMedia(key: string, file: { bytes: Buffer; name?: string }, actor: GcsActor, opts: { acp?: boolean } = {}): Promise<GcsPluginMediaInfo> {
    const l = this.loaded.get(key);
    const decl = l && l.row.capabilities.includes("media") ? l.row.manifest.media : undefined;
    if (!decl) throw new GcsValidationError({ file: "unsupported_type" });
    return this.deps.media.upload(key, decl, file, { userId: actor.userId, acp: opts.acp === true });
  }

  /** Un fișier media al pluginului, pentru servire (`/plugins/<cheie>/media/<id>.<ext>`). */
  async mediaFile(key: string, file: string, range?: Parameters<GcsPluginMediaService["open"]>[2]) {
    if (!this.loaded.has(key)) return null;
    return this.deps.media.open(key, file, range);
  }

  /**
   * O rută API a pluginului. Corpul vine ca JSON sau din formular (câmpurile ca text, fișierele deja verificate de
   * nucleu); statusul și corpul vin de la plugin (validate). `{ redirect }` e o adresă a pluginului (site sau ACP), pe
   * care ruta o folosește pentru formulare (303); orice altă adresă se ignoră.
   */
  async handleApi(
    key: string,
    input: { method: string; path: string; query: Record<string, string>; body: unknown; actor: GcsActor; locale: string; form?: boolean; acp?: boolean },
  ): Promise<{ status: number; body: unknown; redirect?: string }> {
    const l = this.loaded.get(key);
    if (!l) return { status: 404, body: { error: "not_found" } };
    const match = matchPluginRoute(l.row.manifest.routes.api.map((r) => r.path), input.path);
    if (!match || !this.hookEnabled(key, `api:${match.pattern}`)) return { status: 404, body: { error: "not_found" } };
    const route = l.row.manifest.routes.api.find((r) => r.path === match.pattern)!;
    if (!(route.methods as string[]).includes(input.method)) return { status: 405, body: { error: "method_not_allowed" } };
    // Rutele ACP cer poarta ACP, verificată de ruta web înainte (`acp: true`); fără ea, nu rulează.
    if (route.acp && input.acp !== true) return { status: 403, body: { error: "forbidden" } };
    if (route.permission && !(await this.deps.permissions.can(input.actor, `${pluginRegistryKey(key)}.${route.permission}`))) return { status: 403, body: { error: "forbidden" } };
    let value: unknown;
    try {
      value = await this.invoke(
        l,
        "api",
        match.pattern,
        { method: input.method, path: input.path, params: match.params, query: input.query, body: input.body ?? null, form: input.form === true, acp: Boolean(route.acp) },
        { actor: input.actor, locale: input.locale, acp: Boolean(route.acp) && input.acp === true },
      );
    } catch {
      return { status: 500, body: { error: "plugin_error" } };
    }
    const r = (value && typeof value === "object" ? value : {}) as { status?: unknown; body?: unknown; redirect?: unknown };
    const status = Number.isInteger(r.status) && (r.status as number) >= 200 && (r.status as number) <= 599 ? (r.status as number) : 200;
    const redirect =
      typeof r.redirect === "string" && (isPluginRedirect(r.redirect, `/p/${key}`) || isPluginRedirect(r.redirect, `/admin/plugins/${key}`)) ? r.redirect : undefined;
    return { status, body: r.body ?? null, ...(redirect ? { redirect } : {}) };
  }

  /** Punctele de extensie (ex. `postbit.after_fields`): HTML-ul pluginurilor, în ordinea priorității. */
  async renderHook(point: string, data: Record<string, unknown>, input: { actor: GcsActor; locale: string }): Promise<{ key: string; html: string }[]> {
    const targets = [...this.loaded.values()]
      .filter((l) => l.row.manifest.hooks.some((h) => h.point === point) && this.hookEnabled(l.row.key, point))
      .sort((a, b) => this.priority(a.row.key, point, a.row.manifest.hooks.find((h) => h.point === point)?.priority) - this.priority(b.row.key, point, b.row.manifest.hooks.find((h) => h.point === point)?.priority));
    const out = await Promise.all(
      targets.map(async (l) => {
        try {
          return { key: l.row.key, html: await this.html(l, await this.invoke(l, "hook", point, data, { actor: input.actor, locale: input.locale })) };
        } catch {
          return { key: l.row.key, html: "" };
        }
      }),
    );
    return out.filter((h) => h.html !== "");
  }

  /** Are vreun plugin încărcat acest punct de extensie? (paginile nu fac apeluri inutile) */
  hasHook(point: string): boolean {
    return [...this.loaded.values()].some((l) => l.row.manifest.hooks.some((h) => h.point === point) && this.hookEnabled(l.row.key, point));
  }

  /**
   * Panourile de membru ale pluginurilor încărcate pentru o suprafață (Membri v2: fișa ACP, profilul), cu eticheta în
   * limba cerută. Fără punctul `member.panel` pornit, pluginul nu are panouri.
   */
  memberPanels(surface: "acp" | "profile", locale: string): { plugin: string; key: string; label: string; icon: string; kind: "card" | "tab"; position: number }[] {
    return [...this.loaded.values()]
      .filter((l) => this.hookEnabled(l.row.key, "member.panel") && l.row.manifest.hooks.some((h) => h.point === "member.panel"))
      .flatMap((l) =>
        l.row.manifest.memberPanels
          .filter((p) => (p.surfaces as string[]).includes(surface))
          .map((p) => ({ plugin: l.row.key, key: p.key, label: l.texts.text(p.label, locale), icon: pluginIcon(p.icon), kind: p.kind, position: p.position })),
      )
      .sort((a, b) => a.position - b.position || a.plugin.localeCompare(b.plugin));
  }

  /** HTML-ul unui panou de membru al unui plugin (sanitizat); gol la eroare sau timeout. */
  async renderMemberPanel(plugin: string, panel: string, data: { userId: string; surface: "acp" | "profile" }, input: { actor: GcsActor; locale: string }): Promise<string> {
    const l = this.loaded.get(plugin);
    if (!l || !l.row.manifest.memberPanels.some((p) => p.key === panel) || !this.hookEnabled(plugin, "member.panel")) return "";
    try {
      return await this.html(l, await this.invoke(l, "hook", "member.panel", { panel, userId: data.userId, surface: data.surface }, { actor: input.actor, locale: input.locale }));
    } catch {
      return "";
    }
  }

  // ─── Forum v2: sloturile forumului ───

  /** Pluginul e încărcat, declară punctul și punctul e pornit (pagina Hook-uri). */
  private forumPoint(key: string, point: string): Loaded | null {
    const l = this.loaded.get(key);
    return l && l.row.manifest.hooks.some((h) => h.point === point) && this.hookEnabled(key, point) ? l : null;
  }

  /** Un rezultat HTML al pluginului ca element de slot (sanitizat, în containerul lui), sau `null` dacă e gol. */
  private async slotHtml(l: Loaded, value: unknown, page = false): Promise<GcsSlotItem | null> {
    if (value === null || value === undefined) return null;
    const html = await this.html(l, value, { page });
    return html ? { kind: "html", html, plugin: l.row.key } : null;
  }

  /**
   * Puntea extensiei de forum a unui plugin (`pluginForumExtension`): apelurile `forum.list`, `forum.page` și `topic.bar`
   * spre firul lui, cu vizitatorul cererii. Un eșec sau un timeout lasă slotul gol (pagina nu se strică).
   */
  private forumBridge(key: string): GcsPluginForumBridge {
    return {
      list: async (ctx, nodes) => {
        const l = this.forumPoint(key, "forum.list");
        if (!l || nodes.length === 0) return {};
        let value: unknown;
        try {
          value = await this.invoke(
            l,
            "hook",
            "forum.list",
            {
              surface: ctx.surface,
              nodes: nodes.map((n) => ({
                id: n.id,
                type: n.type,
                parentId: n.parentId,
                name: n.name,
                slug: n.slug,
                data: n.data,
                parent: n.parent ?? null,
                children: (n.children ?? []).map((c) => ({ id: c.id, type: c.type, name: c.name, slug: c.slug, data: c.data })),
              })),
            },
            { actor: ctx.actor, locale: ctx.locale },
          );
        } catch {
          return {};
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) return {};
        const ids = new Set(nodes.map((n) => n.id));
        const out: Record<number, GcsForumListSlots> = {};
        for (const [rawId, raw] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
          const id = Number(rawId);
          if (!ids.has(id) || !raw || typeof raw !== "object") continue;
          const r = raw as Record<string, unknown>;
          const slots: GcsForumListSlots = {};
          for (const part of ["title", "meta", "header"] as const) {
            const item = await this.slotHtml(l, r[part]);
            if (item) slots[part] = [item];
          }
          // Insignele subforumurilor din lista rândului (doar copiii nodului).
          const node = nodes.find((n) => n.id === id);
          if (r.subs && typeof r.subs === "object" && !Array.isArray(r.subs) && node?.children?.length) {
            const childIds = new Set(node.children.map((c) => c.id));
            const subs: Record<number, GcsSlotItem[]> = {};
            for (const [rawChild, html] of Object.entries(r.subs as Record<string, unknown>).slice(0, 60)) {
              const childId = Number(rawChild);
              if (!childIds.has(childId)) continue;
              const item = await this.slotHtml(l, html);
              if (item) subs[childId] = [item];
            }
            if (Object.keys(subs).length > 0) slots.subs = subs;
          }
          // Stilul se verifică de serviciul sloturilor (`sanitizeSlotStyle`, cu containerul pluginului).
          if (r.style && typeof r.style === "object") slots.style = r.style as GcsSlotStyle;
          out[id] = slots;
        }
        return out;
      },
      forumPage: async (ctx, node) => {
        const l = this.forumPoint(key, "forum.page");
        if (!l) return null;
        try {
          const item = await this.slotHtml(l, await this.invoke(l, "hook", "forum.page", { forumId: node.id, data: node.data }, { actor: ctx.actor, locale: ctx.locale }));
          return item ? [item] : null;
        } catch {
          return null;
        }
      },
      topicBar: async (ctx, { node, topic }) => {
        const l = this.forumPoint(key, "topic.bar");
        if (!l) return null;
        try {
          const item = await this.slotHtml(l, await this.invoke(l, "hook", "topic.bar", { topicId: topic.id, forumId: node.id, data: node.data }, { actor: ctx.actor, locale: ctx.locale }));
          return item ? [item] : null;
        } catch {
          return null;
        }
      },
    };
  }

  /**
   * Corpul unui tab al pluginului în formularul ACP al forumului (`forumTabs[].hook`, punctul `forum.edit`): HTML cu
   * formulare spre rutele pluginului (ca o pagină ACP a lui). Gol la eroare, timeout sau punct oprit.
   */
  async renderForumEditTab(plugin: string, tab: string, input: { forumId: number; data: Record<string, unknown>; actor: GcsActor; locale: string }): Promise<GcsPluginRenderedHtml | null> {
    const l = this.forumPoint(plugin, "forum.edit");
    if (!l || !l.row.manifest.forumTabs.some((t) => t.key === tab && t.hook)) return null;
    try {
      const value = await this.invoke(l, "hook", "forum.edit", { tab, forumId: input.forumId, data: input.data as Record<string, unknown> }, { actor: input.actor, locale: input.locale, acp: true });
      const html = await this.html(l, value, { page: true });
      return html ? { html, styles: this.styleUrls(l), scripts: [] } : null;
    } catch {
      return null;
    }
  }

  /** Foile de stil ale unui plugin încărcat (sloturile forumului le adaugă în pagina unde apare HTML-ul lui). */
  pluginStyles(key: string): string[] {
    const l = this.loaded.get(key);
    return l ? this.styleUrls(l) : [];
  }

  /** Intrările pluginurilor în meniul site-ului sau al userului, vizibile pentru actor. */
  async menus(area: "site" | "user", actor: GcsActor, locale: string): Promise<GcsPluginMenuEntry[]> {
    const out: GcsPluginMenuEntry[] = [];
    for (const l of this.loaded.values()) {
      for (const e of l.row.manifest.menus[area]) {
        if (!this.hookEnabled(l.row.key, `menu.${area}:${e.key}`)) continue;
        if (e.permission && !(await this.deps.permissions.can(actor, `${pluginRegistryKey(l.row.key)}.${e.permission}`))) continue;
        out.push({ key: `${l.row.key}.${e.key}`, label: l.texts.text(e.label, locale), href: e.href, icon: pluginIcon(e.icon ?? l.row.manifest.icon) });
      }
    }
    return out;
  }

  /** Jobul generic `plugin.job` (în `gcs-worker`): rulează jobul pluginului, dacă e încărcat și jobul e pornit. */
  async runJob(data: Record<string, unknown>): Promise<void> {
    const key = typeof data.plugin === "string" ? data.plugin : "";
    const job = typeof data.job === "string" ? data.job : "";
    const l = this.loaded.get(key);
    if (!l || !l.row.manifest.jobs.some((j) => j.key === job) || !this.hookEnabled(key, `job:${job}`)) return;
    const payload = data.data && typeof data.data === "object" ? data.data : {};
    await this.invoke(l, "job", job, payload, { actor: null, locale: await this.deps.siteLocale().catch(() => "ro"), timeoutMs: PLUGIN_TIMEOUTS.job }).catch(() => {});
  }

  /** Un fișier client al pluginului (`/plugins/<cheie>/assets/…`): CSS-ul închis în container, JS doar semnat. */
  async asset(key: string, rawPath: string): Promise<{ body: Buffer | string; contentType: string } | null> {
    const l = this.loaded.get(key);
    if (!l || !isSafeArchivePath(rawPath) || !rawPath.startsWith("assets/")) return null;
    const rawExt = rawPath.slice(rawPath.lastIndexOf(".") + 1);
    const ext = rawExt.toLowerCase();
    // Pachetele au doar extensii cu litere mici: altă formă (`.JS`) ar ajunge, pe un sistem de fișiere care nu ține cont
    // de litere, la alt fișier decât cel verificat (ex. JS-ul unui plugin nesemnat servit ca script).
    if (rawExt !== ext) return null;
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) return null;
    if (ext === "css") {
      const css = l.css.get(rawPath);
      return css === undefined ? null : { body: css, contentType };
    }
    if (ext === "js") {
      if (!l.row.signed || !l.row.capabilities.includes("client-js") || !l.row.manifest.client.scripts.includes(rawPath)) return null;
    }
    try {
      return { body: await readFile(path.join(l.dir, ...rawPath.split("/"))), contentType };
    } catch {
      return null;
    }
  }

  /** Textele pluginurilor încărcate, pentru mesajele next-intl (`pluginText.<vendor>.<nume>.*`). */
  messages(locale: string): Record<string, unknown> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const l of this.loaded.values()) {
      const [vendor, name] = l.row.key.split(".") as [string, string];
      (out[vendor] ??= {})[name] = l.texts.messages(locale);
    }
    return out;
  }

  /** Starea în acest proces (pagina pluginului din ACP). */
  status(key: string): { loaded: boolean; running: boolean; startError: string | null } {
    const l = this.loaded.get(key);
    return { loaded: Boolean(l), running: Boolean(l?.sandbox.running), startError: l?.sandbox.lastStartError ?? null };
  }

  loadedKeys(): string[] {
    return [...this.loaded.keys()];
  }

  // ─── Metricile (comune proceselor, în Redis) ───

  private async flushMetrics(): Promise<void> {
    if (this.metrics.size === 0) return;
    const snapshot = [...this.metrics];
    this.metrics.clear();
    for (const [key, byHook] of snapshot) {
      const redisKey = `gcs:plugin:metrics:${key}`;
      const { kv } = this.deps;
      try {
        for (const [hook, m] of byHook) {
          await kv.hincrby(redisKey, `${hook}|count`, m.count);
          await kv.hincrby(redisKey, `${hook}|fail`, m.failures);
          await kv.hincrby(redisKey, `${hook}|ms`, Math.round(m.totalMs));
          await kv.hsetMax(redisKey, `${hook}|max`, Math.round(m.maxMs));
        }
        await kv.expire(redisKey, 30 * 86_400_000);
      } catch {
        // Metricile sunt doar informative: o eroare a stocării nu oprește pluginurile.
      }
    }
  }

  /** Metricile pe hook ale unui plugin, din toate procesele (inclusiv cele încă neîmpinse de acest proces). */
  async hookMetrics(key: string): Promise<GcsPluginHookMetrics> {
    await this.flushMetrics();
    const raw = await this.deps.kv.hgetall(`gcs:plugin:metrics:${key}`).catch(() => ({}) as Record<string, string>);
    const out: GcsPluginHookMetrics = {};
    for (const [field, value] of Object.entries(raw)) {
      const at = field.lastIndexOf("|");
      const hook = field.slice(0, at);
      const m = (out[hook] ??= { count: 0, failures: 0, totalMs: 0, maxMs: 0 });
      const n = Number(value);
      const kind = field.slice(at + 1);
      if (kind === "count") m.count = n;
      else if (kind === "fail") m.failures = n;
      else if (kind === "ms") m.totalMs = n;
      else if (kind === "max") m.maxMs = n;
    }
    return out;
  }
}
