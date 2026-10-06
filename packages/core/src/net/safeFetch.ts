import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

/** O adresă refuzată de garda anti-SSRF sau o descărcare oprită (mărime, timp, redirecturi). `reason` e un cod stabil. */
export class GcsBlockedFetch extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "GcsBlockedFetch";
  }
}

// Rețelele care nu sunt internet public: loopback, private, link-local, CGNAT, documentație, multicast, rezervate.
const BLOCKED_V4: [string, number][] = [
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
];
// IPv6: nespecificat/loopback/compatibil IPv4, IPv4 mapat și NAT64 (ar ascunde o adresă IPv4 privată), discard,
// Teredo, documentație, 6to4, ULA, link-local, site-local, multicast.
const BLOCKED_V6: [string, number][] = [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

// Liste separate: o listă comună ar compara și adresele IPv4 cu regulile IPv6 (ca IPv4 mapat).
const blockedV4 = new BlockList();
for (const [net, prefix] of BLOCKED_V4) blockedV4.addSubnet(net, prefix, "ipv4");
const blockedV6 = new BlockList();
for (const [net, prefix] of BLOCKED_V6) blockedV6.addSubnet(net, prefix, "ipv6");

/** Adresa e una de internet public (nu loopback, privată, link-local etc.). Un text care nu e IP → `false`. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blockedV4.check(ip, "ipv4");
  if (family === 6) return !blockedV6.check(ip, "ipv6");
  return false;
}

export type GcsSafeFetchOptions = {
  maxBytes: number;
  /** Implicit 3. Fiecare redirect se verifică din nou. */
  maxRedirects?: number;
  /** Timpul total, cu tot cu redirecturile (implicit 30 s). */
  timeoutMs?: number;
  /** Porturile permise (implicit 80, 443, 8080, 8443). */
  ports?: number[];
};

/** Doar pentru teste: rezolvarea DNS și regula adreselor permise se pot înlocui. */
export type GcsSafeFetchDeps = {
  lookup?: typeof dnsLookup;
  isAllowedAddress?: (ip: string) => boolean;
};

export type GcsFetchedFile = { bytes: Buffer; contentType: string | null; finalUrl: string };

const DEFAULT_PORTS = [80, 443, 8080, 8443];

/** Verifică forma unui URL de descărcat: `http`/`https`, fără user și parolă, pe un port permis. */
export function checkFetchUrl(raw: string, ports: number[] = DEFAULT_PORTS): URL {
  if (!URL.canParse(raw)) throw new GcsBlockedFetch("invalid_url");
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new GcsBlockedFetch("protocol");
  if (url.username || url.password) throw new GcsBlockedFetch("credentials");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ports.includes(port)) throw new GcsBlockedFetch("port");
  return url;
}

type Lookup = NonNullable<http.RequestOptions["lookup"]>;

/**
 * `lookup`-ul conexiunii: fiecare adresă rezolvată trebuie să fie permisă. Verificarea se face la conectare, pe
 * adresa folosită efectiv, deci un DNS care se schimbă între verificare și conectare (rebinding) nu ocolește garda.
 */
function guardedLookup(deps: Required<GcsSafeFetchDeps>): Lookup {
  return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    deps.lookup(hostname, { all: true }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error);
      if (addresses.length === 0 || addresses.some((a) => !deps.isAllowedAddress(a.address))) {
        return callback(new GcsBlockedFetch("blocked_address"));
      }
      if (options?.all) return callback(null, addresses);
      return callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  }) as unknown as Lookup;
}

function request(url: URL, lookup: Lookup, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(url, { lookup, agent: false, signal, headers: { "user-agent": "GamingCommunitySuite-Importer", accept: "*/*" } }, resolve);
    req.on("error", reject);
  });
}

async function readBody(res: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.destroy();
    throw new GcsBlockedFetch("too_large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      res.destroy();
      throw new GcsBlockedFetch("too_large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Descarcă un fișier de la o adresă dată de admin (ex. fișierele platformei vechi), fără să poată fi folosit pentru a
 * ajunge în rețeaua internă (SSRF): IP-urile private sunt refuzate la conectare, redirecturile se re-verifică, iar
 * mărimea și timpul sunt limitate.
 */
export async function safeFetchBuffer(raw: string, opts: GcsSafeFetchOptions, deps: GcsSafeFetchDeps = {}): Promise<GcsFetchedFile> {
  const full: Required<GcsSafeFetchDeps> = { lookup: deps.lookup ?? dnsLookup, isAllowedAddress: deps.isAllowedAddress ?? isPublicAddress };
  const lookup = guardedLookup(full);
  const maxRedirects = opts.maxRedirects ?? 3;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    let url = checkFetchUrl(raw, opts.ports);
    for (let hop = 0; ; hop++) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      // O adresă IP scrisă direct nu trece prin `lookup`: se verifică aici.
      if (isIP(host) !== 0 && !full.isAllowedAddress(host)) throw new GcsBlockedFetch("blocked_address");
      let res: IncomingMessage;
      try {
        res = await request(url, lookup, controller.signal);
      } catch (error) {
        if (error instanceof GcsBlockedFetch) throw error;
        if ((error as { cause?: unknown }).cause instanceof GcsBlockedFetch) throw (error as { cause: GcsBlockedFetch }).cause;
        throw new GcsBlockedFetch(controller.signal.aborted ? "timeout" : "network");
      }
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hop >= maxRedirects) throw new GcsBlockedFetch("too_many_redirects");
        url = checkFetchUrl(new URL(res.headers.location, url).toString(), opts.ports);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new GcsBlockedFetch(`http_${status}`);
      }
      try {
        const bytes = await readBody(res, opts.maxBytes);
        return { bytes, contentType: res.headers["content-type"] ?? null, finalUrl: url.toString() };
      } catch (error) {
        if (error instanceof GcsBlockedFetch) throw error;
        throw new GcsBlockedFetch(controller.signal.aborted ? "timeout" : "network");
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
