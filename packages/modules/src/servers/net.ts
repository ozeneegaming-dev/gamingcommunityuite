import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import net, { BlockList, isIP } from "node:net";
import { isPublicAddress } from "@gcs/core";
import { GcsQueryFailure } from "./protocols/reader";

/**
 * Rețeaua interogărilor (specul 2026-10-07-servere §10): ce adrese au voie (garda anti-SSRF a platformei, plus excepția
 * operatorului), rezolvarea DNS verificată și transporturile UDP / TCP cu termen și limite de mărime. Conexiunea merge
 * mereu la adresa IP deja verificată: numele nu se mai rezolvă a doua oară (fără „DNS rebinding”).
 */

/** Rețele refuzate chiar și cu excepția operatorului: link-local (metadatele cloud-urilor), multicast, nespecificate. */
const HARD_BLOCKED = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["169.254.0.0", 16],
  ["224.0.0.0", 4],
  ["255.255.255.255", 32],
] as const) {
  HARD_BLOCKED.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["fe80::", 10],
  ["ff00::", 8],
  ["fd00:ec2::254", 128],
] as const) {
  HARD_BLOCKED.addSubnet(address, prefix, "ipv6");
}

/** IPv4 mapat în IPv6 (`::ffff:a.b.c.d`) se judecă după regulile IPv4. */
function unmapped(ip: string): string {
  return /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip;
}

/**
 * Lista rețelelor permise de operator (`GCS_SERVERS_ALLOW_NETS`): CIDR-uri sau adrese, separate prin virgulă sau spațiu.
 * Intrările invalide se ignoră; fără nicio intrare validă → `null`.
 */
export function parseAllowNets(raw: string | undefined | null): BlockList | null {
  if (!raw) return null;
  const list = new BlockList();
  let count = 0;
  for (const entry of raw.split(/[\s,]+/).filter(Boolean)) {
    const [address, prefixText] = entry.split("/");
    const family = isIP(address ?? "");
    if (!address || family === 0) continue;
    const type = family === 6 ? "ipv6" : "ipv4";
    const max = family === 6 ? 128 : 32;
    const prefix = prefixText === undefined ? max : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) continue;
    list.addSubnet(address, prefix, type);
    count++;
  }
  return count > 0 ? list : null;
}

/** Excepția operatorului din mediul procesului (citită o singură dată). */
let envAllow: BlockList | null | undefined;
export function serversAllowNets(): BlockList | null {
  if (envAllow === undefined) envAllow = parseAllowNets(process.env.GCS_SERVERS_ALLOW_NETS);
  return envAllow;
}

/** Adresa se poate interoga: e de internet public sau în excepția operatorului, dar niciodată link-local sau multicast. */
export function isQueryableAddress(ip: string, allow: BlockList | null = null): boolean {
  const address = unmapped(ip);
  const family = isIP(address);
  if (family === 0) return false;
  const type = family === 6 ? "ipv6" : "ipv4";
  if (HARD_BLOCKED.check(address, type)) return false;
  if (isPublicAddress(address)) return true;
  return allow?.check(address, type) ?? false;
}

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
/** Nume care nu sunt de internet public (rezolvate local sau în rețeaua internă). */
const INTERNAL_NAMES = /(^|\.)(localhost|local|localdomain|internal|intranet|arpa|invalid|test|example)$/;

/**
 * Host-ul scris de admin, normalizat (litere mici, fără paranteze IPv6 și punct final), sau `null` dacă nu e un IP ori un
 * nume de domeniu public: fără schemă, cale, port, spații, nume dintr-o singură etichetă sau terminații interne.
 */
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let host = raw.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host || host.length > 253) return null;
  if (isIP(host)) return host;
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!HOSTNAME.test(host) || INTERNAL_NAMES.test(host)) return null;
  // Un TLD numeric înseamnă de fapt o adresă scrisă greșit (ex. `10.0.1`).
  if (/\.\d+$/.test(host)) return null;
  return host;
}

export type GcsResolvedAddress = { address: string; family: 4 | 6 };
export type GcsLookup = (host: string) => Promise<GcsResolvedAddress[]>;

const systemLookup: GcsLookup = async (host) =>
  (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/**
 * Adresa la care se conectează interogarea: un IP scris direct se verifică pe loc; un nume se rezolvă o dată, iar
 * **toate** adresele lui trebuie să fie permise (altfel `blocked`). Se preferă IPv4.
 */
export async function resolveTarget(host: string, opts: { lookup?: GcsLookup; allow?: BlockList | null } = {}): Promise<GcsResolvedAddress> {
  const allow = opts.allow ?? null;
  const family = isIP(host);
  if (family !== 0) {
    if (!isQueryableAddress(host, allow)) throw new GcsQueryFailure("blocked");
    return { address: host, family: family === 6 ? 6 : 4 };
  }
  let list: GcsResolvedAddress[];
  try {
    list = await (opts.lookup ?? systemLookup)(host);
  } catch {
    throw new GcsQueryFailure("dns");
  }
  if (list.length === 0) throw new GcsQueryFailure("dns");
  if (list.some((a) => !isQueryableAddress(a.address, allow))) throw new GcsQueryFailure("blocked");
  return list.find((a) => a.family === 4) ?? list[0]!;
}

/** Eroarea unui socket, ca un cod stabil. */
function socketFailure(error: unknown): GcsQueryFailure {
  if (error instanceof GcsQueryFailure) return error;
  const code = (error as { code?: string }).code;
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return new GcsQueryFailure("refused");
  if (code === "ETIMEDOUT") return new GcsQueryFailure("timeout");
  return new GcsQueryFailure("unreachable");
}

/** Cel mult atâția octeți primiți pe un canal UDP (cu toate pachetele, inclusiv cele ignorate). */
const UDP_MAX_BYTES = 256 * 1024;

/**
 * Un canal UDP „conectat” la o singură adresă: primește doar datagramele ei, le pune în coadă și le dă pe rând cu un
 * termen. Erorile ICMP (port închis) devin `refused`.
 */
export class GcsUdpChannel {
  private readonly queue: Buffer[] = [];
  private waiter: { resolve: (b: Buffer) => void; reject: (e: GcsQueryFailure) => void; timer: NodeJS.Timeout } | null = null;
  private failure: GcsQueryFailure | null = null;
  private received = 0;

  private constructor(private readonly socket: dgram.Socket) {
    socket.on("message", (msg) => {
      this.received += msg.length;
      if (this.received > UDP_MAX_BYTES) return this.fail(new GcsQueryFailure("too_large"));
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        clearTimeout(w.timer);
        w.resolve(msg);
      } else if (this.queue.length < 64) {
        this.queue.push(msg);
      }
    });
    socket.on("error", (error) => this.fail(socketFailure(error)));
  }

  static async open(target: GcsResolvedAddress, port: number): Promise<GcsUdpChannel> {
    const socket = dgram.createSocket(target.family === 6 ? "udp6" : "udp4");
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(socketFailure(error));
      socket.once("error", onError);
      socket.connect(port, target.address, () => {
        socket.off("error", onError);
        resolve();
      });
    }).catch((error: unknown) => {
      socket.close();
      throw error;
    });
    return new GcsUdpChannel(socket);
  }

  private fail(error: GcsQueryFailure): void {
    this.failure ??= error;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.reject(this.failure);
    }
  }

  send(buf: Buffer): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.socket.send(buf, (error) => (error ? reject(socketFailure(error)) : resolve())));
  }

  /** Următoarea datagramă, sau `timeout` la termenul dat (`Date.now()` în ms). */
  next(deadline: number): Promise<Buffer> {
    if (this.failure) return Promise.reject(this.failure);
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    const wait = deadline - Date.now();
    if (wait <= 0) return Promise.reject(new GcsQueryFailure("timeout"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new GcsQueryFailure("timeout"));
      }, wait);
      this.waiter = { resolve, reject, timer };
    });
  }

  close(): void {
    if (this.waiter) clearTimeout(this.waiter.timer);
    this.waiter = null;
    try {
      this.socket.close();
    } catch {
      // Deja închis.
    }
  }
}

/**
 * Un schimb TCP: conectare la adresa verificată, trimiterea cererii și citirea răspunsului până când `onData` întoarce
 * un rezultat (sau aruncă). Întoarce rezultatul și timpul până la primul octet (ping-ul).
 */
export function tcpExchange<T>(
  target: GcsResolvedAddress,
  port: number,
  request: Buffer,
  onData: (chunk: Buffer) => T | null,
  deadline: number,
): Promise<{ result: T; firstByteMs: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sentAt = 0;
    let firstByteMs: number | null = null;
    const socket = net.connect({ host: target.address, port, family: target.family, noDelay: true });
    const finish = (error: GcsQueryFailure | null, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve({ result: result as T, firstByteMs: firstByteMs ?? 0 });
    };
    const timer = setTimeout(() => finish(new GcsQueryFailure("timeout")), Math.max(0, deadline - Date.now()));
    socket.on("connect", () => {
      sentAt = Date.now();
      socket.write(request);
    });
    socket.on("data", (chunk: Buffer) => {
      firstByteMs ??= Date.now() - sentAt;
      try {
        const result = onData(chunk);
        if (result !== null) finish(null, result);
      } catch (error) {
        finish(socketFailure(error));
      }
    });
    socket.on("error", (error) => finish(socketFailure(error)));
    socket.on("close", () => finish(new GcsQueryFailure(firstByteMs === null ? "refused" : "invalid_response")));
  });
}

/** Cel mult atâția octeți primiți pe un canal TCP de interogare (ServerQuery). */
const TCP_MAX_BYTES = 512 * 1024;

/**
 * Un canal TCP spre adresa deja verificată (fără a doua rezolvare DNS), pentru protocoalele cu mai multe schimburi
 * (ServerQuery TeamSpeak): bucățile primite stau în coadă și se citesc cu un termen; peste 512 KB → `too_large`.
 */
export class GcsTcpChannel {
  private readonly queue: Buffer[] = [];
  private waiter: { resolve: (b: Buffer) => void; reject: (e: GcsQueryFailure) => void; timer: NodeJS.Timeout } | null = null;
  private failure: GcsQueryFailure | null = null;
  private received = 0;

  private constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.received += chunk.length;
      if (this.received > TCP_MAX_BYTES) return this.fail(new GcsQueryFailure("too_large"));
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        clearTimeout(w.timer);
        w.resolve(chunk);
      } else {
        this.queue.push(chunk);
      }
    });
    socket.on("error", (error) => this.fail(socketFailure(error)));
    socket.on("close", () => this.fail(new GcsQueryFailure(this.received === 0 ? "refused" : "invalid_response")));
  }

  static open(target: GcsResolvedAddress, port: number, deadline: number): Promise<GcsTcpChannel> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: target.address, port, family: target.family, noDelay: true });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new GcsQueryFailure("timeout"));
      }, Math.max(0, deadline - Date.now()));
      socket.once("error", (error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(socketFailure(error));
      });
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.removeAllListeners("error");
        resolve(new GcsTcpChannel(socket));
      });
    });
  }

  private fail(error: GcsQueryFailure): void {
    this.failure ??= error;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.reject(this.failure);
    }
  }

  send(buf: Buffer): void {
    if (this.failure) throw this.failure;
    this.socket.write(buf);
  }

  /** Următoarea bucată primită, sau `timeout` la termen (`Date.now()` în ms). */
  next(deadline: number): Promise<Buffer> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    const wait = deadline - Date.now();
    if (wait <= 0) return Promise.reject(new GcsQueryFailure("timeout"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new GcsQueryFailure("timeout"));
      }, wait);
      this.waiter = { resolve, reject, timer };
    });
  }

  close(): void {
    if (this.waiter) clearTimeout(this.waiter.timer);
    this.waiter = null;
    this.socket.destroy();
  }
}

/**
 * Un GET HTTP (fără TLS) spre adresa deja verificată, cu `Host` pus de noi: fără redirecturi, cu termen și cu răspunsul
 * plafonat (WebQuery-ul TeamSpeak). Doar statusul 2xx e reușit; 401 / 403 → `auth_failed`, 404 → `not_found`.
 */
export function httpGetJson(
  target: GcsResolvedAddress,
  port: number,
  path: string,
  opts: { host: string; headers?: Record<string, string>; deadline: number; maxBytes: number },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: GcsQueryFailure | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const req = http.request(
      {
        host: target.address,
        family: target.family,
        port,
        path,
        method: "GET",
        agent: false,
        headers: { host: opts.host.includes(":") ? `[${opts.host}]:${port}` : `${opts.host}:${port}`, accept: "application/json", "user-agent": "GamingCommunitySuite", ...(opts.headers ?? {}) },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status === 401 || status === 403) return finish(new GcsQueryFailure("auth_failed"));
        if (status === 404) return finish(new GcsQueryFailure("not_found"));
        if (status < 200 || status >= 300) return finish(new GcsQueryFailure("invalid_response"));
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) return finish(new GcsQueryFailure("too_large"));
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            finish(new GcsQueryFailure("invalid_response"));
          }
        });
        res.on("error", (error) => finish(socketFailure(error)));
      },
    );
    const timer = setTimeout(() => finish(new GcsQueryFailure("timeout")), Math.max(0, opts.deadline - Date.now()));
    req.on("error", (error) => finish(socketFailure(error)));
    req.end();
  });
}
