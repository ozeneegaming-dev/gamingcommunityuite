/**
 * Mențiunile din textul simplu (chat, statusuri, câmpurile fără editor), specul 2026-10-10-nume-mentiuni-grupuri-peste-tot.
 * Partea pură, folosită și în browser (`@gcs/core/text-mentions`): cuvântul `@…` scris acum (sugestiile), căutarea unui
 * `@Nume` întreg în text, sugestiile alese trimise la server (id-urile) și împărțirea textului în bucăți + pastile.
 * Serverul hotărăște ce e mențiune (`GcsTextMentions`); clientul doar afișează ce a hotărât serverul.
 */

/** O mențiune hotărâtă de server: un membru sau un grup, cu numele așa cum apare în text (după `@`). */
export type GcsTextMention = { kind: "user" | "group"; id: string; name: string };

/** O sugestie aleasă în compozitor (trimisă la server ca indiciu; serverul verifică totul din nou). */
export type GcsMentionHint = { kind: "user" | "group"; id: string };

/** Cel mult atâtea mențiuni într-un text (restul rămân text simplu). */
export const TEXT_MENTION_MAX = 10;
/** Cel mult atâtea indicii primite de la client. */
const HINT_MAX = 20;

const NAME_CHAR = /[\p{L}\p{N}_]/u;
/** `@cuvânt` scris (pentru numele dintr-un singur cuvânt, fără sugestie aleasă). */
const TOKEN_RE = /(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]{2,40})/gu;
/** Cuvântul `@…` de dinaintea cursorului: după început, spațiu sau paranteză; fără spații în el. */
const QUERY_RE = /(^|[\s(])@([^\s@]{0,32})$/u;

/** Cuvântul `@…` scris acum (până la cursor): poziția lui `@` și textul de după el; `null` = nu se scrie o mențiune. */
export function mentionQueryAt(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, Math.max(0, Math.min(caret, value.length)));
  const m = QUERY_RE.exec(before);
  if (!m) return null;
  return { start: before.length - m[2]!.length - 1, query: m[2]! };
}

/**
 * Poziția primului `@Nume` întreg din text, de la `from` (fără să conteze literele mari): înainte de `@` e începutul sau
 * un caracter care nu face parte dintr-un nume, după nume la fel. `-1` dacă nu apare.
 */
export function mentionIndex(text: string, name: string, from = 0): number {
  if (!name) return -1;
  const hay = text.toLocaleLowerCase();
  const needle = `@${name.toLocaleLowerCase()}`;
  let at = hay.indexOf(needle, from);
  while (at !== -1) {
    const before = at === 0 ? "" : text[at - 1]!;
    const after = text[at + needle.length];
    if ((before === "" || !NAME_CHAR.test(before)) && (after === undefined || !NAME_CHAR.test(after))) return at;
    at = hay.indexOf(needle, at + 1);
  }
  return -1;
}

/** Cuvintele `@…` scrise în text (fără `@`), în ordine, fără dubluri. */
export function mentionTokens(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN_RE)].map((m) => m[1]!.replace(/[.-]+$/, "")).filter((t) => t.length >= 2))];
}

/** Indiciile trimise de client (orice formă) → lista curată: tip, id scurt, fără dubluri, cel mult 20. */
export function parseMentionHints(v: unknown): GcsMentionHint[] {
  if (!Array.isArray(v)) return [];
  const out: GcsMentionHint[] = [];
  const seen = new Set<string>();
  for (const h of v.slice(0, HINT_MAX)) {
    if (typeof h !== "object" || h === null) continue;
    const { kind, id } = h as Record<string, unknown>;
    if ((kind !== "user" && kind !== "group") || (typeof id !== "string" && typeof id !== "number")) continue;
    const sid = String(id);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid) || seen.has(`${kind}:${sid}`)) continue;
    seen.add(`${kind}:${sid}`);
    out.push({ kind, id: sid });
  }
  return out;
}

/** Mențiunile salvate (ex. `meta.mentions` al unui mesaj) → lista curată; orice altceva e ignorat. */
export function parseTextMentions(v: unknown): GcsTextMention[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is GcsTextMention => {
      if (typeof m !== "object" || m === null) return false;
      const { kind, id, name } = m as Record<string, unknown>;
      return (kind === "user" || kind === "group") && typeof id === "string" && typeof name === "string" && name.length > 0 && name.length <= 64;
    })
    .slice(0, TEXT_MENTION_MAX)
    .map(({ kind, id, name }) => ({ kind, id, name }));
}

export type GcsTextPart = { text: string; mention?: GcsTextMention };

/**
 * Textul împărțit în bucăți: textul simplu și pastilele (`@Nume` al fiecărei mențiuni, toate aparițiile). Numele mai
 * lungi au întâietate (ex. „Ana Maria” înaintea lui „Ana”); bucățile nu se suprapun.
 */
export function splitMentions(text: string, mentions: readonly GcsTextMention[]): GcsTextPart[] {
  if (mentions.length === 0 || !text.includes("@")) return [{ text }];
  const ranges: { start: number; end: number; mention: GcsTextMention }[] = [];
  const taken = (s: number, e: number) => ranges.some((r) => s < r.end && e > r.start);
  for (const m of [...mentions].sort((a, b) => b.name.length - a.name.length)) {
    let at = mentionIndex(text, m.name);
    while (at !== -1) {
      const end = at + m.name.length + 1;
      if (!taken(at, end)) ranges.push({ start: at, end, mention: m });
      at = mentionIndex(text, m.name, at + 1);
    }
  }
  if (ranges.length === 0) return [{ text }];
  ranges.sort((a, b) => a.start - b.start);
  const out: GcsTextPart[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start) });
    out.push({ text: text.slice(r.start, r.end), mention: r.mention });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}
