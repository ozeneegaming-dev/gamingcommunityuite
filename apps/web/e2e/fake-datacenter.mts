/**
 * Data Center-ul fals al E2E (installer-ul): `POST /api/license/activate` schimbă cheia scurtă de test pe un token GCS1
 * semnat cu cheia de unică folosință a rulării (licența cu Servere și Chat Pro, pentru `localhost`), iar
 * `POST /api/license/verify` (verificarea zilnică) răspunde „validă”. Orice altă cheie e `invalid_key`. Testele nu
 * vorbesc niciodată cu Data Center-ul real.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import http from "node:http";
import net from "node:net";

/** Cheia scurtă de test (alfabetul cheilor: fără 0 / O / 1 / I). */
export const E2E_LICENSE_SHORT_KEY = "GCS-E2E2-TEST-KEY7";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function token(privateKey: KeyObject): string {
  const payload = {
    v: 1,
    kid: "e2e",
    id: "dc-e2e",
    licensee: "Comunitatea E2E SRL",
    domains: ["localhost"],
    package: "standard",
    apps: ["servers", "chat_pro"],
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `GCS1.${body}.${sign(null, Buffer.from(`GCS-LICENSE-V1\n${body}`, "utf8"), privateKey).toString("base64url")}`;
}

/** Pornește serverul; întoarce adresa lui (pentru `GCS_LICENSE_SERVER`) și oprirea. */
export async function startFakeDataCenter(privateKeyPem: string): Promise<{ url: string; close: () => Promise<void> }> {
  const privateKey = createPrivateKey(privateKeyPem);
  const port = await freePort();
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      let body: { key?: unknown; domain?: unknown } = {};
      try {
        body = JSON.parse(raw || "{}") as typeof body;
      } catch {
        // Corp stricat: tratat ca o cerere fără cheie.
      }
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/api/license/activate") {
        const ok = body.key === E2E_LICENSE_SHORT_KEY && body.domain === "localhost";
        return res.end(JSON.stringify(ok ? { ok: true, token: token(privateKey), licensee: "Comunitatea E2E SRL" } : { ok: false, error: body.key === E2E_LICENSE_SHORT_KEY ? "domain" : "invalid_key" }));
      }
      if (req.method === "POST" && req.url === "/api/license/verify") return res.end(JSON.stringify({ valid: true, status: "active" }));
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
