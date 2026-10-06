import type { GcsImportSchema, GcsSourceAdapter } from "../types";
import { GcsCoreSchemaAdapter } from "./coreSchema";
import { GcsPrefixedSchemaAdapter } from "./prefixedSchema";
import type { GcsSourceReader } from "./reader";

export type GcsDetectedSchema = { schema: GcsImportSchema; prefix: string };

/** Prefixele candidate, cu prefixul dat de admin primul. */
function candidates(tables: string[], suffix: string, hint: string): string[] {
  const found = tables.filter((t) => t.toLowerCase().endsWith(suffix)).map((t) => t.slice(0, t.length - suffix.length));
  return [...new Set([...found.filter((p) => p.toLowerCase() === hint.toLowerCase()), ...found])];
}

/**
 * Recunoaște schema bazei vechi după tabele:
 * - `core-schema`: `<prefix>core_members` + `<prefix>forums_topics` + `<prefix>forums_posts`;
 * - `prefixed-schema`: `<prefix>user` + `<prefix>user_group` + `<prefix>node` + `<prefix>thread` + `<prefix>post`.
 * `null` dacă nu se potrivește niciuna.
 */
export async function detectSchema(reader: GcsSourceReader, prefixHint = ""): Promise<GcsDetectedSchema | null> {
  const tables = await reader.tables();
  const lower = new Set(tables.map((t) => t.toLowerCase()));
  const has = (name: string) => lower.has(name.toLowerCase());
  for (const p of candidates(tables, "core_members", prefixHint)) {
    if (has(`${p}forums_topics`) && has(`${p}forums_posts`)) return { schema: "core-schema", prefix: p };
  }
  for (const p of candidates(tables, "thread", prefixHint)) {
    if (p && ["user", "user_group", "node", "post"].every((t) => has(`${p}${t}`))) return { schema: "prefixed-schema", prefix: p };
  }
  return null;
}

/**
 * Versiunile suportate (specul modulului, §2, implicit): `core-schema` 4.4–4.7 și 5.x, `prefixed-schema` 2.1–2.3.
 * Celelalte se actualizează întâi pe platforma veche.
 */
export function isSupportedVersion(schema: GcsImportSchema, version: string): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (schema === "core-schema") return (major === 4 && minor >= 4) || major === 5;
  return major === 2 && minor >= 1 && minor <= 3;
}

export function createAdapter(reader: GcsSourceReader, detected: GcsDetectedSchema): GcsSourceAdapter {
  return detected.schema === "core-schema" ? new GcsCoreSchemaAdapter(reader, detected.prefix) : new GcsPrefixedSchemaAdapter(reader, detected.prefix);
}
