import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { describe, expect, test } from "vitest";
import { checkPushEndpoint } from "./push";
import { buildPushRequest, encryptPushPayload, generateVapidKeys, validPushKeys, vapidJwt } from "./webpush";

/** Un browser abonat: cheia lui ECDH (P-256) și secretul de autentificare, ca în `PushSubscription.toJSON()`. */
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
}

/** Decriptarea făcută de browser (RFC 8291), ca verificare a criptării. */
function decrypt(body: Buffer, ua: ReturnType<typeof browser>): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  expect(rs).toBe(4096);
  const shared = ua.ecdh.computeSecret(asPublic);
  const uaPublic = ua.ecdh.getPublicKey();
  const ikm = Buffer.from(hkdfSync("sha256", shared, Buffer.from(ua.auth, "base64url"), Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  // Delimitatorul ultimei înregistrări (0x02), fără umplutură.
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

describe("web push: criptarea mesajului (RFC 8291)", () => {
  test("browserul abonat decriptează exact textul trimis; două trimiteri dau corpuri diferite", () => {
    const ua = browser();
    const text = JSON.stringify({ title: "Comunitatea", body: "Ana ți-a trimis un mesaj: „Salut”", url: "/notifications/7?via=push" });
    const a = encryptPushPayload(ua, Buffer.from(text));
    const b = encryptPushPayload(ua, Buffer.from(text));
    expect(decrypt(a, ua)).toBe(text);
    expect(a.equals(b)).toBe(false);
  });

  test("un mesaj prea mare e refuzat (limita serviciilor de push e 4 KB)", () => {
    expect(() => encryptPushPayload(browser(), Buffer.alloc(4000, 97))).toThrow("push_payload_too_large");
  });

  test("cheile abonamentului: punct P-256 necomprimat de 65 de octeți și secret de 16", () => {
    const ua = browser();
    expect(validPushKeys(ua.p256dh, ua.auth)).toBe(true);
    expect(validPushKeys(ua.p256dh.slice(4), ua.auth)).toBe(false);
    expect(validPushKeys(ua.p256dh, randomBytes(8).toString("base64url"))).toBe(false);
    expect(validPushKeys("<script>", ua.auth)).toBe(false);
  });
});

describe("web push: VAPID (RFC 8292)", () => {
  test("JWT-ul e semnat ES256 cu cheia privată; publica îl verifică; audiența e originea serviciului", () => {
    const keys = generateVapidKeys();
    expect(Buffer.from(keys.publicKey, "base64url")).toHaveLength(65);
    const now = new Date("2026-10-17T10:00:00Z");
    const jwt = vapidJwt("https://push.example.com", "mailto:admin@example.com", keys, now);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toEqual({ aud: "https://push.example.com", exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: "mailto:admin@example.com" });
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: keys.privateJwk.x, y: keys.privateJwk.y }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"))).toBe(true);
  });

  test("cererea: corpul criptat, TTL, urgența, subiectul și antetul `vapid t=…, k=…`", () => {
    const keys = generateVapidKeys();
    const ua = browser();
    const req = buildPushRequest({ endpoint: "https://fcm.example.com/send/abc", p256dh: ua.p256dh, auth: ua.auth }, "salut", { ...keys, subject: "mailto:a@b.ro" }, { urgency: "high", topic: "abc_DEF-1", ttlSec: 60 });
    expect(req.url).toBe("https://fcm.example.com/send/abc");
    expect(req.headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "60", urgency: "high", topic: "abc_DEF-1" });
    expect(req.headers.authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`));
    expect(decrypt(req.body, ua)).toBe("salut");
    // Un subiect invalid nu se trimite.
    expect(buildPushRequest({ endpoint: "https://fcm.example.com/x", p256dh: ua.p256dh, auth: ua.auth }, "x", { ...keys, subject: "mailto:a@b.ro" }, { topic: "no spaces!" }).headers.topic).toBeUndefined();
  });

  test("adresa abonamentului: doar https public (fără rețeaua internă)", () => {
    expect(checkPushEndpoint("https://fcm.googleapis.com/fcm/send/abc").host).toBe("fcm.googleapis.com");
    for (const bad of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://localhost/x", "https://user:pw@push.example.com/x", "https://push.example.com:6379/x", "https://intranet/x", "javascript:alert(1)", 42]) {
      expect(() => checkPushEndpoint(bad), String(bad)).toThrow();
    }
  });
});
