import { testDb } from "@gcs/db/test/helpers";
import { GcsRedisRealtimeLog, GcsSqlRealtimeLog, type GcsRealtimeLog } from "../src/realtime/log";
import type { GcsRealtimeMessage } from "../src/realtime/publish";
import { testKvDriver } from "./kv";
import { testRedis } from "./redis";

let log: GcsRealtimeLog | undefined;

/** Jurnalul live al worker-ului de test, pe driverul ales (`GCS_EDITION=lite` = SQL). */
export function testRealtimeLog(): GcsRealtimeLog {
  log ??= testKvDriver() === "sql" ? new GcsSqlRealtimeLog(testDb()) : new GcsRedisRealtimeLog(testRedis());
  return log;
}

/**
 * Ce s-a publicat live după `start()`, citit din jurnal (merge pe ambele drivere, fără abonare la Redis).
 * `messages()` citește tot ce a apărut de la pornire (sau de la ultimul `start()`).
 */
export function recordRealtime(source: GcsRealtimeLog = testRealtimeLog()) {
  let cursor = "";
  return {
    async start(): Promise<void> {
      cursor = await source.head();
    },
    async messages(rooms?: string[]): Promise<GcsRealtimeMessage[]> {
      const out: GcsRealtimeMessage[] = [];
      const all = rooms ? new Set(rooms) : null;
      let at = cursor;
      for (let i = 0; i < 50; i++) {
        const read = await source.read(at, all);
        out.push(...read.events.map(({ room, event, data }) => ({ room, event, data })));
        if (read.cursor === at || read.events.length === 0) break;
        at = read.cursor;
      }
      return out;
    },
  };
}

