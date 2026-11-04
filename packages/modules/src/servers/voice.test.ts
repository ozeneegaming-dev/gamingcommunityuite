import dgram from "node:dgram";
import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { joinHref, safeDiscordInvite, serverAddress, gameDef } from "./games";
import { parseAllowNets } from "./net";
import { tsEscape, tsParseRecords, tsServerInfo, tsUnescape, tsWebBody } from "./protocols/teamspeak";
import { mumblePing, parseDiscordWidget, parseMumblePong } from "./protocols/voice";
import { queryGameServer } from "./query";
import { withUptime } from "./poller";

const allow = parseAllowNets("127.0.0.1/32");
const fast = { allow, timeoutMs: 1500, retryMs: 300 };

describe("TeamSpeak: textul ServerQuery", () => {
  test("escaparea nu lasă o parolă să înceapă o comandă nouă și se inversează exact", () => {
    const evil = "pa ss|x\nquit\\/";
    const esc = tsEscape(evil);
    expect(esc).not.toMatch(/[ |\n]/);
    expect(tsUnescape(esc)).toBe(evil);
  });

  test("înregistrările, utilizatorii fără clienții de interogare și numele doar ale clienților voce", () => {
    const [info] = tsParseRecords("virtualserver_name=GCS\\sTS virtualserver_clientsonline=20 virtualserver_queryclientsonline=2 virtualserver_maxclients=64 virtualserver_channelsonline=24 virtualserver_version=3.13.7\\s[Build:\\s1]");
    const clients = tsParseRecords("clid=1 client_nickname=Kaze client_type=0|clid=2 client_nickname=serveradmin client_type=1|clid=3 client_nickname=Nyx\\sRO client_type=0");
    expect(tsServerInfo(info!, clients)).toEqual({ name: "GCS TS", version: "3.13.7", clients: 18, maxClients: 64, channels: 24, names: ["Kaze", "Nyx RO"] });
  });

  test("WebQuery: corpul JSON; o eroare de permisiune devine `auth_failed`", () => {
    expect(tsWebBody({ body: [{ server_id: "1" }], status: { code: 0 } })).toEqual([{ server_id: "1" }]);
    expect(() => tsWebBody({ status: { code: 2568, message: "insufficient client permissions" } })).toThrow("auth_failed");
    expect(() => tsWebBody("x")).toThrow("invalid_response");
  });
});

describe("Mumble și Discord: răspunsurile", () => {
  test("pongul Mumble: versiunea, utilizatorii și sloturile; un ecou greșit e refuzat", () => {
    const ident = Buffer.from("12345678");
    const pong = Buffer.alloc(24);
    pong.writeUInt32BE((1 << 16) | (5 << 8) | 122, 0);
    ident.copy(pong, 4);
    pong.writeUInt32BE(7, 12);
    pong.writeUInt32BE(50, 16);
    expect(parseMumblePong(pong, ident)).toEqual({ version: "1.5.122", users: 7, maxUsers: 50 });
    expect(() => parseMumblePong(pong, Buffer.from("87654321"))).toThrow("invalid_response");
    expect(mumblePing(ident)).toHaveLength(12);
  });

  test("widget-ul Discord: membrii online, invitația verificată, canalele; widget oprit = `widget_disabled`", () => {
    const w = parseDiscordWidget({ id: "1", name: "GCS", instant_invite: "https://discord.com/invite/abcDEF", presence_count: 312, channels: [{}, {}], members: [{ username: "Kaze" }, { username: "" }, {}] });
    expect(w).toEqual({ name: "GCS", online: 312, invite: "https://discord.gg/abcDEF", channels: 2, members: ["Kaze"] });
    expect(parseDiscordWidget({ id: "1", name: "x", instant_invite: "javascript:alert(1)" }).invite).toBeNull();
    expect(() => parseDiscordWidget({ code: 50004, message: "Widget Disabled" })).toThrow("widget_disabled");
  });

  test("invitațiile acceptate sunt doar `discord.gg` / `discord.com/invite`", () => {
    expect(safeDiscordInvite("https://discord.gg/x1")).toBe("https://discord.gg/x1");
    expect(safeDiscordInvite("https://evil.example/discord.gg/x1")).toBeNull();
    expect(safeDiscordInvite("http://discord.gg/x1")).toBeNull();
  });

  test("linkurile „Intră” și adresa afișată", () => {
    expect(joinHref(gameDef("teamspeak"), "ts.exemplu.ro", 9987)).toBe("ts3server://ts.exemplu.ro?port=9987");
    expect(joinHref(gameDef("mumble"), "m.exemplu.ro", 64738)).toBe("mumble://m.exemplu.ro:64738/");
    expect(joinHref(gameDef("discord"), "123", 443, "https://discord.gg/abc")).toBe("https://discord.gg/abc");
    expect(joinHref(gameDef("cs2"), "a.ro", 27015)).toBeNull();
    expect(serverAddress(gameDef("teamspeak"), "ts.exemplu.ro", 9987)).toBe("ts.exemplu.ro");
    expect(serverAddress(gameDef("discord"), "123456789012345678", 443)).toBe("");
  });
});

describe("„Online de” și „Ultima dată”", () => {
  const base = { name: null, map: null, players: 0, maxPlayers: 0, bots: 0, ping: null, version: null, playerList: null, error: null } as const;
  test("pornirea fixează ora; online la rând o păstrează; căderea păstrează ultima interogare reușită", () => {
    const t0 = Date.UTC(2026, 10, 4, 10);
    const up = withUptime(null, { ...base, online: true, updatedAt: new Date(t0).toISOString() }, t0);
    expect(up.onlineSince).toBe(new Date(t0).toISOString());
    const still = withUptime(up, { ...base, online: true, updatedAt: "" }, t0 + 60_000);
    expect(still.onlineSince).toBe(up.onlineSince);
    const down = withUptime({ ...still, updatedAt: new Date(t0 + 60_000).toISOString() }, { ...base, online: false, updatedAt: "" }, t0 + 120_000);
    expect(down).toMatchObject({ onlineSince: null, lastOnlineAt: new Date(t0 + 60_000).toISOString() });
    expect(withUptime(down, { ...base, online: false, updatedAt: "" }, t0 + 999_000).lastOnlineAt).toBe(down.lastOnlineAt);
  });
});

describe("interogarea serverelor de comunicare (servere false locale)", () => {
  let ts: net.Server;
  let tsPort = 0;
  let web: http.Server;
  let webPort = 0;
  let mumble: dgram.Socket;
  let mumblePort = 0;
  const seen: string[] = [];

  beforeAll(async () => {
    ts = net.createServer((sock) => {
      sock.write("TS3\n\rWelcome to the TeamSpeak 3 ServerQuery interface.\n\r");
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          seen.push(line);
          if (line.startsWith("login")) sock.write(line.includes("client_login_password=bun") ? "error id=0 msg=ok\n\r" : "error id=520 msg=invalid\\sloginname\\sor\\spassword\n\r");
          else if (line.startsWith("use")) sock.write("error id=0 msg=ok\n\r");
          else if (line === "serverinfo") sock.write("virtualserver_name=TS\\sGCS virtualserver_clientsonline=19 virtualserver_queryclientsonline=1 virtualserver_maxclients=64 virtualserver_channelsonline=24 virtualserver_version=3.13.7\n\rerror id=0 msg=ok\n\r");
          else if (line === "clientlist") sock.write("clid=1 client_nickname=Kaze client_type=0|clid=2 client_nickname=q client_type=1\n\rerror id=0 msg=ok\n\r");
          else if (line === "quit") sock.end();
        }
      });
    });
    await new Promise<void>((r) => ts.listen(0, "127.0.0.1", () => r()));
    tsPort = (ts.address() as net.AddressInfo).port;

    web = http.createServer((req, res) => {
      if (req.headers["x-api-key"] !== "cheie") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: { code: 2568, message: "no" } }));
        return;
      }
      const body = req.url?.startsWith("/serveridgetbyport") ? [{ server_id: "1" }] : req.url === "/1/serverinfo" ? [{ virtualserver_name: "Web TS", virtualserver_clientsonline: "5", virtualserver_queryclientsonline: "0", virtualserver_maxclients: "32", virtualserver_channelsonline: "8" }] : [];
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ body, status: { code: 0, message: "ok" } }));
    });
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", () => r()));
    webPort = (web.address() as net.AddressInfo).port;

    mumble = dgram.createSocket("udp4");
    mumble.on("message", (msg, rinfo) => {
      const out = Buffer.alloc(24);
      out.writeUInt32BE((1 << 16) | (4 << 8), 0);
      msg.copy(out, 4, 4, 12);
      out.writeUInt32BE(3, 12);
      out.writeUInt32BE(100, 16);
      mumble.send(out, rinfo.port, rinfo.address);
    });
    await new Promise<void>((r) => mumble.bind(0, "127.0.0.1", () => r()));
    mumblePort = mumble.address().port;
  });

  afterAll(async () => {
    await new Promise((r) => ts.close(r));
    await new Promise((r) => web.close(r));
    mumble.close();
  });

  test("TeamSpeak ServerQuery cu cont: utilizatorii fără clientul de interogare, canalele, numele", async () => {
    const status = await queryGameServer({ game: "teamspeak", host: "127.0.0.1", port: 9987, queryPort: tsPort, auth: { mode: "raw", user: "gcs", secret: "bun" } }, fast);
    expect(status).toMatchObject({ online: true, name: "TS GCS", players: 18, maxPlayers: 64, channels: 24, version: "3.13.7", playerList: [{ name: "Kaze" }] });
    expect(seen).toContain("use port=9987");
  });

  test("TeamSpeak: parola greșită → `auth_failed`; parola nu apare în eroare", async () => {
    const status = await queryGameServer({ game: "teamspeak", host: "127.0.0.1", port: 9987, queryPort: tsPort, auth: { mode: "raw", user: "gcs", secret: "rea" } }, fast);
    expect(status).toMatchObject({ online: false, error: "auth_failed" });
    expect(JSON.stringify(status)).not.toContain("rea");
  });

  test("TeamSpeak WebQuery: cheia API în antet, serverul după portul de voce", async () => {
    const status = await queryGameServer({ game: "teamspeak", host: "127.0.0.1", port: 9987, queryPort: webPort, auth: { mode: "http", user: "", secret: "cheie" } }, fast);
    expect(status).toMatchObject({ online: true, name: "Web TS", players: 5, maxPlayers: 32, channels: 8 });
    const bad = await queryGameServer({ game: "teamspeak", host: "127.0.0.1", port: 9987, queryPort: webPort, auth: { mode: "http", user: "", secret: "alta" } }, fast);
    expect(bad.error).toBe("auth_failed");
  });

  test("Mumble: pingul UDP", async () => {
    const status = await queryGameServer({ game: "mumble", host: "127.0.0.1", port: mumblePort }, fast);
    expect(status).toMatchObject({ online: true, players: 3, maxPlayers: 100, version: "1.4.0" });
  });

  test("garda SSRF: fără excepția operatorului, adresa locală e refuzată înainte de orice conexiune", async () => {
    const status = await queryGameServer({ game: "teamspeak", host: "127.0.0.1", port: 9987, queryPort: tsPort }, { timeoutMs: 1000 });
    expect(status).toMatchObject({ online: false, error: "blocked" });
  });

  test("Discord: widget-ul (injectat), ID-ul validat; membrii doar cu lista cerută", async () => {
    const calls: string[] = [];
    const discord = async (id: string) => {
      calls.push(id);
      return { id, name: "GCS", presence_count: 312, instant_invite: "https://discord.gg/gcs", channels: [{}], members: [{ username: "Kaze" }] };
    };
    const status = await queryGameServer({ game: "discord", host: "123456789012345678", port: 443 }, { ...fast, discord });
    expect(status).toMatchObject({ online: true, name: "GCS", players: 312, invite: "https://discord.gg/gcs", channels: 1, playerList: [{ name: "Kaze" }] });
    const bad = await queryGameServer({ game: "discord", host: "../../users/@me", port: 443 }, { ...fast, discord });
    expect(bad).toMatchObject({ online: false, error: "not_found" });
    expect(calls).toEqual(["123456789012345678"]);
  });
});
