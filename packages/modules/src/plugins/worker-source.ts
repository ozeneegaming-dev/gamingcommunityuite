/**
 * Codul firului (`worker_threads`, `eval: true`) în care rulează un plugin. E un șir, nu un modul: bundler-ele
 * (Next.js, tsx) nu îl ating, iar firul nu primește nimic din codul aplicației.
 *
 * Ce face, în ordine, înainte de a importa `server.mjs`:
 * 1. hook-uri de module (`module.registerHooks`, per fir): se pot încărca doar fișierele `.mjs`/`.json` ale pluginului,
 *    în format ESM/JSON; modulele Node (`fs`, `net`, `child_process`, `worker_threads`, `module`…), `data:` și fișierele
 *    aplicației sunt refuzate, inclusiv prin `require`;
 * 2. `process` devine un obiect minim (fără `binding`, `dlopen`, `getBuiltinModule`, `kill`, `env`), `require`, `fetch`,
 *    `WebSocket`, `EventSource`, `BroadcastChannel` dispar, `console` ajunge în jurnalul pluginului;
 * 3. mesajele cu gazda: apelurile handler-elor (`call`) și apelurile contextului (`rpc`), validate de gazdă.
 *
 * Fără template literals în cod (șirul e `String.raw`).
 */
export const PLUGIN_WORKER_SOURCE = String.raw`
"use strict";
(function () {
  const { parentPort, workerData } = require("node:worker_threads");
  const nodeModule = require("node:module");
  const realProcess = process;
  const ROOT = workerData.rootUrl;
  const ENTRY = workerData.entryUrl;
  const KEY = workerData.key;
  const VERSION = workerData.version;
  const MAX_RESULT = workerData.maxResult;
  const post = (msg) => parentPort.postMessage(msg);
  // Ceasul, luat înainte ca pluginul să poată înlocui Date.now (termenul trimis de gazdă cu fiecare apel).
  const now = Date.now;

  if (typeof nodeModule.registerHooks !== "function") {
    post({ t: "init-error", error: "node_unsupported: module.registerHooks is required (Node.js >= 22.15)" });
    return;
  }

  // 1. Doar fișierele pluginului, doar ESM și JSON.
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      const url = result && typeof result.url === "string" ? result.url : "";
      if (!url.startsWith(ROOT) || !/\.(?:mjs|json)$/.test(url)) throw new Error("gcs-plugin: import blocked: " + String(specifier).slice(0, 120));
      return result;
    },
    load(url, context, nextLoad) {
      if (typeof url !== "string" || !url.startsWith(ROOT)) throw new Error("gcs-plugin: load blocked");
      const result = nextLoad(url, context);
      if (result.format !== "module" && result.format !== "json") throw new Error("gcs-plugin: format blocked: " + String(result.format));
      return result;
    },
  });

  // Jurnalul: limitat la 60 de mesaje pe minut în fir (gazda are propria limită).
  let logWindow = 0;
  let logCount = 0;
  function sendLog(level, message) {
    const now = Date.now();
    if (now - logWindow > 60000) {
      logWindow = now;
      logCount = 0;
    }
    if (++logCount > 60) return;
    post({ t: "log", level: level, message: String(message).slice(0, 1000) });
  }
  realProcess.on("unhandledRejection", (reason) => sendLog("error", "unhandled rejection: " + (reason && reason.stack ? reason.stack : String(reason))));
  realProcess.on("uncaughtException", (error) => sendLog("error", "uncaught exception: " + (error && error.stack ? error.stack : String(error))));

  // 2. Mediul restrâns.
  const hrtime = (t) => realProcess.hrtime(t);
  hrtime.bigint = () => realProcess.hrtime.bigint();
  const stubProcess = Object.freeze({
    env: Object.freeze({}),
    argv: Object.freeze([]),
    platform: realProcess.platform,
    version: realProcess.version,
    versions: Object.freeze({ node: realProcess.versions.node }),
    nextTick: (fn, ...args) => realProcess.nextTick(fn, ...args),
    hrtime: hrtime,
    cwd: () => "/",
    emitWarning: () => {},
  });
  const consoleStub = {};
  for (const level of ["log", "info", "debug", "trace", "warn", "error"]) {
    consoleStub[level] = (...args) => sendLog(level === "error" ? "error" : level === "warn" ? "warn" : "info", args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "));
  }
  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }
  const hide = (name, value) => {
    try {
      delete globalThis[name];
    } catch (e) {}
    try {
      Object.defineProperty(globalThis, name, { value: value, writable: false, configurable: false, enumerable: false });
    } catch (e) {}
  };
  hide("process", stubProcess);
  hide("console", Object.freeze(consoleStub));
  for (const name of ["require", "module", "exports", "__filename", "__dirname", "fetch", "WebSocket", "EventSource", "BroadcastChannel", "XMLHttpRequest", "Worker", "localStorage", "sessionStorage"]) {
    hide(name, undefined);
  }
  hide("definePlugin", (definition) => definition);

  // 3. Mesajele cu gazda.
  let seq = 0;
  const pending = new Map();
  let settings = workerData.settings || {};
  const langs = workerData.langs || {};
  let definition = null;

  function rpc(method, args, token) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      post({ t: "rpc", id: id, method: method, args: args, token: token });
    });
  }

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function lookup(lang, key) {
    let node = langs[lang];
    for (const part of String(key).split(".")) {
      if (!node || typeof node !== "object") return undefined;
      node = node[part];
    }
    return typeof node === "string" ? node : undefined;
  }
  function translate(locale, key, params) {
    const text = lookup(locale, key) ?? lookup("en", key) ?? lookup("ro", key);
    if (text === undefined) return String(key);
    return text.replace(/\{([A-Za-z0-9_]{1,40})\}/g, (m, name) => (params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m));
  }

  function makeContext(call) {
    const token = call.token || null;
    const locale = typeof call.locale === "string" ? call.locale : "en";
    const viewer = call.viewer && typeof call.viewer.userId === "string" ? call.viewer.userId : null;
    const log = (level) => (message, data) => sendLog(level, data === undefined ? message : String(message) + " " + safeJson(data));
    return Object.freeze({
      plugin: Object.freeze({ key: KEY, version: VERSION }),
      viewer: Object.freeze({ userId: viewer, isGuest: viewer === null }),
      locale: locale,
      t: (key, params) => translate(locale, key, params),
      escape: escape,
      settings: Object.freeze({ get: (key) => clone(settings[key]), all: () => clone(settings) }),
      permissions: Object.freeze({ can: (permission) => rpc("permissions.can", [String(permission)], token) }),
      db: Object.freeze({
        query: (sql, params) => rpc("db.query", [sql, params || []], token).then((r) => r.rows),
        execute: (sql, params) => rpc("db.query", [sql, params || []], token).then((r) => r.rowCount),
        batch: (statements) => rpc("db.batch", [statements], token),
      }),
      api: Object.freeze({
        users: Object.freeze({ get: (ids) => rpc("api.users.get", [ids], token) }),
        topics: Object.freeze({ get: (id) => rpc("api.topics.get", [id], token), recent: (limit) => rpc("api.topics.recent", [limit === undefined ? 10 : limit], token) }),
        posts: Object.freeze({ get: (id) => rpc("api.posts.get", [id], token), recent: (limit) => rpc("api.posts.recent", [limit === undefined ? 10 : limit], token) }),
        forums: Object.freeze({ list: () => rpc("api.forums.list", [], token) }),
        stats: () => rpc("api.stats", [], token),
        vip: Object.freeze({
          plans: () => rpc("api.vip.plans", [], token),
          status: (ids) => rpc("api.vip.status", [ids], token),
          members: (opts) => rpc("api.vip.members", [opts || {}], token),
        }),
      }),
      members: Object.freeze({
        appearance: Object.freeze({
          set: (userId, data) => rpc("members.appearance.set", [userId, data === undefined ? null : data], token),
          get: (ids) => rpc("members.appearance.get", [ids], token),
          clear: () => rpc("members.appearance.clear", [], token),
        }),
      }),
      media: Object.freeze({
        keep: (ids) => rpc("media.keep", [ids], token),
        get: (ids) => rpc("media.get", [ids], token),
        list: (opts) => rpc("media.list", [opts || {}], token),
        delete: (ids) => rpc("media.delete", [ids], token),
        usage: () => rpc("media.usage", [], token),
      }),
      cache: Object.freeze({
        get: (key) => rpc("cache.get", [key], token),
        set: (key, value, ttl) => rpc("cache.set", [key, value === undefined ? null : value, ttl === undefined ? 300 : ttl], token),
        delete: (key) => rpc("cache.delete", [key], token),
      }),
      log: Object.freeze({ info: log("info"), warn: log("warn"), error: log("error") }),
      jobs: Object.freeze({ enqueue: (job, data) => rpc("jobs.enqueue", [job, data || {}], token) }),
      http: Object.freeze({ fetch: (url, init) => rpc("http.fetch", [url, init || {}], token) }),
    });
  }

  const TABLES = { widget: "widgets", page: "pages", acp: "acp", api: "api", event: "events", filter: "filters", hook: "hooks", job: "jobs" };

  function reply(id, ok, value, error) {
    if (!ok) {
      post({ t: "result", id: id, ok: false, error: String(error && error.message ? error.message : error).slice(0, 500) });
      return;
    }
    let json;
    try {
      json = JSON.stringify(value === undefined ? null : value);
    } catch (e) {
      post({ t: "result", id: id, ok: false, error: "result_not_json" });
      return;
    }
    if (json.length > MAX_RESULT) {
      post({ t: "result", id: id, ok: false, error: "result_too_large" });
      return;
    }
    post({ t: "result", id: id, ok: true, json: json });
  }

  parentPort.on("message", (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "rpc-result") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else {
        const error = new Error(String(msg.error || "rpc_failed"));
        error.code = msg.code;
        p.reject(error);
      }
      return;
    }
    if (msg.t === "ping") {
      post({ t: "pong", id: msg.id });
      return;
    }
    if (msg.t === "settings") {
      settings = msg.settings || {};
      return;
    }
    if (msg.t === "init") {
      import(ENTRY).then(
        (mod) => {
          const def = mod && mod.default;
          if (!def || typeof def !== "object") throw new Error("server.mjs must export default definePlugin({...})");
          const missing = (msg.required || []).filter((r) => {
            const table = def[TABLES[r.kind]];
            return !table || typeof table[r.name] !== "function";
          });
          if (missing.length > 0) throw new Error("missing handlers: " + missing.map((r) => r.kind + ":" + r.name).join(", "));
          definition = def;
          post({ t: "ready" });
        },
      ).catch((error) => post({ t: "init-error", error: String(error && error.stack ? error.stack : error).slice(0, 1000) }));
      return;
    }
    if (msg.t === "call") {
      // Gazda l-a respins deja ca ocupat: nu mai rulează.
      if (typeof msg.deadline === "number" && now() >= msg.deadline) {
        reply(msg.id, false, null, "expired");
        return;
      }
      const table = definition ? definition[TABLES[msg.kind]] : null;
      const fn = table && Object.prototype.hasOwnProperty.call(table, msg.name) ? table[msg.name] : null;
      if (typeof fn !== "function") {
        reply(msg.id, false, null, "handler_missing");
        return;
      }
      let ctx;
      try {
        ctx = makeContext(msg);
      } catch (error) {
        reply(msg.id, false, null, error);
        return;
      }
      // Gazda pornește timeout-ul de acum (timpul petrecut în coada firului nu e al acestui handler).
      post({ t: "started", id: msg.id });
      Promise.resolve()
        .then(() => fn.call(table, msg.input, ctx))
        .then((value) => reply(msg.id, true, value), (error) => reply(msg.id, false, null, error));
    }
  });
  post({ t: "booted" });
})();
`;
