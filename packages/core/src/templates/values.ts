/**
 * Valorile pe care le vede un șablon: primitive, liste, obiecte simple, `Date` și `GcsSafeHtml`. Orice altceva
 * (funcții, instanțe de clase, simboluri) e invizibil: șablonul nu poate apela cod și nu poate urca în prototipuri.
 */

/**
 * HTML deja sigur (conținutul sanitizat al postărilor, corpul emailurilor, ieșirea componentelor). Doar codul
 * platformei îl poate crea; șablonul nu are niciun filtru care să transforme un text în `GcsSafeHtml`.
 */
export class GcsSafeHtml {
  constructor(readonly html: string) {}
  toString(): string {
    return this.html;
  }
}

export const safeHtml = (html: string) => new GcsSafeHtml(html);

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => ESCAPES[c]!);
}

/** Proprietățile pe care nu le citim niciodată, chiar dacă un obiect le are ca proprietăți proprii. */
const BLOCKED = new Set(["__proto__", "constructor", "prototype", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);

export function isPlainData(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** O valoare văzută de șablon: ce nu e dată (funcții, clase, simboluri) devine `undefined`. */
export function toTemplateValue(v: unknown): unknown {
  switch (typeof v) {
    case "string":
    case "number":
    case "boolean":
    case "undefined":
      return v;
    case "bigint":
      return Number(v);
    case "object":
      if (v === null || Array.isArray(v) || v instanceof Date || v instanceof GcsSafeHtml || v instanceof GcsTemplateRange || isPlainData(v)) return v;
      return undefined;
    default:
      return undefined;
  }
}

/** Un interval `(1..5)`, fără să fie construit ca listă până nu e nevoie (o listă mare ar consuma memorie). */
export class GcsTemplateRange {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {}
  get size(): number {
    return Math.max(0, this.to - this.from + 1);
  }
  toArray(max: number): number[] {
    const n = Math.min(this.size, max);
    return Array.from({ length: n }, (_, i) => this.from + i);
  }
}

/** `obj.key` / `list[0]` / `list.size` în sandbox. */
export function getProperty(obj: unknown, key: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (typeof key === "string" && BLOCKED.has(key)) return undefined;
  if (obj instanceof GcsTemplateRange) {
    if (key === "size") return obj.size;
    if (key === "first") return obj.size > 0 ? obj.from : undefined;
    if (key === "last") return obj.size > 0 ? obj.to : undefined;
    return undefined;
  }
  if (Array.isArray(obj) || typeof obj === "string") {
    if (key === "size") return obj.length;
    if (key === "first") return toTemplateValue(obj[0]);
    if (key === "last") return toTemplateValue(obj[obj.length - 1]);
    if (typeof obj === "string") return undefined;
    const index = typeof key === "number" ? key : typeof key === "string" && /^-?\d+$/.test(key) ? Number(key) : Number.NaN;
    if (!Number.isInteger(index)) return undefined;
    return toTemplateValue(obj[index < 0 ? obj.length + index : index]);
  }
  if (isPlainData(obj)) {
    const k = typeof key === "number" ? String(key) : key;
    if (typeof k !== "string") return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, k)) return toTemplateValue(obj[k]);
    if (k === "size") return Object.keys(obj).length;
    return undefined;
  }
  return undefined;
}

/** Fals: `false`, `nil`, `""`, `0`, listele goale (mai intuitiv pentru admini decât regula Liquid). */
export function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === "" || v === 0) return false;
  if (Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof GcsTemplateRange) return v.size > 0;
  if (v instanceof GcsSafeHtml) return v.html !== "";
  return true;
}

/** `x == empty`: text gol, listă goală, obiect gol. */
export function isEmpty(v: unknown): boolean {
  if (v === "" || (Array.isArray(v) && v.length === 0)) return true;
  if (v instanceof GcsSafeHtml) return v.html === "";
  if (v instanceof GcsTemplateRange) return v.size === 0;
  return isPlainData(v) && Object.keys(v).length === 0;
}

/** `x == blank`: ca `empty`, plus `nil`, `false` și textele doar cu spații. */
export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return true;
  if (typeof v === "string") return v.trim() === "";
  return isEmpty(v);
}

/** Textul unei valori (pentru filtre): fără escapare. */
export function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString();
  if (v instanceof GcsSafeHtml) return v.html;
  if (Array.isArray(v)) return v.map(toText).join("");
  if (v instanceof GcsTemplateRange) return `${v.from}..${v.to}`;
  return "";
}

/** Ieșirea lui `{{ }}`: textul escapat; `GcsSafeHtml` rămâne cum e. */
export function toOutput(v: unknown): string {
  if (v instanceof GcsSafeHtml) return v.html;
  if (Array.isArray(v)) return v.map(toOutput).join("");
  return escapeHtml(toText(v));
}

export function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

/** O dată din `Date`, un text ISO sau un timestamp; altfel `null`. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  return null;
}

export function toList(v: unknown, max: number): unknown[] {
  if (Array.isArray(v)) return v.map(toTemplateValue);
  if (v instanceof GcsTemplateRange) return v.toArray(max);
  if (v === null || v === undefined) return [];
  return [v];
}

/** Egalitatea din `==`: valori simple, date (după timp), `empty` / `blank`. */
export function equals(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof GcsSafeHtml || b instanceof GcsSafeHtml) return toText(a) === toText(b);
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  return a === b;
}
