import "server-only";
import type { GcsForumExtField } from "@gcs/core";
import { services } from "./services";

/**
 * Opțiunile câmpurilor `select` cu `optionsFrom` din taburile contribuite în formularul forumului (Forum v2): aceleași
 * pentru formular (etichetele) și pentru salvare (valorile permise). O aplicație care are nevoie de altă listă (ex.
 * serverele ei) își adaugă aici sursa, după cheie.
 */
const SOURCES: Record<string, () => Promise<{ value: string; label: string }[]>> = {
  groups: async () => (await services().db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } })).map((g) => ({ value: String(g.id), label: g.name })),
  forums: async () =>
    (await services().db.forum.findMany({ where: { type: { not: "CATEGORY" } }, orderBy: { name: "asc" }, select: { id: true, name: true } })).map((f) => ({ value: String(f.id), label: f.name })),
  // Serverele de joc (aplicația Servere); lista e goală dacă nu există niciunul.
  servers: async () => (await services().db.gameServer.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } })).map((s) => ({ value: String(s.id), label: s.name })),
};

export async function forumExtOptions(fields: readonly GcsForumExtField[]): Promise<Record<string, { value: string; label: string }[]>> {
  const out: Record<string, { value: string; label: string }[]> = {};
  for (const f of fields) {
    if (f.type !== "select" || !f.optionsFrom) continue;
    const source = SOURCES[f.optionsFrom];
    out[f.key] = source ? await source() : [];
  }
  return out;
}
