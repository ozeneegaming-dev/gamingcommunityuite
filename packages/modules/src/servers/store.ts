import type Redis from "ioredis";
import type { GcsServerStatus } from "./types";

const STATUS = (id: number) => `gcs:servers:status:${id}`;
const NEXT = "gcs:servers:next";
const FAILS = "gcs:servers:fails";
const LOCK = "gcs:servers:poll-lock";
/** Statusul expiră după o zi: un worker oprit nu lasă pe site un „online” vechi pentru totdeauna. */
const STATUS_TTL = 86_400;

/** Eliberarea lacătului doar de către cel care l-a luat. */
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

/**
 * Starea aplicației Servere din Redis (specul 2026-10-07-servere §3.4): ultimul status al fiecărui server, programarea
 * interogărilor (următoarea oră și eșecurile la rând) și lacătul rundei.
 */
export class GcsServerStatusStore {
  constructor(private readonly redis: Redis) {}

  async get(id: number): Promise<GcsServerStatus | null> {
    return (await this.many([id])).get(id) ?? null;
  }

  async many(ids: number[]): Promise<Map<number, GcsServerStatus>> {
    const out = new Map<number, GcsServerStatus>();
    if (ids.length === 0) return out;
    const raw = await this.redis.mget(...ids.map(STATUS));
    raw.forEach((value, i) => {
      if (!value) return;
      try {
        out.set(ids[i]!, JSON.parse(value) as GcsServerStatus);
      } catch {
        // O valoare stricată contează ca lipsă.
      }
    });
    return out;
  }

  /** Salvează statusul și programarea următoarei interogări. */
  async save(id: number, status: GcsServerStatus, schedule: { nextAt: number; failures: number }): Promise<void> {
    await this.redis
      .multi()
      .set(STATUS(id), JSON.stringify(status), "EX", STATUS_TTL)
      .hset(NEXT, String(id), String(schedule.nextAt))
      .hset(FAILS, String(id), String(schedule.failures))
      .exec();
  }

  async schedule(): Promise<{ next: Map<number, number>; failures: Map<number, number> }> {
    const [next, fails] = await Promise.all([this.redis.hgetall(NEXT), this.redis.hgetall(FAILS)]);
    const toMap = (h: Record<string, string>) => new Map(Object.entries(h).map(([k, v]) => [Number(k), Number(v)]));
    return { next: toMap(next), failures: toMap(fails) };
  }

  /**
   * Rezervă serverele unei runde: până la `until` nu mai sunt scadente, deci o rundă care începe cât timp aceasta încă
   * rulează (ex. multe servere căzute, fiecare cu termenul de 5 s) nu le interoghează a doua oară.
   */
  async claim(ids: number[], until: number): Promise<void> {
    if (ids.length === 0) return;
    await this.redis.hset(NEXT, Object.fromEntries(ids.map((id) => [String(id), String(until)])));
  }

  /** Serverul se interoghează la runda următoare (ex. adresa s-a schimbat în ACP); statusul vechi dispare. */
  async reset(id: number, opts: { keepStatus?: boolean } = {}): Promise<void> {
    const multi = this.redis.multi().hdel(NEXT, String(id)).hdel(FAILS, String(id));
    if (!opts.keepStatus) multi.del(STATUS(id));
    await multi.exec();
  }

  /** Curăță programarea și statusul serverelor care nu mai există (sau nu mai sunt active). */
  async prune(keep: Set<number>): Promise<void> {
    const { next } = await this.schedule();
    const gone = [...next.keys()].filter((id) => !keep.has(id));
    if (gone.length === 0) return;
    await this.redis
      .multi()
      .hdel(NEXT, ...gone.map(String))
      .hdel(FAILS, ...gone.map(String))
      .del(...gone.map(STATUS))
      .exec();
  }

  async lock(token: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(LOCK, token, "PX", ttlMs, "NX")) === "OK";
  }

  async unlock(token: string): Promise<void> {
    await this.redis.eval(RELEASE, 1, LOCK, token);
  }
}
