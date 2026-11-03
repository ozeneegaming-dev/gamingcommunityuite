import { randomBytes } from "node:crypto";
import type { GcsActor, GcsSettingsService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { SEO_SETTINGS } from "./settings";

/** Jobul IndexNow (worker-ul VPS sau coada SQL a ediției Lite): la 10 minute, un singur lot pe rulare. */
export const INDEXNOW_JOB = "seo.indexnow";
export const INDEXNOW_EVERY_MS = 10 * 60_000;
/** API-ul public IndexNow (îl împart motoarele care folosesc protocolul). */
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** Câte adrese are o cerere (limita protocolului: 10 000). */
export const INDEXNOW_BATCH = 10_000;
/** Starea jobului (cursorul, reîncercarea, ultimul rezultat): un rând intern din `settings`, fără definiție în ACP. */
export const INDEXNOW_STATE_KEY = "seo.indexnow_state";
/** Cel mult atâta istoric se trimite (ex. după ce IndexNow a fost oprit o vreme). */
const MAX_LOOKBACK_MS = 48 * 3_600_000;
const MINUTE = 60_000;

export type GcsIndexNowState = {
  /** Activitatea trimisă până la (ISO); topicurile cu ultima postare după el pleacă la următoarea rulare. */
  cursor: string | null;
  /** Nu se trimite nimic înainte (după 429, 403 sau o eroare de rețea). */
  retryAt: string | null;
  failures: number;
  lastRunAt: string | null;
  /** Codul HTTP al ultimei cereri (0 = eroare de rețea). */
  lastStatus: number | null;
  lastSent: number;
  lastSentAt: string | null;
  lastError: string | null;
};

const EMPTY: GcsIndexNowState = { cursor: null, retryAt: null, failures: 0, lastRunAt: null, lastStatus: null, lastSent: 0, lastSentAt: null, lastError: null };

export type GcsIndexNowResult =
  | { sent: number; status: number }
  | { sent: 0; skipped: "disabled" | "local_site" | "backoff" | "nothing" }
  | { sent: 0; status: number; error: string };

/** O cheie nouă: 32 de caractere hexazecimale (protocolul cere 8–128 de litere, cifre sau `-`). */
export const newIndexNowKey = () => randomBytes(16).toString("hex");

/** Un site care nu poate fi verificat de IndexNow (fără nume public): localhost, `.local`, `.test`, IP-uri. */
export function isLocalSite(base: string): boolean {
  if (!URL.canParse(base)) return true;
  const host = new URL(base).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".test") || /^[\d.]+$/.test(host) || host.includes(":");
}

/** Cât se așteaptă după a `n`-a eșuare: 429 (după `Retry-After`, minim o oră), 403 (6 ore), restul exponențial. */
export function indexNowBackoffMs(status: number, failures: number, retryAfterSec: number | null): number {
  if (status === 429) return Math.max(retryAfterSec ?? 0, 3600, Math.min(2 ** Math.max(0, failures - 1), 24) * 3600) * 1000;
  if (status === 403) return 6 * 3_600_000;
  return Math.min(5 * MINUTE * 2 ** Math.max(0, failures - 1), 6 * 3_600_000);
}

const SYSTEM_ACTOR: GcsActor = { userId: null, groupIds: [], primaryGroupId: 0, isBanned: false, ip: "" };

type Deps = {
  db: PrismaClient;
  settings: Pick<GcsSettingsService, "get" | "set">;
  /** Adresa publică a site-ului (fără `/` la final). */
  siteUrl: () => Promise<string>;
  /** Topicurile publice cu activitate după o dată (create sau cu răspunsuri noi), cele mai vechi primele. */
  changedTopics: (since: Date, limit: number) => Promise<{ path: string; at: Date }[]>;
  fetch?: typeof fetch;
  /** Câte adrese pleacă într-o cerere (testele folosesc loturi mici); implicit `INDEXNOW_BATCH`. */
  batch?: number;
};

/**
 * IndexNow (ACP → Promovare → SEO): anunță motoarele de căutare despre topicurile publice noi sau cu răspunsuri noi.
 * Jobul rulează la 10 minute (modificările dintr-un interval pleacă împreună: un topic cu 20 de răspunsuri = o adresă),
 * trimite cel mult un lot pe rulare și respectă limitele: după 429 așteaptă (`Retry-After`, minim o oră), după o eroare
 * de rețea sau 5xx reîncearcă exponențial, fără să piardă cursorul. Cheia e servită la `/<cheie>.txt`.
 */
export class GcsIndexNowService {
  constructor(private readonly deps: Deps) {}

  async enabled(): Promise<boolean> {
    return (await this.deps.settings.get<boolean>(SEO_SETTINGS.indexNowEnabled).catch(() => false)) === true;
  }

  /** Cheia de acum (o generează la prima cerere). */
  async key(): Promise<string> {
    const current = await this.deps.settings.get<string>(SEO_SETTINGS.indexNowKey);
    if (typeof current === "string" && /^[a-f0-9]{32}$/.test(current)) return current;
    const key = newIndexNowKey();
    await this.deps.settings.set(SEO_SETTINGS.indexNowKey, key, SYSTEM_ACTOR);
    return key;
  }

  /** O cheie nouă (ex. dacă cea veche a fost folosită de altcineva); cea veche nu mai e servită. */
  async regenerateKey(actor: GcsActor): Promise<string> {
    const key = newIndexNowKey();
    await this.deps.settings.set(SEO_SETTINGS.indexNowKey, key, actor);
    return key;
  }

  /** Cheia, doar dacă e cea salvată (ruta `/<cheie>.txt`); `null` = 404. */
  async servedKey(requested: string): Promise<string | null> {
    const current = await this.deps.settings.get<string>(SEO_SETTINGS.indexNowKey).catch(() => "");
    return typeof current === "string" && current !== "" && current === requested ? current : null;
  }

  async state(): Promise<GcsIndexNowState> {
    const row = await this.deps.db.setting.findUnique({ where: { key: INDEXNOW_STATE_KEY } });
    const v = row?.value;
    return v && typeof v === "object" && !Array.isArray(v) ? { ...EMPTY, ...(v as Partial<GcsIndexNowState>) } : { ...EMPTY };
  }

  private async save(state: GcsIndexNowState): Promise<void> {
    const value = state as unknown as Prisma.InputJsonValue;
    await this.deps.db.setting.upsert({ where: { key: INDEXNOW_STATE_KEY }, create: { key: INDEXNOW_STATE_KEY, value }, update: { value } });
  }

  /** Pornirea din ACP: istoricul de dinainte nu se trimite (doar ce apare de acum). */
  async markStart(now = new Date()): Promise<void> {
    await this.save({ ...(await this.state()), cursor: now.toISOString(), retryAt: null, failures: 0 });
  }

  /** O rulare a jobului. */
  async run(now = new Date()): Promise<GcsIndexNowResult> {
    if (!(await this.enabled())) return { sent: 0, skipped: "disabled" };
    const base = (await this.deps.siteUrl()).replace(/\/+$/, "");
    if (isLocalSite(base)) return { sent: 0, skipped: "local_site" };
    const state = await this.state();
    if (state.retryAt && new Date(state.retryAt).getTime() > now.getTime()) return { sent: 0, skipped: "backoff" };

    const floor = now.getTime() - MAX_LOOKBACK_MS;
    const cursor = state.cursor ? Math.max(new Date(state.cursor).getTime(), floor) : now.getTime() - INDEXNOW_EVERY_MS;
    const topics = await this.deps.changedTopics(new Date(cursor), this.deps.batch ?? INDEXNOW_BATCH);
    if (topics.length === 0) return { sent: 0, skipped: "nothing" };

    const key = await this.key();
    const host = new URL(base).host;
    const body = { host, key, keyLocation: `${base}/${key}.txt`, urlList: topics.map((t) => `${base}${t.path}`) };
    let status = 0;
    let retryAfter: number | null = null;
    let error: string | null = null;
    try {
      const res = await (this.deps.fetch ?? fetch)(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status;
      const ra = Number(res.headers.get("retry-after"));
      retryAfter = Number.isFinite(ra) && ra > 0 ? ra : null;
      if (status !== 200 && status !== 202) error = `http_${status}`;
    } catch (e) {
      error = e instanceof Error ? e.name : "network";
    }

    const base_ = { ...state, lastRunAt: now.toISOString(), lastStatus: status };
    const last = topics[topics.length - 1]!.at.toISOString();
    if (!error) {
      await this.save({ ...base_, cursor: last, retryAt: null, failures: 0, lastSent: topics.length, lastSentAt: now.toISOString(), lastError: null });
      return { sent: topics.length, status };
    }
    // 400 / 422 (adresele nu sunt ale site-ului etc.): lotul e respins definitiv, se trece mai departe.
    const rejected = status >= 400 && status < 500 && status !== 403 && status !== 429;
    const failures = rejected ? 0 : state.failures + 1;
    await this.save({
      ...base_,
      cursor: rejected ? last : state.cursor ?? new Date(cursor).toISOString(),
      failures,
      retryAt: rejected ? null : new Date(now.getTime() + indexNowBackoffMs(status, failures, retryAfter)).toISOString(),
      lastError: error,
    });
    return { sent: 0, status, error };
  }
}
