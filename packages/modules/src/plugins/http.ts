import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/** Rețelele în care un plugin nu poate trimite cereri: locale, private, rezervate (SSRF spre serviciile interne). */
const BLOCKED = new net.BlockList();
for (const [net4, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net4, prefix, "ipv4");
}
for (const [net6, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(net6, prefix, "ipv6");
}

/**
 * Adresa e una în care pluginurile nu au voie. IPv4 mapat în IPv6 (`::ffff:a.b.c.d`) se verifică după regulile IPv4
 * (o regulă IPv6 `::ffff:0:0/96` ar bloca în `BlockList` și toate adresele IPv4).
 */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return BLOCKED.check(mapped[1]!, "ipv4");
    return BLOCKED.check(address, "ipv6");
  }
  return BLOCKED.check(address, "ipv4");
}

/** Rezolvarea DNS verificată la conectare (nu doar înainte), ca un DNS „rebinding” să nu poată ocoli lista. */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = (Array.isArray(addresses) ? addresses : []) as dns.LookupAddress[];
    const allowed = list.find((a) => !isBlockedAddress(a.address));
    if (!allowed || list.some((a) => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error("address_blocked"), { code: "EGCSBLOCKED" }), "", 4);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, [allowed]);
    callback(null, allowed.address, allowed.family);
  });
};

/**
 * Doar pentru testele E2E (`GCS_TEST_ROUTES=1`): adresele exacte `gazdă:port` din `GCS_PLUGIN_HTTP_TEST_HOSTS` (serverul
 * local cu fluxuri de test) trec de lista adreselor blocate. În afara testelor, variabila nu are niciun efect.
 */
function testHostAllowed(url: URL): boolean {
  if (process.env.GCS_TEST_ROUTES !== "1") return false;
  const hosts = (process.env.GCS_PLUGIN_HTTP_TEST_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return hosts.includes(`${url.hostname}:${port}`);
}

export type GcsPluginFetchInput = { method?: string; headers?: Record<string, string>; body?: string };
export type GcsPluginFetchResult = { status: number; headers: Record<string, string>; body: string };

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DROPPED_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-connection", "keep-alive", "te", "trailer"]);

/**
 * `ctx.http.fetch` (capabilitatea `http-out`): doar `http(s)`, fără credențiale în URL, fără adrese private/locale,
 * fără redirecționări urmate automat, corp ≤ 256 KB trimis și ≤ 1 MB primit, timeout 10 s.
 */
export function pluginFetch(rawUrl: unknown, rawInit: unknown, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<GcsPluginFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  if (typeof rawUrl !== "string" || rawUrl.length > 2000 || !URL.canParse(rawUrl)) return Promise.reject(new Error("invalid_url"));
  const url = new URL(rawUrl);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return Promise.reject(new Error("invalid_url"));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const testHost = testHostAllowed(url);
  if (!testHost && net.isIP(host) && isBlockedAddress(host)) return Promise.reject(new Error("address_blocked"));
  if (!testHost && /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) return Promise.reject(new Error("address_blocked"));

  const init = (rawInit && typeof rawInit === "object" ? rawInit : {}) as GcsPluginFetchInput;
  const method = typeof init.method === "string" ? init.method.toUpperCase() : "GET";
  if (!METHODS.has(method)) return Promise.reject(new Error("invalid_method"));
  const body = typeof init.body === "string" ? init.body : undefined;
  if (body !== undefined && Buffer.byteLength(body) > 256 * 1024) return Promise.reject(new Error("body_too_large"));
  const headers: Record<string, string> = { "user-agent": "GamingCommunitySuite-Plugin" };
  for (const [k, v] of Object.entries(init.headers && typeof init.headers === "object" ? init.headers : {})) {
    const name = k.toLowerCase();
    if (typeof v === "string" && /^[a-z0-9-]{1,60}$/.test(name) && !DROPPED_HEADERS.has(name) && v.length <= 4000 && !/[\r\n]/.test(v)) headers[name] = v;
  }

  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, { method, headers, ...(testHost ? {} : { lookup: guardedLookup }), timeout: timeoutMs, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error("response_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") out[k] = v.slice(0, 2000);
        resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks).toString("utf8") });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => reject(new Error((e as { code?: string }).code === "EGCSBLOCKED" ? "address_blocked" : e.message.slice(0, 200))));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
