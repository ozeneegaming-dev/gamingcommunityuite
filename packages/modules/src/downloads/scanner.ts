import { Socket } from "node:net";

/**
 * Antivirusul Descărcărilor: serviciul ClamAV (`clamd`) din compose, întrebat prin TCP. Semnăturile stau în memoria
 * lui (de aceea e un proces separat); aplicația doar trimite fișierul în flux (`INSTREAM`) și citește verdictul.
 * Arhivele sunt scanate pe dinăuntru de ClamAV (`ScanArchive`, implicit pornit). Fără serviciu (ediția Lite, serviciul
 * oprit) scannerul e „indisponibil” și fișierele rămân doar cu aprobarea manuală.
 */

export type GcsScanVerdict = { status: "clean" } | { status: "infected"; signature: string } | { status: "error"; error: string };
export type GcsScannerInfo = { available: boolean; engine: string | null; signatures: number | null; signaturesAt: string | null; error: string | null };

export interface GcsVirusScanner {
  /** Starea serviciului: răspunde, versiunea motorului și a semnăturilor. */
  info(): Promise<GcsScannerInfo>;
  /** Verifică un flux (fișierul întreg); `maxBytes` = limita citită (peste ea: eroare `too_large`). */
  scan(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<GcsScanVerdict>;
}

/** `gazda:port` → `{ host, port }`, sau `null` dacă adresa e goală / greșită. */
export function parseScannerAddress(address: string): { host: string; port: number } | null {
  const m = /^([A-Za-z0-9.-]{1,253}):(\d{1,5})$/.exec(address.trim());
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1]!, port } : null;
}

const CONNECT_TIMEOUT_MS = 3000;
const CHUNK = 64 * 1024;

/**
 * Versiunea `clamd`: `ClamAV 1.4.1/27450/Mon Nov  3 08:23:01 2026` → motorul, numărul bazei de semnături și data ei.
 */
export function parseClamVersion(raw: string): { engine: string; signatures: number | null; signaturesAt: string | null } {
  const [engine = "", db = "", ...date] = raw.trim().split("/");
  const at = date.join("/").trim();
  const parsed = at ? new Date(at) : null;
  return {
    engine: engine.trim(),
    signatures: /^\d+$/.test(db) ? Number(db) : null,
    signaturesAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
  };
}

/** Răspunsul la `INSTREAM`: `stream: OK`, `stream: <semnătură> FOUND` sau o eroare. */
export function parseScanReply(raw: string): GcsScanVerdict {
  const reply = raw.replace(/\0+$/, "").trim();
  if (/^stream: OK$/i.test(reply)) return { status: "clean" };
  const found = /^stream: (.+) FOUND$/i.exec(reply);
  if (found) return { status: "infected", signature: found[1]!.trim().slice(0, 200) };
  if (/size limit exceeded/i.test(reply)) return { status: "error", error: "too_large" };
  return { status: "error", error: reply.slice(0, 200) || "no_reply" };
}

/** Clientul `clamd` pe TCP (o conexiune pe comandă, comenzile cu prefixul `z` = terminate cu `\0`). */
export class GcsClamdScanner implements GcsVirusScanner {
  constructor(private readonly target: { host: string; port: number }, private readonly opts: { timeoutMs?: number } = {}) {}

  private connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("connect_timeout"));
      }, CONNECT_TIMEOUT_MS);
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.connect(this.target.port, this.target.host, () => {
        clearTimeout(timer);
        socket.removeAllListeners("error");
        resolve(socket);
      });
    });
  }

  /** Trimite o comandă (și, opțional, un corp) și întoarce răspunsul până la închiderea conexiunii. */
  private async exchange(command: string, body?: (socket: Socket) => Promise<void>): Promise<string> {
    const socket = await this.connect();
    const timeoutMs = this.opts.timeoutMs ?? 120_000;
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let settled = false;
      const done = (error: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(Buffer.concat(chunks).toString("utf8"));
      };
      const timer = setTimeout(() => done(new Error("scan_timeout")), timeoutMs);
      socket.on("data", (d: Buffer) => chunks.push(d));
      socket.on("end", () => done(null));
      socket.on("close", () => done(null));
      socket.on("error", (error) => done(error));
      socket.write(`z${command}\0`);
      if (body) body(socket).catch((error: unknown) => done(error instanceof Error ? error : new Error(String(error))));
    });
  }

  async info(): Promise<GcsScannerInfo> {
    try {
      const pong = await this.exchange("PING");
      if (!/PONG/.test(pong)) return { available: false, engine: null, signatures: null, signaturesAt: null, error: "no_pong" };
      const v = parseClamVersion((await this.exchange("VERSION")).replace(/\0+$/, ""));
      return { available: true, engine: v.engine || null, signatures: v.signatures, signaturesAt: v.signaturesAt, error: null };
    } catch (error) {
      return { available: false, engine: null, signatures: null, signaturesAt: null, error: error instanceof Error ? error.message.slice(0, 120) : "unreachable" };
    }
  }

  async scan(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<GcsScanVerdict> {
    let tooLarge = false;
    try {
      const reply = await this.exchange("INSTREAM", async (socket) => {
        let sent = 0;
        const write = (b: Buffer) => new Promise<void>((resolve, reject) => socket.write(b, (e) => (e ? reject(e) : resolve())));
        for await (const part of body) {
          let buf = Buffer.from(part);
          while (buf.length > 0) {
            const piece = buf.subarray(0, CHUNK);
            buf = buf.subarray(CHUNK);
            sent += piece.length;
            if (sent > maxBytes) {
              tooLarge = true;
              socket.destroy();
              return;
            }
            const len = Buffer.alloc(4);
            len.writeUInt32BE(piece.length);
            await write(Buffer.concat([len, piece]));
          }
        }
        await write(Buffer.alloc(4));
      });
      if (tooLarge) return { status: "error", error: "too_large" };
      return parseScanReply(reply);
    } catch (error) {
      if (tooLarge) return { status: "error", error: "too_large" };
      return { status: "error", error: error instanceof Error ? error.message.slice(0, 120) : "unreachable" };
    }
  }
}

/** Fără antivirus: indisponibil, nicio verificare. */
export const NO_SCANNER: GcsVirusScanner = {
  info: async () => ({ available: false, engine: null, signatures: null, signaturesAt: null, error: "disabled" }),
  scan: async () => ({ status: "error", error: "disabled" }),
};
