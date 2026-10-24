/**
 * Listele din coloanele `Json` (fostele `text[]` / `integer[]`, portabile și pe MySQL): citirea sigură și filtrele
 * Prisma echivalente cu `has` / `hasSome` / `isEmpty` ale listelor scalare.
 */

/** Lista de numere întregi dintr-o coloană `Json` (orice altceva → `[]`). */
export function jsonInts(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number" && Number.isInteger(v)) : [];
}

/** Lista de texte dintr-o coloană `Json` (orice altceva → `[]`). */
export function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Filtrul „lista conține valoarea” (fostul `has`). */
export function jsonHas(value: string | number): { array_contains: (string | number)[] } {
  return { array_contains: [value] };
}

/** Filtrul „lista e goală” (fostul `isEmpty: true`). */
export const JSON_EMPTY_LIST = { equals: [] as never[] };

/** Dialectul bazei de date a procesului, după `DATABASE_URL` (`mysql://` = MySQL / MariaDB, altfel PostgreSQL). */
export type GcsDbDialect = "postgresql" | "mysql";

export function gcsDbDialect(url: string | undefined = process.env.DATABASE_URL): GcsDbDialect {
  return url?.startsWith("mysql://") || url?.startsWith("mariadb://") ? "mysql" : "postgresql";
}

/**
 * Un filtru de text fără diferență între majuscule și minuscule: pe PostgreSQL cu `mode: "insensitive"`; pe MySQL
 * colația coloanelor (`utf8mb4_unicode_ci`) face deja comparația așa, iar Prisma nu acceptă `mode`.
 */
export function ci<T extends { contains?: string; equals?: string; startsWith?: string }>(filter: T): T & { mode?: "insensitive" } {
  return gcsDbDialect() === "mysql" ? filter : { ...filter, mode: "insensitive" as const };
}
