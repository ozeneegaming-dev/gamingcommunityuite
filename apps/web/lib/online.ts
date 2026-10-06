import "server-only";
import { normalizePrivacy, toRef, userRefSelect, type GcsUserRef } from "@gcs/modules";
import { services } from "./services";

export type GcsOnlineView = { members: GcsUserRef[]; hidden: number; guests: number; record: { count: number; at: string } | null };

const MAX_SHOWN = 60;

/**
 * „Cine e online” (specul etapei 4 §8): membrii activi în ultimele 5 minute, cei mai recenți primii. Cei cu statusul
 * ascuns (Setări → Confidențialitate) nu apar în listă, dar sunt numărați.
 */
export async function onlineView(): Promise<GcsOnlineView> {
  const { presence, db } = services();
  const online = await presence.online();
  const rows = await db.user.findMany({ where: { id: { in: online.users } }, select: { ...userRefSelect, privacy: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const members: GcsUserRef[] = [];
  let hidden = 0;
  for (const id of online.users) {
    const row = byId.get(id);
    if (!row) continue;
    if (!normalizePrivacy(row.privacy).showOnline) hidden++;
    else if (members.length < MAX_SHOWN) members.push(toRef(row));
  }
  return {
    members,
    hidden,
    guests: online.guests,
    record: online.record ? { count: online.record.count, at: online.record.at.toISOString() } : null,
  };
}

/** „Citesc acum” la încărcarea topicului (apoi live, din evenimentul `readers`). */
export async function topicReadersView(topicId: number): Promise<{ users: GcsUserRef[]; guests: number }> {
  const { presence, db } = services();
  const readers = await presence.topicReaders(topicId);
  const rows = await db.user.findMany({ where: { id: { in: readers.users } }, select: { ...userRefSelect, privacy: true } });
  return { users: rows.filter((r) => normalizePrivacy(r.privacy).showOnline).map((r) => toRef(r)), guests: readers.guests };
}
