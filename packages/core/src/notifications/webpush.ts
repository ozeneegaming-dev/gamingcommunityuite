import { createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, createCipheriv, type JsonWebKey } from "node:crypto";

/**
 * Protocolul Web Push, fără biblioteci externe:
 * - VAPID (RFC 8292): serverul se identifică la serviciul de push al browserului cu un JWT ES256 semnat cu cheia lui;
 * - criptarea mesajului (RFC 8291, „aes128gcm” din RFC 8188): ECDH P-256 cu cheia abonamentului, HKDF-SHA-256, AES-128-GCM.
 * Cheile VAPID se generează o singură dată (worker-ul) și se păstrează criptate; aici nu se scrie nimic în jurnal.
 */

const b64 = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

/** Cheile VAPID: publica (punctul P-256 necomprimat, 65 de octeți, base64url) și privata ca JWK. */
export type GcsVapidKeys = { publicKey: string; privateJwk: JsonWebKey };

/** Un abonament push al unui browser (din `PushSubscription.toJSON()`). */
export type GcsPushTarget = { endpoint: string; p256dh: string; auth: string };

/** Cererea HTTP de trimis la serviciul de push. */
export type GcsPushRequest = { url: string; headers: Record<string, string>; body: Buffer };

/** O pereche nouă de chei VAPID (P-256). */
export function generateVapidKeys(): GcsVapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), unb64(jwk.x!), unb64(jwk.y!)]);
  return { publicKey: b64(pub), privateJwk: jwk };
}

/** Cheia publică a abonamentului e un punct P-256 necomprimat (65 de octeți), secretul are 16 octeți. */
export function validPushKeys(p256dh: string, auth: string): boolean {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(auth)) return false;
  const key = unb64(p256dh);
  return key.length === 65 && key[0] === 4 && unb64(auth).length === 16;
}

/** JWT-ul VAPID (ES256) pentru originea serviciului de push; valabil `ttlSec` (cel mult 24 de ore). */
export function vapidJwt(audience: string, subject: string, keys: GcsVapidKeys, now = new Date(), ttlSec = 12 * 3600): string {
  const header = b64(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(now.getTime() / 1000) + Math.min(ttlSec, 24 * 3600), sub: subject })));
  const data = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(data), { key: createPrivateKey({ key: keys.privateJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `${data}.${b64(signature)}`;
}

/** Mărimea unei înregistrări (RFC 8188); un mesaj push are o singură înregistrare. */
const RECORD_SIZE = 4096;

/**
 * Criptează textul pentru un abonament (RFC 8291): antetul (sarea, mărimea înregistrării, cheia publică efemeră a
 * serverului) urmat de înregistrarea criptată. `salt` și `serverKeys` se dau doar în teste (valori fixe).
 */
export function encryptPushPayload(target: Pick<GcsPushTarget, "p256dh" | "auth">, plaintext: Buffer, opts: { salt?: Buffer; serverEcdh?: ReturnType<typeof createECDH> } = {}): Buffer {
  const uaPublic = unb64(target.p256dh);
  const authSecret = unb64(target.auth);
  const ecdh = opts.serverEcdh ?? createECDH("prime256v1");
  if (!opts.serverEcdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const salt = opts.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  if (plaintext.length + 1 + 16 > RECORD_SIZE - 86) throw new Error("push_payload_too_large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // Delimitatorul 0x02 marchează ultima (singura) înregistrare.
  const record = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, record]);
}

/** Cererea completă pentru un abonament: corpul criptat, `TTL`, `Urgency`, `Topic` (opțional) și antetul VAPID. */
export function buildPushRequest(
  target: GcsPushTarget,
  payload: string,
  vapid: GcsVapidKeys & { subject: string },
  opts: { ttlSec?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string; now?: Date } = {},
): GcsPushRequest {
  const url = new URL(target.endpoint);
  const body = encryptPushPayload(target, Buffer.from(payload, "utf8"));
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    "content-encoding": "aes128gcm",
    "content-length": String(body.length),
    ttl: String(opts.ttlSec ?? 86_400),
    urgency: opts.urgency ?? "normal",
    authorization: `vapid t=${vapidJwt(url.origin, vapid.subject, vapid, opts.now)}, k=${vapid.publicKey}`,
  };
  // `Topic` înlocuiește un mesaj încă nelivrat cu același subiect (max 32 de caractere base64url).
  if (opts.topic && /^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) headers.topic = opts.topic;
  return { url: target.endpoint, headers, body };
}
