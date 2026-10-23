import { EventEmitter } from "node:events";
import type { PrismaClient } from "@gcs/db";
import type Redis from "ioredis";
import { REALTIME_CHANNEL, type GcsRealtimeMessage } from "./publish";

/** Un mesaj din jurnal, cu cursorul lui (opac: id-ul rândului în SQL, id-ul din stream în Redis). */
export type GcsRealtimeEnvelope = GcsRealtimeMessage & { id: string };
export type GcsRealtimeRead = { events: GcsRealtimeEnvelope[]; cursor: string; reset: boolean };

/** Cât trăiesc mesajele în jurnal: o conexiune SSE / polling care lipsește mai mult primește `reset` (resync). */
export const REALTIME_RETAIN_MS = 5 * 60_000;
const READ_LIMIT = 200;

/**
 * Jurnalul live: unde ajung mesajele publicate și de unde le citesc transporturile de rezervă (SSE, polling).
 * Websocket-ul (`gcs-realtime`, doar VPS) le primește direct, pe canalul Redis.
 */
export interface GcsRealtimeLog {
  append(msg: GcsRealtimeMessage): Promise<void>;
  /** Cursorul ultimului mesaj (o conexiune nouă pornește de aici, fără istoric). */
  head(): Promise<string>;
  /**
   * Mesajele de după `cursor` din camerele date (`null` = toate; în ordine); `reset` = au fost pierdute mesaje (cursor
   * prea vechi).
   */
  read(cursor: string, rooms: ReadonlySet<string> | null, limit?: number): Promise<GcsRealtimeRead>;
  /** Anunță în același proces că a apărut un mesaj (SSE se trezește imediat). Întoarce dezabonarea. */
  onAppend(fn: () => void): () => void;
  /** Șterge mesajele mai vechi decât `REALTIME_RETAIN_MS`. */
  prune(now?: number): Promise<number>;
  readonly driver: "redis" | "sql";
}

class LocalSignal {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  on(fn: () => void): () => void {
    this.emitter.on("append", fn);
    return () => void this.emitter.off("append", fn);
  }

  emit(): void {
    this.emitter.emit("append");
  }
}

/** Ediția Lite: tabelul `gcs_realtime_events` (id crescător). */
export class GcsSqlRealtimeLog implements GcsRealtimeLog {
  readonly driver = "sql" as const;
  private readonly signal = new LocalSignal();

  constructor(
    private readonly db: PrismaClient,
    private readonly now: () => number = Date.now,
  ) {}

  async append(msg: GcsRealtimeMessage): Promise<void> {
    await this.db.gcsRealtimeEvent.create({
      data: { room: msg.room, event: msg.event, data: JSON.stringify(msg.data ?? null), origin: msg.origin ?? null, createdAt: BigInt(this.now()) },
    });
    this.signal.emit();
  }

  async head(): Promise<string> {
    const last = await this.db.gcsRealtimeEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    return String(last?.id ?? 0n);
  }

  async read(cursor: string, rooms: ReadonlySet<string> | null, limit = READ_LIMIT): Promise<GcsRealtimeRead> {
    const since = /^\d+$/.test(cursor) ? BigInt(cursor) : 0n;
    // Capătul se citește primul: rândurile scrise după el rămân pentru citirea următoare (nu se sar).
    const head = BigInt(await this.head());
    const [oldest, rows] = await Promise.all([
      this.db.gcsRealtimeEvent.findFirst({ orderBy: { id: "asc" }, select: { id: true } }),
      rooms?.size === 0 || head <= since
        ? Promise.resolve([])
        : this.db.gcsRealtimeEvent.findMany({ where: { id: { gt: since, lte: head }, ...(rooms ? { room: { in: [...rooms] } } : {}) }, orderBy: { id: "asc" }, take: limit }),
    ]);
    // Curățenia păstrează mereu ultimul mesaj, deci un gol înaintea celui mai vechi rând înseamnă mesaje șterse.
    const reset = since > 0n && oldest !== null && oldest.id > since + 1n;
    const events = rows.map((r) => ({ id: String(r.id), room: r.room, event: r.event, data: JSON.parse(r.data) as unknown, ...(r.origin ? { origin: r.origin } : {}) }));
    // Fără mesaje în camerele cerute, cursorul sare la capăt (altfel ar reciti mereu aceleași rânduri ale altor camere).
    const next = rows.length === limit ? events.at(-1)!.id : String(head > since ? head : since);
    return { events, cursor: next, reset };
  }

  onAppend(fn: () => void): () => void {
    return this.signal.on(fn);
  }

  async prune(now = this.now()): Promise<number> {
    const last = await this.db.gcsRealtimeEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    if (!last) return 0;
    const { count } = await this.db.gcsRealtimeEvent.deleteMany({ where: { createdAt: { lt: BigInt(now - REALTIME_RETAIN_MS) }, id: { lt: last.id } } });
    return count;
  }
}

const STREAM_KEY = "gcs:rt:log";
const STREAM_MAXLEN = 5000;

function streamIdLess(a: string, b: string): boolean {
  const [am = 0, as = 0] = a.split("-").map(Number);
  const [bm = 0, bs = 0] = b.split("-").map(Number);
  return am < bm || (am === bm && as < bs);
}

/**
 * Ediția VPS: `PUBLISH` pe `gcs:rt` (pentru `gcs-realtime`) plus un Redis Stream scurt (ultimele ~5000 de mesaje),
 * din care citesc clienții care nu pot folosi websocket-ul.
 */
export class GcsRedisRealtimeLog implements GcsRealtimeLog {
  readonly driver = "redis" as const;
  private readonly signal = new LocalSignal();

  constructor(private readonly redis: Redis) {}

  async append(msg: GcsRealtimeMessage): Promise<void> {
    const payload = JSON.stringify(msg);
    await this.redis
      .multi()
      .publish(REALTIME_CHANNEL, payload)
      .xadd(STREAM_KEY, "MAXLEN", "~", STREAM_MAXLEN, "*", "m", payload)
      .exec();
    this.signal.emit();
  }

  async head(): Promise<string> {
    const [last] = await this.redis.xrevrange(STREAM_KEY, "+", "-", "COUNT", 1);
    return last?.[0] ?? "0-0";
  }

  async read(cursor: string, rooms: ReadonlySet<string> | null, limit = READ_LIMIT): Promise<GcsRealtimeRead> {
    const since = /^\d+-\d+$/.test(cursor) ? cursor : "0-0";
    const [first] = await this.redis.xrange(STREAM_KEY, "-", "+", "COUNT", 1);
    const reset = since !== "0-0" && first !== undefined && streamIdLess(since, first[0]) && since !== first[0];
    const batch = await this.redis.xrange(STREAM_KEY, `(${since}`, "+", "COUNT", limit * 5);
    const events: GcsRealtimeEnvelope[] = [];
    for (const [id, fields] of batch) {
      const raw = fields[1];
      if (!raw) continue;
      try {
        const m = JSON.parse(raw) as GcsRealtimeMessage;
        if (!rooms || rooms.has(m.room)) events.push({ ...m, id });
      } catch {
        // Un mesaj stricat se sare.
      }
      if (events.length >= limit) return { events, cursor: id, reset };
    }
    return { events, cursor: batch.at(-1)?.[0] ?? since, reset };
  }

  onAppend(fn: () => void): () => void {
    return this.signal.on(fn);
  }

  async prune(): Promise<number> {
    // `MAXLEN` ține stream-ul scurt la fiecare `XADD`.
    return 0;
  }
}
