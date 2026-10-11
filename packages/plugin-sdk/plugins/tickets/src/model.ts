/**
 * Modelul ticketelor: stările, prioritățile, setările (cu valorile verificate) și citirea formularelor. Fără `ctx`:
 * funcțiile de aici sunt pure, deci se testează direct.
 */

export const PLUGIN_KEY = "gcs.tickets";
export const SITE = `/p/${PLUGIN_KEY}`;
export const API = `/api/plugins/${PLUGIN_KEY}`;
export const ACP = `/admin/plugins/${PLUGIN_KEY}`;

/**
 * Stările: `open` = așteaptă staff-ul, `in_progress` = preluat de staff, `answered` = staff-ul a răspuns și așteaptă
 * membrul, `closed` = închis.
 */
export const STATUSES = ["open", "in_progress", "answered", "closed"] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const isStatus = (v: unknown): v is Status => typeof v === "string" && (STATUSES as readonly string[]).includes(v);
export const isPriority = (v: unknown): v is Priority => typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);

export const SUBJECT_MIN = 4;
export const SUBJECT_MAX = 120;
export const BODY_MIN = 2;
export const BODY_MAX = 8000;
export const CATEGORY_MAX = 60;

export type TicketSettings = {
  categories: string[];
  intro: string;
  /** 0 = nelimitat. */
  maxOpen: number;
  memberPriority: boolean;
  allowReopen: boolean;
  /** 0 = niciodată. */
  autoCloseDays: number;
  pageSize: number;
};

const DEFAULT_CATEGORIES = ["Suport general"];

/** Categoriile din setare: câte una pe rând, fără goluri și duplicate, cel mult 30. */
export function parseCategories(raw: unknown): string[] {
  const lines = typeof raw === "string" ? raw.split(/\r?\n/) : [];
  const out: string[] = [];
  for (const line of lines) {
    const name = line.replace(/\s+/g, " ").trim().slice(0, CATEGORY_MAX);
    if (name && !out.some((c) => c.toLowerCase() === name.toLowerCase())) out.push(name);
    if (out.length >= 30) break;
  }
  return out.length > 0 ? out : DEFAULT_CATEGORIES;
}

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);

/** Setările pluginului, cu valorile verificate (o setare lipsă sau stricată primește valoarea implicită). */
export function readSettings(all: Record<string, unknown>): TicketSettings {
  return {
    categories: parseCategories(all.categories),
    intro: typeof all.intro === "string" ? all.intro.trim().slice(0, 2000) : "",
    maxOpen: num(all.maxOpen, 3, 0, 50),
    memberPriority: all.memberPriority !== false,
    allowReopen: all.allowReopen !== false,
    autoCloseDays: num(all.autoCloseDays, 7, 0, 90),
    pageSize: num(all.pageSize, 20, 5, 100),
  };
}

/** Un câmp text din corpul unui formular (fără caractere de control, în afară de rânduri noi și tab). */
export function field(body: unknown, name: string): string {
  const v = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined;
  const s = Array.isArray(v) ? v[v.length - 1] : v;
  return typeof s === "string" ? s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : "";
}

export type NewTicket = { subject: string; category: string; priority: Priority; body: string };
export type FormError = "subject" | "body" | "category" | "priority";

/** Ticketul nou din formular, sau câmpul greșit. Categoria trebuie să fie una din setări. */
export function readNewTicket(body: unknown, settings: TicketSettings): { ok: true; value: NewTicket } | { ok: false; error: FormError } {
  const subject = field(body, "subject").replace(/\s+/g, " ").trim();
  if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) return { ok: false, error: "subject" };
  const category = field(body, "category").trim();
  if (!settings.categories.includes(category)) return { ok: false, error: "category" };
  const rawPriority = field(body, "priority") || "normal";
  if (!isPriority(rawPriority)) return { ok: false, error: "priority" };
  // Membrii aleg prioritatea doar dacă setarea o permite, și niciodată „urgent” (acela e al staff-ului).
  const priority: Priority = settings.memberPriority ? (rawPriority === "urgent" ? "high" : rawPriority) : "normal";
  const text = readBody(body);
  if (!text) return { ok: false, error: "body" };
  return { ok: true, value: { subject, category, priority, body: text } };
}

/** Textul unui mesaj (fără spații la capete, rândurile goale multiple restrânse), sau `null` dacă e prea scurt / lung. */
export function readBody(body: unknown): string | null {
  const text = field(body, "body")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length >= BODY_MIN && text.length <= BODY_MAX ? text : null;
}

/** Starea după un răspuns: al staff-ului → „răspuns”, al membrului → „deschis” (staff-ul are ce citi). */
export function statusAfterReply(current: Status, byStaff: boolean, internal: boolean): Status {
  if (internal) return current;
  if (byStaff) return "answered";
  return current === "in_progress" ? "in_progress" : "open";
}

/** Un id numeric dintr-un parametru de rută. */
export function ticketId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}

/** Pagina din query (`?page=2`), cel puțin 1. */
export function pageNumber(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,5}$/.test(raw) ? Number(raw) : 1;
  return Math.max(1, n);
}
