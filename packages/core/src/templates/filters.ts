import type { GcsTemplateErrorCode } from "./parser";
import { escapeHtml, getProperty, GcsSafeHtml, isTruthy, toDate, toList, toNumber, toText, equals } from "./values";

/** Ce primește un filtru de la motor: formatarea în limba viewer-ului, textele traduse, limitele. */
export type GcsTemplateFilterContext = {
  locale: string;
  formatDate(d: Date, style: string): string;
  formatNumber(n: number, opts: { decimals?: number; style?: string }): string;
  translate(key: string, params: Record<string, string | number | Date>): string;
  /** Lungimea maximă a unui text produs de filtre (limita de ieșire). */
  maxString: number;
  /** Numărul maxim de elemente al unei liste produse de filtre. */
  maxItems: number;
  fail(code: GcsTemplateErrorCode): never;
};

export type GcsTemplateFilter = (input: unknown, args: unknown[], named: Record<string, unknown>, ctx: GcsTemplateFilterContext) => unknown;

const str = (ctx: GcsTemplateFilterContext, s: string) => (s.length > ctx.maxString ? ctx.fail("output_limit") : s);
const chars = (s: string) => [...s];
const num = (v: unknown, fallback: number) => (v === undefined || v === null || v === "" ? fallback : toNumber(v));

/** Culoarea `#RRGGBB` ca fundal translucid `rgba(...)` (la fel ca `tint` din componentele forumului). */
export function tintColor(hex: unknown, alpha = 0.14): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(typeof hex === "string" ? hex : "");
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0.14;
  if (!m) return `rgba(214, 40, 57, ${a})`;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${a})`;
}

function translationParams(named: Record<string, unknown>): Record<string, string | number | Date> {
  const params: Record<string, string | number | Date> = {};
  for (const [k, v] of Object.entries(named)) {
    if (typeof v === "number" || v instanceof Date) params[k] = v;
    else params[k] = toText(v);
  }
  return params;
}

/** Filtrele (aceleași nume ca `TEMPLATE_FILTERS` din parser). Rezultatele text sunt escapate la ieșire. */
export const GCS_TEMPLATE_FILTERS: Record<string, GcsTemplateFilter> = {
  // ─── Text ──────────────────────────────────────────────────────────────────
  escape: (v) => (v instanceof GcsSafeHtml ? v : new GcsSafeHtml(escapeHtml(toText(v)))),
  default: (v, [fallback], named) => {
    const allowFalse = named.allow_false === true;
    if (v === null || v === undefined || v === "" || (v === false && !allowFalse) || (Array.isArray(v) && v.length === 0)) return fallback;
    return v;
  },
  upcase: (v, _a, _n, ctx) => toText(v).toLocaleUpperCase(ctx.locale),
  downcase: (v, _a, _n, ctx) => toText(v).toLocaleLowerCase(ctx.locale),
  capitalize: (v, _a, _n, ctx) => {
    const s = toText(v);
    return s ? s.charAt(0).toLocaleUpperCase(ctx.locale) + s.slice(1) : s;
  },
  truncate: (v, [length, ellipsis]) => {
    const s = chars(toText(v));
    const n = Math.max(0, Math.floor(num(length, 50)));
    const end = ellipsis === undefined ? "…" : toText(ellipsis);
    if (s.length <= n) return s.join("");
    return s.slice(0, Math.max(0, n - chars(end).length)).join("") + end;
  },
  truncatewords: (v, [count, ellipsis]) => {
    const words = toText(v).split(/\s+/).filter(Boolean);
    const n = Math.max(1, Math.floor(num(count, 15)));
    if (words.length <= n) return words.join(" ");
    return words.slice(0, n).join(" ") + (ellipsis === undefined ? "…" : toText(ellipsis));
  },
  append: (v, [s], _n, ctx) => str(ctx, toText(v) + toText(s)),
  prepend: (v, [s], _n, ctx) => str(ctx, toText(s) + toText(v)),
  replace: (v, [from, to], _n, ctx) => {
    const f = toText(from);
    return f ? str(ctx, toText(v).split(f).join(toText(to))) : toText(v);
  },
  remove: (v, [what]) => {
    const w = toText(what);
    return w ? toText(v).split(w).join("") : toText(v);
  },
  strip: (v) => toText(v).trim(),
  lstrip: (v) => toText(v).trimStart(),
  rstrip: (v) => toText(v).trimEnd(),
  /** Rândurile noi devin `<br>` (textul e escapat întâi, deci rezultatul e sigur). */
  newline_to_br: (v) => new GcsSafeHtml(escapeHtml(toText(v)).replace(/\r?\n/g, "<br>")),
  url_encode: (v) => encodeURIComponent(toText(v)),
  split: (v, [sep], _n, ctx) => {
    const parts = toText(v).split(toText(sep));
    return parts.length > ctx.maxItems ? ctx.fail("iteration_limit") : parts;
  },
  /** Textul tradus: `{{ "forum.topics" | t }}` sau `{{ n | t: "forum.replies" }}` (`n` devine `count`), cu parametri numiți. */
  t: (v, [key], named, ctx) => {
    const params = translationParams(named);
    if (typeof key === "string") {
      if (v !== null && v !== undefined && !("count" in params)) {
        if (typeof v === "number") params.count = v;
        else params.value = toText(v);
      }
      return ctx.translate(key, params);
    }
    return ctx.translate(toText(v), params);
  },
  tint: (v, [alpha]) => tintColor(v, num(alpha, 0.14)),

  // ─── Numere ────────────────────────────────────────────────────────────────
  plus: (v, [n]) => toNumber(v) + toNumber(n),
  minus: (v, [n]) => toNumber(v) - toNumber(n),
  times: (v, [n]) => toNumber(v) * toNumber(n),
  divided_by: (v, [n]) => {
    const d = toNumber(n);
    if (d === 0) return null;
    const r = toNumber(v) / d;
    return Number.isInteger(toNumber(v)) && Number.isInteger(d) ? Math.floor(r) : r;
  },
  modulo: (v, [n]) => {
    const d = toNumber(n);
    return d === 0 ? null : toNumber(v) % d;
  },
  round: (v, [digits]) => {
    const p = 10 ** Math.max(0, Math.min(10, Math.floor(num(digits, 0))));
    return Math.round(toNumber(v) * p) / p;
  },
  ceil: (v) => Math.ceil(toNumber(v)),
  floor: (v) => Math.floor(toNumber(v)),
  abs: (v) => Math.abs(toNumber(v)),
  /** Numărul în formatul limbii: `{{ n | number }}`, `{{ n | number: 1 }}`, `{{ n | number: "compact" }}`. */
  number: (v, [opt], _n, ctx) => {
    const n = toNumber(v);
    if (typeof opt === "string") return ctx.formatNumber(n, { style: opt });
    if (typeof opt === "number") return ctx.formatNumber(n, { decimals: Math.max(0, Math.min(6, Math.floor(opt))) });
    return ctx.formatNumber(n, {});
  },
  /** Data în formatul limbii: `short`, `medium` (implicit), `long`, `full`, `date`, `date_long`, `time`, `year`, `relative`, `iso`. */
  date: (v, [style], _n, ctx) => {
    const d = v === "now" ? new Date() : toDate(v);
    if (!d) return "";
    return ctx.formatDate(d, typeof style === "string" ? style : "medium");
  },

  // ─── Liste ─────────────────────────────────────────────────────────────────
  size: (v) => {
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    return toNumber(getProperty(v, "size"));
  },
  first: (v) => getProperty(v, "first"),
  last: (v) => getProperty(v, "last"),
  join: (v, [sep], _n, ctx) => str(ctx, toList(v, ctx.maxItems).map(toText).join(sep === undefined ? " " : toText(sep))),
  reverse: (v, _a, _n, ctx) => [...toList(v, ctx.maxItems)].reverse(),
  compact: (v, _a, _n, ctx) => toList(v, ctx.maxItems).filter((x) => x !== null && x !== undefined),
  uniq: (v, _a, _n, ctx) => [...new Set(toList(v, ctx.maxItems))],
  map: (v, [key], _n, ctx) => toList(v, ctx.maxItems).map((x) => getProperty(x, toText(key))),
  where: (v, [key, value], _n, ctx) =>
    toList(v, ctx.maxItems).filter((x) => {
      const got = getProperty(x, toText(key));
      return value === undefined ? isTruthy(got) : equals(got, value);
    }),
  sort: (v, [key], _n, ctx) => {
    const list = [...toList(v, ctx.maxItems)];
    const pick = (x: unknown) => (key === undefined ? x : getProperty(x, toText(key)));
    return list.sort((a, b) => {
      const x = pick(a);
      const y = pick(b);
      if (typeof x === "number" && typeof y === "number") return x - y;
      return toText(x).localeCompare(toText(y), ctx.locale);
    });
  },
  slice: (v, [start, length], _n, ctx) => {
    const s = Math.floor(num(start, 0));
    const l = Math.max(0, Math.floor(num(length, 1)));
    if (typeof v === "string") {
      const c = chars(v);
      const from = s < 0 ? c.length + s : s;
      return c.slice(from, from + l).join("");
    }
    const list = toList(v, ctx.maxItems);
    const from = s < 0 ? list.length + s : s;
    return list.slice(from, from + l);
  },
};
