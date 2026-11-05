/**
 * Recrutare: cheile, setările și validarea formularelor (postul din ACP, aplicația unui membru). Totul e pur (fără IO).
 */
export const PLUGIN_KEY = "gcs.recruitment";
export const SITE = `/p/${PLUGIN_KEY}`;
export const ACP = `/admin/plugins/${PLUGIN_KEY}`;
export const API = `/api/plugins/${PLUGIN_KEY}`;

export const STATUSES = ["open", "new", "closed"] as const;
export type Status = (typeof STATUSES)[number];
export const APPLY_MODES = ["form", "topic", "link"] as const;
export type ApplyMode = (typeof APPLY_MODES)[number];
export const APP_STATUSES = ["pending", "accepted", "rejected"] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const LIMITS = { name: 60, description: 600, questions: 1500, url: 300, answers: 6000, note: 500, positions: 50 } as const;

export const isStatus = (v: unknown): v is Status => typeof v === "string" && (STATUSES as readonly string[]).includes(v);
export const isApplyMode = (v: unknown): v is ApplyMode => typeof v === "string" && (APPLY_MODES as readonly string[]).includes(v);
export const isAppStatus = (v: unknown): v is AppStatus => typeof v === "string" && (APP_STATUSES as readonly string[]).includes(v);

/** O valoare text din corpul unui formular, fără caractere de control (rândurile noi rămân). */
export function field(body: unknown, name: string): string {
  const v = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined;
  const s = Array.isArray(v) ? v[v.length - 1] : v;
  return typeof s === "string" ? s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : "";
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const multiLine = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Un id pozitiv dintr-o adresă sau un câmp. */
export function idOf(raw: unknown): number | null {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  return /^[1-9]\d{0,9}$/.test(s) ? Number(s) : null;
}

/** O adresă sigură pentru „link spre aplicare”: internă (`/…`) sau `https://`, fără spații și ghilimele. */
export function safeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > LIMITS.url || /[\s"'<>\\]/.test(v)) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  return /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#].*)?$/i.test(v) ? v : null;
}

const ICON_RE = /^fa-(?:solid|regular|brands) fa-[a-z0-9-]{1,60}$/;

export type PositionInput = {
  id: number | null;
  name: string;
  description: string;
  status: Status;
  groupId: number | null;
  icon: string;
  applyMode: ApplyMode;
  applyForumId: number | null;
  applyUrl: string;
  questions: string;
  sort: number;
};

/**
 * Formularul unui post (ACP): numele obligatoriu, descrierea și întrebările limitate, starea / modul din liste, grupul
 * și forumul din cele existente (`groups`, `forums`), linkul doar intern sau `https://`.
 */
export function readPosition(body: unknown, opts: { groups: number[]; forums: number[] }): { ok: true; value: PositionInput } | { ok: false; error: string } {
  const name = oneLine(field(body, "name"));
  if (name.length < 2 || [...name].length > LIMITS.name) return { ok: false, error: "name" };
  const description = multiLine(field(body, "description"));
  if ([...description].length > LIMITS.description) return { ok: false, error: "description" };
  const status = field(body, "status");
  if (!isStatus(status)) return { ok: false, error: "status" };
  const rawGroup = field(body, "groupId");
  const groupId = rawGroup ? idOf(rawGroup) : null;
  if (rawGroup && (groupId === null || !opts.groups.includes(groupId))) return { ok: false, error: "group" };
  const icon = field(body, "icon").trim();
  if (icon && !ICON_RE.test(icon)) return { ok: false, error: "icon" };
  const applyMode = field(body, "applyMode") || "form";
  if (!isApplyMode(applyMode)) return { ok: false, error: "mode" };
  const rawForum = field(body, "applyForumId");
  const applyForumId = rawForum ? idOf(rawForum) : null;
  if (applyMode === "topic" && (applyForumId === null || !opts.forums.includes(applyForumId))) return { ok: false, error: "forum" };
  const rawUrl = field(body, "applyUrl");
  const applyUrl = rawUrl.trim() ? safeUrl(rawUrl) : "";
  if (applyUrl === null || (applyMode === "link" && !applyUrl)) return { ok: false, error: "url" };
  const questions = multiLine(field(body, "questions"));
  if ([...questions].length > LIMITS.questions) return { ok: false, error: "questions" };
  const sortRaw = Number(field(body, "sort") || "0");
  const sort = Number.isInteger(sortRaw) ? Math.max(-1000, Math.min(1000, sortRaw)) : 0;
  return {
    ok: true,
    value: { id: idOf(field(body, "id")), name, description, status, groupId, icon, applyMode, applyForumId: applyMode === "topic" ? applyForumId : null, applyUrl: applyMode === "link" ? applyUrl : "", questions, sort },
  };
}

/** Întrebările postului: câte una pe rând (cel mult 10). */
export function questionList(text: string): string[] {
  return text
    .split("\n")
    .map((q) => oneLine(q))
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * Aplicația unui membru: câte un răspuns pe întrebare (`q0`…`q9`) sau, fără întrebări, un singur text (`answers`).
 * Răspunsurile se pun într-un singur text (întrebarea, apoi răspunsul), cu lungimea minimă din setări.
 */
export function readApplication(body: unknown, questions: string[], minLength: number): { ok: true; value: string } | { ok: false; error: string } {
  let text: string;
  if (questions.length > 0) {
    const parts: string[] = [];
    for (const [i, q] of questions.entries()) {
      const a = multiLine(field(body, `q${i}`));
      if (!a) return { ok: false, error: "missing" };
      parts.push(`${q}\n${a}`);
    }
    text = parts.join("\n\n");
  } else {
    text = multiLine(field(body, "answers"));
  }
  const length = [...text].length;
  if (length === 0) return { ok: false, error: "missing" };
  if (length < minLength) return { ok: false, error: "short" };
  if (length > LIMITS.answers) return { ok: false, error: "long" };
  return { ok: true, value: text };
}

export type Settings = { intro: string; oneOpen: boolean; minLength: number };

export function readSettings(raw: Record<string, unknown>): Settings {
  const intro = typeof raw.intro === "string" ? raw.intro.slice(0, 2000) : "";
  const n = typeof raw.minLength === "number" && Number.isInteger(raw.minLength) ? raw.minLength : 40;
  return { intro, oneOpen: raw.oneOpen !== false, minLength: Math.max(0, Math.min(2000, n)) };
}

/** Eticheta stării pe index: ON (deschis), NOU (deschis, evidențiat), OFF (închis). */
export const statusTone = (s: Status) => (s === "closed" ? "off" : s === "new" ? "new" : "on");
export const isOpen = (s: Status) => s !== "closed";
