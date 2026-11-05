import { openSecret } from "@gcs/core";
import type { GcsServerAuth } from "./query";

/** Contul de interogare salvat (decriptat) al unui server, pentru worker și „Verifică”; `null` fără cont. */
export function serverAuth(row: { queryMode: string; queryUser: string; querySecret: string | null }): GcsServerAuth | null {
  const secret = row.querySecret ? openSecret(row.querySecret) : null;
  if (!row.queryUser && !secret) return null;
  return { mode: row.queryMode === "http" ? "http" : "raw", user: row.queryUser, secret: secret ?? "" };
}
