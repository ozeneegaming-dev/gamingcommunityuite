import {
  mentionIndex,
  mentionTokens,
  normalizeUsername,
  TEXT_MENTION_MAX,
  type GcsActor,
  type GcsGroupMentionService,
  type GcsMentionHint,
  type GcsTextMention,
} from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

/**
 * Mențiunile din textul simplu, hotărâte pe server (chat-ul, statusurile și comentariile de pe profil, câmpurile fără
 * editor): sugestiile alese în compozitor (id-urile trimise ca indicii) rămân mențiuni cât timp `@Nume` e încă în text
 * (numele cu spațiu merg doar așa); un `@cuvânt` scris de mână devine mențiune dacă e exact numele unui membru. Grupurile:
 * doar cele pe care autorul le poate menționa (setările `mentions.*` ale grupului), alese sau scrise exact.
 * Rezultatul e salvat lângă text (ex. `meta.mentions`), deci afișarea și notificările merg după id, nu după nume.
 */
export class GcsTextMentions {
  constructor(private readonly deps: { db: PrismaClient; groupMentions?: GcsGroupMentionService }) {}

  async resolve(actor: GcsActor, text: string, hints: readonly GcsMentionHint[] = []): Promise<GcsTextMention[]> {
    if (!text.includes("@")) return [];
    const { db, groupMentions } = this.deps;
    const out: GcsTextMention[] = [];
    const seen = new Set<string>();
    const add = (m: GcsTextMention) => {
      const k = `${m.kind}:${m.id}`;
      if (seen.has(k) || out.length >= TEXT_MENTION_MAX) return;
      seen.add(k);
      out.push(m);
    };

    // Membrii aleși din sugestii, apoi cei scriși exact (`@nume`, fără diacritice și fără litere mari).
    const hintedUsers = hints.filter((h) => h.kind === "user").map((h) => h.id);
    if (hintedUsers.length > 0) {
      const rows = await db.user.findMany({ where: { id: { in: hintedUsers } }, select: { id: true, name: true } });
      for (const id of hintedUsers) {
        const u = rows.find((r) => r.id === id);
        if (u && mentionIndex(text, u.name) !== -1) add({ kind: "user", id: u.id, name: u.name });
      }
    }
    const tokens = mentionTokens(text);
    const typed = tokens.length > 0 ? await db.user.findMany({ where: { nameNormalized: { in: tokens.map((t) => normalizeUsername(t)) } }, select: { id: true, name: true } }) : [];
    for (const u of typed) if (mentionIndex(text, u.name) !== -1) add({ kind: "user", id: u.id, name: u.name });

    // Grupurile: doar cele pe care autorul le poate menționa.
    if (groupMentions) {
      const allowed = await groupMentions.mentionableBy(actor);
      for (const h of hints.filter((x) => x.kind === "group")) {
        const g = allowed.find((x) => String(x.id) === h.id);
        if (g && mentionIndex(text, g.name) !== -1) add({ kind: "group", id: String(g.id), name: g.name });
      }
      const userNames = new Set(out.filter((m) => m.kind === "user").map((m) => normalizeUsername(m.name)));
      for (const token of tokens) {
        if (userNames.has(normalizeUsername(token))) continue;
        const g = allowed.find((x) => normalizeUsername(x.name) === normalizeUsername(token));
        if (g && mentionIndex(text, g.name) !== -1) add({ kind: "group", id: String(g.id), name: g.name });
      }
    }
    return out;
  }
}

/** Id-urile membrilor și ale grupurilor dintr-o listă de mențiuni. */
export function mentionIds(list: readonly GcsTextMention[]): { users: string[]; groups: number[] } {
  return {
    users: list.filter((m) => m.kind === "user").map((m) => m.id),
    groups: list.filter((m) => m.kind === "group").map((m) => Number(m.id)).filter((id) => Number.isInteger(id)),
  };
}
