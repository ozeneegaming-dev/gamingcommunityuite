import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import { isIP } from "node:net";
import type { PrismaClient } from "@gcs/db";
import { GcsValidationError } from "../errors";
import { isPublicAddress } from "../net/safeFetch";
import { openSecret, sealSecret } from "../secrets";
import { buildPushRequest, generateVapidKeys, validPushKeys, type GcsPushRequest, type GcsVapidKeys } from "./webpush";

export { buildPushRequest, encryptPushPayload, generateVapidKeys, validPushKeys, vapidJwt, type GcsPushRequest, type GcsPushTarget, type GcsVapidKeys } from "./webpush";

/** Rândul intern (în `settings`, fără formular în ACP) cu cheile VAPID: publica și privata criptată (`sealSecret`). */
export const PUSH_KEYS_SETTING = "notifications.push_keys";
/** Câte dispozitive (abonamente) poate avea un membru; cel mai vechi pleacă la depășire. */
export const PUSH_MAX_DEVICES = 10;
/** După atâtea eșecuri la rând (în afară de 404 / 410, care șterg imediat), abonamentul se șterge. */
const PUSH_MAX_FAILURES = 5;
const ENDPOINT_MAX = 1024;
const SEND_TIMEOUT_MS = 10_000;

/** Ce trimite serviciul push al browserului înapoi: doar statusul contează. */
export type GcsPushSender = (req: GcsPushRequest) => Promise<{ status: number }>;

/** Conținutul unei notificări push (afișat de service worker). */
export type GcsPushPayload = { title: string; body: string; url: string; tag?: string; icon?: string };

/**
 * Un dispozitiv al membrului (Setări → Notificări → Web push). `tail` = sfârșitul adresei abonamentului, ca browserul
 * să se recunoască în listă („acest dispozitiv”); adresa întreagă nu pleacă spre pagină.
 */
export type GcsPushDevice = { id: number; host: string; tail: string; userAgent: string; createdAt: string; lastUsedAt: string | null };

type StoredKeys = { publicKey: string; privateKey: string; createdAt: string };

/** Adresa abonamentului e acceptabilă: `https`, fără user / parolă, portul 443, fără o adresă IP care nu e publică. */
export function checkPushEndpoint(raw: unknown): URL {
  if (typeof raw !== "string" || raw.length > ENDPOINT_MAX || !URL.canParse(raw)) throw new GcsValidationError({ endpoint: "invalid" });
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new GcsValidationError({ endpoint: "invalid" });
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && !isPublicAddress(host)) throw new GcsValidationError({ endpoint: "invalid" });
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) throw new GcsValidationError({ endpoint: "invalid" });
  return url;
}

/**
 * Trimiterea implicită: un POST HTTPS fără redirecturi, cu o gardă anti-SSRF la conectare (orice adresă rezolvată
 * trebuie să fie publică, deci un DNS care se schimbă nu poate trimite cererea în rețeaua internă).
 */
export const httpsPushSender: GcsPushSender = (req) =>
  new Promise((resolve, reject) => {
    const url = checkPushEndpoint(req.url);
    const lookup = ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      dnsLookup(hostname, { all: true }, (error, addresses: LookupAddress[]) => {
        if (error) return callback(error);
        if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) return callback(new Error("blocked_address"));
        if (options?.all) return callback(null, addresses);
        return callback(null, addresses[0]!.address, addresses[0]!.family);
      });
    }) as unknown as https.RequestOptions["lookup"];
    const r = https.request(url, { method: "POST", headers: req.headers, lookup, agent: false, timeout: SEND_TIMEOUT_MS }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", reject);
    r.end(req.body);
  });

/**
 * Web push (Notificări v2): cheile VAPID (generate o singură dată de worker, păstrate criptate, niciodată scrise în
 * jurnal), abonamentele pe dispozitiv ale membrilor și trimiterea. Un abonament expirat (404 / 410) se șterge.
 */
export class GcsPushService {
  private cachedPublic: { key: string | null; at: number } | null = null;

  constructor(private readonly deps: { db: PrismaClient; sender?: GcsPushSender; secret?: string }) {}

  private async stored(): Promise<StoredKeys | null> {
    const row = await this.deps.db.setting.findUnique({ where: { key: PUSH_KEYS_SETTING } });
    const v = row?.value as Partial<StoredKeys> | undefined;
    return v && typeof v.publicKey === "string" && typeof v.privateKey === "string" ? (v as StoredKeys) : null;
  }

  /**
   * Generează cheile VAPID dacă lipsesc (worker-ul, la pornire). Două procese care pornesc deodată nu se bat: prima
   * scriere câștigă (`createMany` cu `skipDuplicates`). Întoarce `true` dacă le-a creat acum.
   */
  async ensureKeys(): Promise<boolean> {
    if (await this.stored()) return false;
    const keys = generateVapidKeys();
    const value: StoredKeys = { publicKey: keys.publicKey, privateKey: sealSecret(JSON.stringify(keys.privateJwk), this.deps.secret), createdAt: new Date().toISOString() };
    const { count } = await this.deps.db.setting.createMany({ data: [{ key: PUSH_KEYS_SETTING, value }], skipDuplicates: true });
    this.cachedPublic = null;
    return count > 0;
  }

  /** Cheia publică VAPID (pentru `pushManager.subscribe`); `null` până o generează worker-ul. Ținută un minut în proces. */
  async publicKey(): Promise<string | null> {
    if (this.cachedPublic && Date.now() - this.cachedPublic.at < 60_000) return this.cachedPublic.key;
    const key = (await this.stored())?.publicKey ?? null;
    this.cachedPublic = { key, at: Date.now() };
    return key;
  }

  /** Cheile complete (doar în worker, la trimitere); `null` dacă lipsesc sau secretul aplicației s-a schimbat. */
  private async vapid(): Promise<GcsVapidKeys | null> {
    const s = await this.stored();
    if (!s) return null;
    const jwk = openSecret(s.privateKey, this.deps.secret);
    if (!jwk) return null;
    try {
      return { publicKey: s.publicKey, privateJwk: JSON.parse(jwk) as GcsVapidKeys["privateJwk"] };
    } catch {
      return null;
    }
  }

  /** Dispozitivele membrului, cele mai noi primele (fără cheile abonamentelor). */
  async devices(userId: string): Promise<GcsPushDevice[]> {
    const rows = await this.deps.db.pushSubscription.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return rows.map((r) => ({
      id: r.id,
      host: URL.canParse(r.endpoint) ? new URL(r.endpoint).host : "",
      tail: r.endpoint.slice(-16),
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Salvează abonamentul unui browser pentru membru (același browser abonat din nou → același rând; un browser trecut
   * pe alt cont → al noului cont). Peste `PUSH_MAX_DEVICES`, cel mai vechi dispozitiv pleacă.
   */
  async subscribe(userId: string, input: { endpoint: unknown; p256dh: unknown; auth: unknown; userAgent?: unknown }): Promise<{ id: number }> {
    const endpoint = checkPushEndpoint(input.endpoint).toString();
    if (typeof input.p256dh !== "string" || typeof input.auth !== "string" || !validPushKeys(input.p256dh, input.auth)) throw new GcsValidationError({ keys: "invalid" });
    const userAgent = typeof input.userAgent === "string" ? input.userAgent.slice(0, 300) : "";
    const data = { userId, p256dh: input.p256dh, auth: input.auth, userAgent, failures: 0 };
    const row = await this.deps.db.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, ...data }, update: data, select: { id: true } });
    const all = await this.deps.db.pushSubscription.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    const extra = all.slice(PUSH_MAX_DEVICES).map((r) => r.id);
    if (extra.length > 0) await this.deps.db.pushSubscription.deleteMany({ where: { id: { in: extra } } });
    return row;
  }

  /** Scoate un dispozitiv al membrului (după id sau după adresa abonamentului). Întoarce dacă a existat. */
  async unsubscribe(userId: string, which: { id?: number; endpoint?: string }): Promise<boolean> {
    if (which.id === undefined && !which.endpoint) return false;
    const { count } = await this.deps.db.pushSubscription.deleteMany({ where: { userId, ...(which.id !== undefined ? { id: which.id } : { endpoint: which.endpoint! }) } });
    return count > 0;
  }

  /**
   * Trimite un mesaj pe toate dispozitivele membrului. 404 / 410 → abonamentul a expirat și se șterge; alte erori cresc
   * numărul de eșecuri (peste prag, abonamentul se șterge). Întoarce câte au primit mesajul.
   */
  async sendToUser(userId: string, payload: GcsPushPayload, opts: { subject: string; urgency?: "normal" | "high" } ): Promise<{ sent: number; removed: number }> {
    const subs = await this.deps.db.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return { sent: 0, removed: 0 };
    const vapid = await this.vapid();
    if (!vapid) return { sent: 0, removed: 0 };
    const sender = this.deps.sender ?? httpsPushSender;
    const body = JSON.stringify(payload).slice(0, 3_500);
    let sent = 0;
    let removed = 0;
    for (const s of subs) {
      let status = 0;
      try {
        const req = buildPushRequest({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, body, { ...vapid, subject: opts.subject }, { urgency: opts.urgency ?? "normal", ...(payload.tag ? { topic: payload.tag } : {}) });
        status = (await sender(req)).status;
      } catch {
        status = 0;
      }
      if (status >= 200 && status < 300) {
        sent++;
        await this.deps.db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date(), failures: 0 } });
      } else if (status === 404 || status === 410 || s.failures + 1 >= PUSH_MAX_FAILURES) {
        removed++;
        await this.deps.db.pushSubscription.deleteMany({ where: { id: s.id } });
      } else {
        await this.deps.db.pushSubscription.update({ where: { id: s.id }, data: { failures: { increment: 1 } } });
      }
    }
    return { sent, removed };
  }
}
