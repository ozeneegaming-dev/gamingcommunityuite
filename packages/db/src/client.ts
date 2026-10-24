import { createRequire } from "node:module";
import { Prisma, PrismaClient } from "@prisma/client";
import { gcsDbDialect } from "./json";

/**
 * Clientul Prisma pentru URL-ul dat: PostgreSQL (clientul obișnuit, `@prisma/client`) sau MySQL / MariaDB (clientul
 * generat din `prisma/mysql/schema.prisma` în `generated/mysql-client`, ediția Lite). API-ul e același; tipul întors
 * e cel PostgreSQL, ca serviciile să nu știe ce bază au sub ele (diferențele de dialect stau în `ci()`, `sql` și
 * `GcsSearchBackend`).
 */
export function createPrismaClient(databaseUrl: string | undefined = process.env.DATABASE_URL): PrismaClient {
  const opts: { datasourceUrl?: string } = databaseUrl ? { datasourceUrl: databaseUrl } : {};
  if (gcsDbDialect(databaseUrl) !== "mysql") return databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : new PrismaClient();
  // Încărcat doar când e nevoie: ediția VPS nu are (și nu cere) clientul MySQL.
  const require = createRequire(import.meta.url);
  const mysql = require("../generated/mysql-client") as { PrismaClient: new (o: typeof opts) => PrismaClient; Prisma: Record<string, unknown> };
  linkErrorClasses(mysql.Prisma);
  const nativeSql = mysql.Prisma.sql as (strings: readonly string[], ...values: unknown[]) => unknown;
  return withMysqlRaw(new mysql.PrismaClient(opts), nativeSql);
}

type RawPromise = Promise<unknown> & { then: Promise<unknown>["then"] };

/**
 * Clientul MySQL în fața codului scris pentru clientul PostgreSQL (și în tranzacții, `tx`, și în clienții `$extends`):
 * - fragmentele `Prisma.sql` / `sql` sunt obiecte `Sql` ale clientului PostgreSQL, pe care runtime-ul MySQL nu le
 *   recunoaște (le-ar trimite ca parametri sau ar pierde textul): se refac ca `Sql` MySQL, cu același text și aceleași
 *   valori (și forma de șablon, `` db.$queryRaw`… ${fragment}` ``, se compune întâi);
 * - interogările brute scrise pentru PostgreSQL convertesc numerele cu `::int`; pe MySQL `COUNT(*)` & co. vin ca
 *   `BIGINT` (BigInt în JS): întregii care încap devin numere, ca în PostgreSQL.
 */
function withMysqlRaw<T extends object>(client: T, nativeSql: (strings: readonly string[], ...values: unknown[]) => unknown): T {
  const toNative = (args: unknown[]): unknown[] => {
    const pg = isTemplate(args[0]) ? Prisma.sql(args[0], ...args.slice(1)) : isSql(args[0]) ? args[0] : null;
    return pg ? [nativeSql(pg.strings, ...pg.values)] : args;
  };
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "$queryRaw" || prop === "$executeRaw") {
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => RawPromise).apply(target, toNative(args));
          if (prop === "$queryRaw") {
            // Promisiunea Prisma rămâne aceeași (merge și în `$transaction([…])`); doar rezultatul citit e normalizat.
            const then = result.then.bind(result);
            result.then = ((ok?: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => then((v) => (ok ? ok(normalizeRaw(v)) : normalizeRaw(v)), fail)) as RawPromise["then"];
          }
          return result;
        };
      }
      if (prop === "$queryRawUnsafe") {
        return (...args: unknown[]) => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args).then(normalizeRaw);
      }
      if (prop === "$transaction") {
        return (arg: unknown, ...rest: unknown[]) =>
          (value as (...a: unknown[]) => unknown).call(target, typeof arg === "function" ? (tx: object) => (arg as (t: object) => unknown)(withMysqlRaw(tx, nativeSql)) : arg, ...rest);
      }
      if (prop === "$extends") {
        return (...args: unknown[]) => withMysqlRaw((value as (...a: unknown[]) => object).apply(target, args), nativeSql);
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/** Un obiect `Sql` (al oricărui client Prisma): textul pe bucăți și valorile, deja aplatizate. */
function isSql(arg: unknown): arg is { strings: string[]; values: unknown[] } {
  return typeof arg === "object" && arg !== null && Array.isArray((arg as { strings?: unknown }).strings) && Array.isArray((arg as { values?: unknown }).values);
}

function isTemplate(arg: unknown): arg is TemplateStringsArray {
  return Array.isArray(arg) && Array.isArray((arg as unknown as { raw?: unknown }).raw);
}

function normalizeRaw(result: unknown): unknown {
  if (!Array.isArray(result)) return result;
  for (const row of result) {
    if (!row || typeof row !== "object") continue;
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (typeof v === "bigint" && v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)) (row as Record<string, unknown>)[k] = Number(v);
    }
  }
  return result;
}

const ERROR_CLASSES = ["PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientValidationError", "PrismaClientInitializationError", "PrismaClientRustPanicError"] as const;
let linked = false;

/**
 * Erorile clientului MySQL sunt alte clase decât ale clientului PostgreSQL: le legăm prototipurile, ca verificările
 * `error instanceof Prisma.PrismaClientKnownRequestError` (codul `P2002` etc.) să meargă la fel pe ambele baze.
 */
function linkErrorClasses(mysqlPrisma: Record<string, unknown>): void {
  if (linked) return;
  linked = true;
  const pg = Prisma as unknown as Record<string, unknown>;
  for (const name of ERROR_CLASSES) {
    const from = mysqlPrisma[name] as { prototype: object } | undefined;
    const to = pg[name] as { prototype: object } | undefined;
    if (from && to && from !== to) Object.setPrototypeOf(from.prototype, to.prototype);
  }
  // `Prisma.DbNull` / `JsonNull` / `AnyNull`: clientul MySQL recunoaște doar instanțele lui; într-un proces MySQL
  // (clientul PostgreSQL nu se folosește) constantele din spațiul comun `Prisma` devin ale lui.
  for (const name of ["DbNull", "JsonNull", "AnyNull", "NullTypes"]) {
    if (name in mysqlPrisma) {
      try {
        Object.defineProperty(pg, name, { value: mysqlPrisma[name], configurable: true, writable: true, enumerable: true });
      } catch {
        // Spațiu înghețat: rămâne valoarea PostgreSQL.
      }
    }
  }
}

// Un singur client pe proces (în dev, Next.js reîncarcă modulele; fără asta s-ar deschide conexiuni noi la fiecare reload).
const globalForDb = globalThis as unknown as { gcsDb?: PrismaClient };

export const db: PrismaClient = globalForDb.gcsDb ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.gcsDb = db;
}
