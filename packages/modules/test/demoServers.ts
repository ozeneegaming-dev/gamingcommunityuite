import http from "node:http";
import net from "node:net";
import { Server as SshServer, utils as sshUtils } from "ssh2";

/**
 * Serverele locale ale testelor demo-urilor (specul 2026-10-08-servere-hltv §9), pe 127.0.0.1: un folder HTTP cu pagina
 * de index, un FTP minimal (MLSD / LIST, PASV cu o adresă falsă în răspuns, ca să se vadă că transferul merge doar la
 * IP-ul conexiunii de control) și un SFTP (serverul din `ssh2`, cu parolă).
 */

export type DemoFiles = Map<string, { bytes: Buffer; modifiedAt?: Date }>;

/** Un demo fals: antetul jocului + octeți. */
export function fakeDemo(game: "cs16" | "cs2", size = 4096, fill = 7): Buffer {
  const head = Buffer.from(game === "cs16" ? "HLDEMO\0\0" : "PBDEMS2\0", "latin1");
  const body = Buffer.alloc(Math.max(0, size - head.length), fill);
  for (let i = 0; i < body.length; i += 97) body[i] = i % 251;
  return Buffer.concat([head, body]);
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

export async function startHttpDemoServer(files: DemoFiles, opts: { dir?: string; redirectTo?: string } = {}) {
  const dir = opts.dir ?? "/demos/";
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    requests.push(url.pathname);
    if (url.pathname === dir) {
      const links = [...files.keys()].map((n) => `<a href="${encodeURIComponent(n)}">${n}</a>`).join("\n");
      res.setHeader("content-type", "text/html");
      return res.end(`<html><body><h1>Index of ${dir}</h1><a href="../">../</a>\n<a href="http://altundeva.test/x.dem">x</a>\n<a href="/alt/y.dem">y</a>\n${links}</body></html>`);
    }
    if (opts.redirectTo && url.pathname === `${dir}redirect.dem`) {
      res.statusCode = 302;
      res.setHeader("location", opts.redirectTo);
      return res.end();
    }
    const name = decodeURIComponent(url.pathname.slice(dir.length));
    const file = url.pathname.startsWith(dir) ? files.get(name) : undefined;
    if (!file) {
      res.statusCode = 404;
      return res.end("not found");
    }
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("content-length", String(file.bytes.length));
    res.end(file.bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return { port, url: `http://127.0.0.1:${port}${dir}`, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

// ─── FTP ────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const mlsdTime = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

export async function startFtpDemoServer(files: DemoFiles, opts: { user?: string; pass?: string; dir?: string; mlsd?: boolean } = {}) {
  const user = opts.user ?? "hltv";
  const pass = opts.pass ?? "parola-ftp";
  const dir = opts.dir ?? "/demos";
  const log: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
    let authed = false;
    let data: Promise<net.Socket> | null = null;
    let dataServer: net.Server | null = null;
    const send = (line: string) => sock.write(`${line}\r\n`);
    const withData = async (fn: (d: net.Socket) => void) => {
      if (!data) return send("425 Use PASV first");
      send("150 Opening data connection");
      const d = await data;
      fn(d);
      d.end(() => {
        dataServer?.close();
        dataServer = null;
        data = null;
        send("226 Transfer complete");
      });
    };
    send("220 GCS test FTP");
    let buffer = "";
    sock.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const [cmd = "", ...rest] = line.split(" ");
        const arg = rest.join(" ");
        log.push(cmd.toUpperCase() === "PASS" ? "PASS ***" : line);
        switch (cmd.toUpperCase()) {
          case "USER":
            send("331 Password required");
            break;
          case "PASS":
            authed = arg === pass;
            send(authed ? "230 Logged in" : "530 Login incorrect");
            break;
          case "FEAT":
            sock.write(`211-Features:\r\n${opts.mlsd === false ? "" : " MLST type*;size*;modify*;\r\n"} UTF8\r\n211 End\r\n`);
            break;
          case "OPTS":
          case "TYPE":
          case "STRU":
            send("200 OK");
            break;
          case "SYST":
            send("215 UNIX Type: L8");
            break;
          case "PWD":
            send('257 "/"');
            break;
          case "EPSV":
            send("502 EPSV not implemented");
            break;
          case "PASV": {
            if (!authed) return send("530 Not logged in");
            dataServer = net.createServer();
            data = new Promise((resolve) => dataServer!.once("connection", resolve));
            dataServer.listen(0, "127.0.0.1", () => {
              const p = (dataServer!.address() as net.AddressInfo).port;
              // Adresa din răspuns e falsă: un client corect o ignoră și folosește IP-ul conexiunii de control.
              send(`227 Entering Passive Mode (10,9,9,9,${Math.floor(p / 256)},${p % 256})`);
            });
            break;
          }
          case "MLSD":
          case "LIST": {
            if (!authed) return send("530 Not logged in");
            const target = arg.replace(/^-a\s*/, "").trim() || "/";
            if (target !== dir) {
              void withData(() => {});
              break;
            }
            void withData((d) => {
              for (const [name, f] of files) {
                const at = f.modifiedAt ?? new Date("2026-10-08T20:00:00Z");
                d.write(cmd.toUpperCase() === "MLSD" ? `type=file;size=${f.bytes.length};modify=${mlsdTime(at)}; ${name}\r\n` : `-rw-r--r-- 1 hltv hltv ${f.bytes.length} Oct 08 20:00 ${name}\r\n`);
              }
              d.write(cmd.toUpperCase() === "MLSD" ? "type=dir;modify=20261008200000; sub\r\n" : "drwxr-xr-x 2 hltv hltv 4096 Oct 08 20:00 sub\r\n");
            });
            break;
          }
          case "RETR": {
            if (!authed) return send("530 Not logged in");
            const name = arg.startsWith(`${dir}/`) ? arg.slice(dir.length + 1) : "";
            const file = files.get(name);
            if (!file) {
              dataServer?.close();
              data = null;
              send("550 No such file");
              break;
            }
            void withData((d) => d.write(file.bytes));
            break;
          }
          case "QUIT":
            send("221 Bye");
            sock.end();
            break;
          default:
            send("502 Command not implemented");
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    user,
    pass,
    dir,
    log,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

// ─── SFTP ───────────────────────────────────────────────────────────────────

const STATUS = { OK: 0, EOF: 1, NO_SUCH_FILE: 2, FAILURE: 4 } as const;

export async function startSftpDemoServer(files: DemoFiles, opts: { user?: string; pass?: string; dir?: string } = {}) {
  const user = opts.user ?? "hltv";
  const pass = opts.pass ?? "parola-sftp";
  const dir = opts.dir ?? "/demos";
  const hostKey = sshUtils.generateKeyPairSync("ed25519");
  const parsed = sshUtils.parseKey(hostKey.private);
  if (parsed instanceof Error) throw parsed;
  const publicBlob = (Array.isArray(parsed) ? parsed[0]! : parsed).getPublicSSH();
  const server = new SshServer({ hostKeys: [hostKey.private] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (ctx) => {
      if (ctx.method === "password" && ctx.username === user && ctx.password === pass) ctx.accept();
      else ctx.reject(["password"]);
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("sftp", (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map<string, { kind: "dir"; done: boolean } | { kind: "file"; bytes: Buffer }>();
          let next = 0;
          const handle = (value: { kind: "dir"; done: boolean } | { kind: "file"; bytes: Buffer }) => {
            const h = Buffer.from(String(next++));
            handles.set(h.toString(), value);
            return h;
          };
          sftp.on("OPENDIR", (reqid, path) => {
            if (path !== dir) return sftp.status(reqid, STATUS.NO_SUCH_FILE);
            sftp.handle(reqid, handle({ kind: "dir", done: false }));
          });
          sftp.on("READDIR", (reqid, h) => {
            const entry = handles.get(h.toString());
            if (!entry || entry.kind !== "dir") return sftp.status(reqid, STATUS.FAILURE);
            if (entry.done) return sftp.status(reqid, STATUS.EOF);
            entry.done = true;
            const list = [...files].map(([name, f]) => ({
              filename: name,
              longname: `-rw-r--r-- 1 hltv hltv ${f.bytes.length} Oct 08 20:00 ${name}`,
              attrs: { mode: 0o100644, uid: 0, gid: 0, size: f.bytes.length, atime: 0, mtime: Math.floor((f.modifiedAt ?? new Date("2026-10-08T20:00:00Z")).getTime() / 1000) },
            }));
            list.push({ filename: "sub", longname: "drwxr-xr-x 2 hltv hltv 4096 Oct 08 20:00 sub", attrs: { mode: 0o040755, uid: 0, gid: 0, size: 4096, atime: 0, mtime: 0 } });
            sftp.name(reqid, list);
          });
          sftp.on("OPEN", (reqid, filename) => {
            const name = filename.startsWith(`${dir}/`) ? filename.slice(dir.length + 1) : "";
            const file = files.get(name);
            if (!file) return sftp.status(reqid, STATUS.NO_SUCH_FILE);
            sftp.handle(reqid, handle({ kind: "file", bytes: file.bytes }));
          });
          sftp.on("READ", (reqid, h, offset, length) => {
            const entry = handles.get(h.toString());
            if (!entry || entry.kind !== "file") return sftp.status(reqid, STATUS.FAILURE);
            if (offset >= entry.bytes.length) return sftp.status(reqid, STATUS.EOF);
            sftp.data(reqid, entry.bytes.subarray(offset, Math.min(entry.bytes.length, offset + length)));
          });
          sftp.on("FSTAT", (reqid, h) => {
            const entry = handles.get(h.toString());
            if (!entry || entry.kind !== "file") return sftp.status(reqid, STATUS.FAILURE);
            sftp.attrs(reqid, { mode: 0o100644, uid: 0, gid: 0, size: entry.bytes.length, atime: 0, mtime: 0 });
          });
          sftp.on("CLOSE", (reqid, h) => {
            handles.delete(h.toString());
            sftp.status(reqid, STATUS.OK);
          });
        });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return { port, user, pass, dir, publicBlob, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
