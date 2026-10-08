import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import path from "node:path/posix";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Client as FtpClient, FileType, FTPError } from "basic-ftp";
import { Client as SshClient, type ConnectConfig, type SFTPWrapper } from "ssh2";
import { GcsDemoError, resolveDemoHost, type GcsDemoGuardOptions, type GcsDemoLookup } from "./guard";
import { isSafeDemoName, type GcsRemoteDemo } from "./names";
import { httpFolderUrl } from "./settings";

/**
 * Sursele demo-urilor (specul 2026-10-08-servere-hltv §4.1–4.2): FTP / FTPS (`basic-ftp`), SFTP (`ssh2`) și folderul
 * HTTP. Toate trec prin garda SSRF (host-ul configurat, rezolvat o singură dată, conexiunea la IP-ul verificat), au
 * termene și limite de mărime și dau aceeași interfață: lista fișierelor `.dem` din folder și descărcarea unuia într-un
 * fișier local.
 */

/** Configurația unei surse (secretele deja deschise, doar în memoria procesului). */
export type GcsDemoSourceConfig = {
  source: "ftp" | "ftps" | "sftp" | "http";
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  privateKey: string | null;
  remoteDir: string;
  tlsInsecure: boolean;
  /** Amprenta SFTP reținută (`SHA256:…`); `null` = prima conectare o va reține. */
  hostKey: string | null;
  httpTemplate: string | null;
};

export type GcsDemoConnection = {
  /** Fișierele `.dem` din folder (doar nume sigure). */
  list(): Promise<GcsRemoteDemo[]>;
  /** Descarcă fișierul în `dest`, cel mult `maxBytes` (altfel `too_large`); întoarce mărimea. */
  download(name: string, dest: string, maxBytes: number): Promise<number>;
  close(): Promise<void>;
  /** SFTP: amprenta cheii serverului văzută la conectare. */
  hostKey: string | null;
};

export type GcsDemoConnectOptions = {
  guard: GcsDemoGuardOptions;
  lookup?: GcsDemoLookup;
  /** Conectarea / fiecare comandă (implicit 15 s). */
  timeoutMs?: number;
  /** O descărcare întreagă (implicit 15 minute). */
  downloadTimeoutMs?: number;
};

export type GcsDemoConnect = (cfg: GcsDemoSourceConfig, opts: GcsDemoConnectOptions) => Promise<GcsDemoConnection>;

const LISTING_MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5000;

/** Un `Writable` spre fișier care se oprește la `maxBytes` (eroarea `too_large`). */
function limitedFile(dest: string, maxBytes: number): { stream: Writable; size: () => number } {
  const out = createWriteStream(dest);
  let size = 0;
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) return cb(new GcsDemoError("too_large"));
      out.write(chunk, cb);
    },
    final(cb) {
      out.end(cb);
    },
    destroy(error, cb) {
      out.destroy();
      cb(error);
    },
  });
  return { stream, size: () => size };
}

/** Șterge un fișier temporar (pe Windows, după un flux închis, poate fi încă ocupat câteva clipe). */
export async function removeQuietly(file: string): Promise<void> {
  await rm(file, { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}

/** Amprenta OpenSSH a unei chei publice: `SHA256:<base64 fără =>`. */
export function sshFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

function folder(dir: string): string {
  const d = dir.trim() || "/";
  return d;
}

/** O eroare a unei surse → codul stabil (fără mesaje care ar putea conține date sensibile). */
export function demoErrorCode(error: unknown): string {
  if (error instanceof GcsDemoError) return error.code;
  if (error instanceof FTPError) return error.code === 530 ? "auth" : error.code === 550 ? "not_found" : "protocol";
  const e = error as { code?: string; message?: string; level?: string };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  if (e.level === "client-authentication" || /authentication methods failed/i.test(message)) return "auth";
  if (/host key|hostVerifier|host verification/i.test(message)) return "host_key_mismatch";
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "refused";
  if (code === "ETIMEDOUT" || /timeout|timed out/i.test(message)) return "timeout";
  if (code.startsWith("ERR_TLS") || code.startsWith("CERT_") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || /certificate|tls|ssl/i.test(message)) return "tls";
  if (code === "ENOENT" || /no such file/i.test(message)) return "not_found";
  return "network";
}

// ─── FTP / FTPS ─────────────────────────────────────────────────────────────

async function connectFtp(cfg: GcsDemoSourceConfig, opts: GcsDemoConnectOptions): Promise<GcsDemoConnection> {
  if (!cfg.host || !cfg.username) throw new GcsDemoError("not_configured");
  const target = await resolveDemoHost(cfg.host, { ...opts.guard, ...(opts.lookup ? { lookup: opts.lookup } : {}) });
  // Transferurile pasive merg doar la IP-ul conexiunii de control (adresa din PASV se ignoră: fără „FTP bounce”).
  const client = new FtpClient(opts.timeoutMs ?? 15_000, { allowSeparateTransferHost: false, maxListingBytes: LISTING_MAX_BYTES });
  try {
    await client.access({
      host: target.address,
      port: cfg.port ?? 21,
      user: cfg.username,
      password: cfg.password ?? "",
      secure: cfg.source === "ftps",
      // Certificatul se verifică pe numele scris în ACP (SNI); „acceptă nevalidat” doar la cererea adminului.
      secureOptions: cfg.source === "ftps" ? { servername: cfg.host, rejectUnauthorized: !cfg.tlsInsecure } : undefined,
    });
  } catch (error) {
    client.close();
    throw new GcsDemoError(demoErrorCode(error));
  }
  const dir = folder(cfg.remoteDir);
  return {
    hostKey: null,
    async list() {
      try {
        const entries = await client.list(dir);
        return entries
          .filter((e) => e.type !== FileType.Directory && isSafeDemoName(e.name))
          .slice(0, MAX_FILES)
          .map((e) => ({ name: e.name, size: Number.isFinite(e.size) ? e.size : null, modifiedAt: e.modifiedAt ?? null }));
      } catch (error) {
        throw new GcsDemoError(demoErrorCode(error));
      }
    },
    async download(name, dest, maxBytes) {
      if (!isSafeDemoName(name)) throw new GcsDemoError("invalid_name");
      const file = limitedFile(dest, maxBytes);
      const timer = setTimeout(() => client.close(), opts.downloadTimeoutMs ?? 15 * 60_000);
      try {
        await client.downloadTo(file.stream, path.join(dir, name));
        return file.size();
      } catch (error) {
        await removeQuietly(dest);
        throw new GcsDemoError(file.size() > maxBytes ? "too_large" : client.closed && file.size() > 0 ? "timeout" : demoErrorCode(error));
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      client.close();
    },
  };
}

// ─── SFTP ───────────────────────────────────────────────────────────────────

async function connectSftp(cfg: GcsDemoSourceConfig, opts: GcsDemoConnectOptions): Promise<GcsDemoConnection> {
  if (!cfg.host || !cfg.username) throw new GcsDemoError("not_configured");
  const target = await resolveDemoHost(cfg.host, { ...opts.guard, ...(opts.lookup ? { lookup: opts.lookup } : {}) });
  const client = new SshClient();
  let seen: string | null = null;
  const config: ConnectConfig = {
    host: target.address,
    port: cfg.port ?? 22,
    username: cfg.username,
    readyTimeout: opts.timeoutMs ?? 15_000,
    // Cheia serverului: comparată cu amprenta reținută (prima conectare o reține apelantul, din `hostKey`).
    hostVerifier: (key: Buffer) => {
      seen = sshFingerprint(key);
      return cfg.hostKey === null || cfg.hostKey === "" || cfg.hostKey === seen;
    },
    ...(cfg.privateKey ? { privateKey: cfg.privateKey, ...(cfg.password ? { passphrase: cfg.password } : {}) } : { password: cfg.password ?? "" }),
  };
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.once("ready", () => client.sftp((error, s) => (error ? reject(error) : resolve(s))));
    client.once("error", reject);
    try {
      client.connect(config);
    } catch (error) {
      reject(error);
    }
  }).catch((error: unknown) => {
    client.end();
    if (seen !== null && cfg.hostKey && cfg.hostKey !== seen) throw new GcsDemoError("host_key_mismatch");
    throw new GcsDemoError(error instanceof Error && /private key|parse/i.test(error.message) ? "invalid_private_key" : demoErrorCode(error));
  });
  const dir = folder(cfg.remoteDir);
  const conn: GcsDemoConnection = {
    hostKey: seen,
    list() {
      return new Promise((resolve, reject) => {
        sftp.readdir(dir, (error, list) => {
          if (error) return reject(new GcsDemoError(demoErrorCode(error)));
          resolve(
            list
              .filter((e) => (e.attrs.mode & 0o170000) !== 0o040000 && isSafeDemoName(e.filename))
              .slice(0, MAX_FILES)
              .map((e) => ({ name: e.filename, size: e.attrs.size ?? null, modifiedAt: e.attrs.mtime ? new Date(e.attrs.mtime * 1000) : null })),
          );
        });
      });
    },
    async download(name, dest, maxBytes) {
      if (!isSafeDemoName(name)) throw new GcsDemoError("invalid_name");
      const file = limitedFile(dest, maxBytes);
      const source = sftp.createReadStream(path.join(dir, name));
      const timer = setTimeout(() => source.destroy(new GcsDemoError("timeout")), opts.downloadTimeoutMs ?? 15 * 60_000);
      try {
        await pipeline(source, file.stream);
        return file.size();
      } catch (error) {
        await removeQuietly(dest);
        throw new GcsDemoError(file.size() > maxBytes ? "too_large" : demoErrorCode(error));
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      client.end();
    },
  };
  return conn;
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

/** Legăturile `.dem` dintr-o pagină de index a folderului (numele simple, din același folder). */
export function parseIndexLinks(html: string, folderUrl: string): string[] {
  const base = new URL(folderUrl);
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const raw = (m[2] ?? m[3] ?? m[4] ?? "").replace(/&amp;/g, "&");
    if (!raw || !URL.canParse(raw, base.href)) continue;
    const url = new URL(raw, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) continue;
    let name: string;
    try {
      name = decodeURIComponent(url.pathname.slice(base.pathname.length));
    } catch {
      continue;
    }
    if (isSafeDemoName(name)) out.add(name);
    if (out.size >= MAX_FILES) break;
  }
  return [...out];
}

function httpGet(url: URL, address: string, family: 4 | 6, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    // Conexiunea la IP-ul verificat; numele merge în `Host` și în SNI / verificarea certificatului.
    const req = client.get(
      {
        protocol: url.protocol,
        host: address,
        family,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: { host: url.host, "user-agent": "GamingCommunitySuite-Demos", accept: "*/*" },
        servername: url.hostname,
        agent: false,
        signal,
      },
      resolve,
    );
    req.on("error", reject);
  });
}

async function connectHttp(cfg: GcsDemoSourceConfig, opts: GcsDemoConnectOptions): Promise<GcsDemoConnection> {
  if (!cfg.httpTemplate) throw new GcsDemoError("not_configured");
  const template = cfg.httpTemplate;
  const folderUrl = new URL(httpFolderUrl(template));
  const target = await resolveDemoHost(folderUrl.hostname.replace(/^\[|\]$/g, ""), { ...opts.guard, ...(opts.lookup ? { lookup: opts.lookup } : {}) });

  /** GET cu redirecturile doar pe aceeași origine (max 3). */
  async function get(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
    let current = url;
    for (let hop = 0; ; hop++) {
      let res: IncomingMessage;
      try {
        res = await httpGet(current, target.address, target.family, signal);
      } catch (error) {
        throw new GcsDemoError(signal.aborted ? "timeout" : demoErrorCode(error));
      }
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        const next = URL.canParse(res.headers.location, current.href) ? new URL(res.headers.location, current) : null;
        if (!next || next.origin !== folderUrl.origin || hop >= 3) throw new GcsDemoError("redirect");
        current = next;
        continue;
      }
      if (status === 404 || status === 410) {
        res.resume();
        throw new GcsDemoError("not_found");
      }
      if (status === 401 || status === 403) {
        res.resume();
        throw new GcsDemoError("auth");
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new GcsDemoError(`http_${status}`);
      }
      return res;
    }
  }

  return {
    hostKey: null,
    async list() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
      try {
        const res = await get(folderUrl, controller.signal);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of res as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > LISTING_MAX_BYTES) {
            res.destroy();
            throw new GcsDemoError("listing_too_large");
          }
          chunks.push(chunk);
        }
        return parseIndexLinks(Buffer.concat(chunks).toString("utf8"), folderUrl.toString()).map((name) => ({ name, size: null, modifiedAt: null }));
      } catch (error) {
        throw error instanceof GcsDemoError ? error : new GcsDemoError(controller.signal.aborted ? "timeout" : demoErrorCode(error));
      } finally {
        clearTimeout(timer);
      }
    },
    async download(name, dest, maxBytes) {
      if (!isSafeDemoName(name)) throw new GcsDemoError("invalid_name");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.downloadTimeoutMs ?? 15 * 60_000);
      const file = limitedFile(dest, maxBytes);
      try {
        const res = await get(new URL(template.replace("{file}", encodeURIComponent(name))), controller.signal);
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          throw new GcsDemoError("too_large");
        }
        await pipeline(res, file.stream);
        return file.size();
      } catch (error) {
        await removeQuietly(dest);
        if (error instanceof GcsDemoError) throw error;
        throw new GcsDemoError(file.size() > maxBytes ? "too_large" : controller.signal.aborted ? "timeout" : demoErrorCode(error));
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {},
  };
}

/** Conectarea la sursa configurată (FTP / FTPS / SFTP / HTTP). */
export const connectDemoSource: GcsDemoConnect = async (cfg, opts) => {
  if (cfg.source === "ftp" || cfg.source === "ftps") return connectFtp(cfg, opts);
  if (cfg.source === "sftp") return connectSftp(cfg, opts);
  if (cfg.source === "http") return connectHttp(cfg, opts);
  throw new GcsDemoError("not_configured");
};
