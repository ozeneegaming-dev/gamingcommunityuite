import { PrismaClient } from "@prisma/client";

// Un singur client pe proces (în dev, Next.js reîncarcă modulele; fără asta s-ar deschide conexiuni noi la fiecare reload).
const globalForDb = globalThis as unknown as { gcsDb?: PrismaClient };

export const db: PrismaClient = globalForDb.gcsDb ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.gcsDb = db;
}
