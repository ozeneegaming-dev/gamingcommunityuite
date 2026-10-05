// @gcs/db — schema Prisma, migrații și clientul DB.
export { db } from "./client";
// Exporturi explicite: `export *` dintr-un modul CommonJS extern produce un avertisment în build-ul Next.js.
export { BanType, Prisma, PrismaClient, WarningActionType } from "@prisma/client";
export type * from "@prisma/client";
