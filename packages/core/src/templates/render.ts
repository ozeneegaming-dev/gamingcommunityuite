import { avatarHtml, isTemplateUser, relativeTime, timeHtml, usernameHtml, type GcsTemplateComponents } from "./components";
import { GCS_TEMPLATE_FILTERS, type GcsTemplateFilterContext } from "./filters";
import {
  GcsTemplateError,
  isTemplateName,
  parseTemplate,
  positionOf,
  type GcsCompiledTemplate,
  type GcsTemplateErrorCode,
  type GcsTplExpr,
  type GcsTplFiltered,
  type GcsTplNode,
} from "./parser";
import {
  equals,
  GcsSafeHtml,
  GcsTemplateRange,
  getProperty,
  isBlank,
  isEmpty,
  isTruthy,
  toDate,
  toList,
  toNumber,
  toOutput,
  toTemplateValue,
  toText,
} from "./values";

export type GcsTemplateLimits = {
  /** Timpul maxim de randare (ms). */
  timeMs: number;
  /** Iterațiile maxime (toate buclele la un loc). */
  iterations: number;
  /** Mărimea maximă a ieșirii (caractere). */
  output: number;
  /** Adâncimea maximă a includerilor. */
  includeDepth: number;
};

export const TEMPLATE_LIMITS: GcsTemplateLimits = { timeMs: 50, iterations: 20_000, output: 256 * 1024, includeDepth: 5 };

export type GcsTemplateFormat = {
  date(d: Date, style: string): string;
  number(n: number, opts: { decimals?: number; style?: string }): string;
  /** Data relativă (`{% time %}`, `| date: "relative"`). */
  relative(d: Date): string;
};

export type GcsTemplateRenderOptions = {
  locale?: string;
  timeZone?: string;
  now?: Date;
  /** Textele traduse (filtrul `t`); fără el, cheia rămâne cum e. */
  translate?: (key: string, params: Record<string, string | number | Date>) => string;
  /** Sursa unui șablon inclus (`{% include "grup.nume" %}`): suprascrierea temei sau cel implicit; `null` = nu există. */
  include?: (name: string) => string | null;
  /** Conținutul unui punct de extensie (pluginurile, mai târziu); HTML deja sigur. */
  hook?: (name: string) => string;
  components?: Partial<GcsTemplateComponents>;
  format?: Partial<GcsTemplateFormat>;
  limits?: Partial<GcsTemplateLimits>;
  /** Numele șablonului randat (în erori). */
  name?: string;
};

// ─── Cache-ul AST-urilor ─────────────────────────────────────────────────────

const CACHE_MAX = 500;
const compiled = new Map<string, GcsCompiledTemplate>();

/** Parsează o dată fiecare sursă: AST-ul rămâne în memorie (cele mai vechi ies primele, peste 500). */
export function compileTemplate(source: string): GcsCompiledTemplate {
  const hit = compiled.get(source);
  if (hit) {
    compiled.delete(source);
    compiled.set(source, hit);
    return hit;
  }
  const tpl = parseTemplate(source);
  compiled.set(source, tpl);
  if (compiled.size > CACHE_MAX) compiled.delete(compiled.keys().next().value!);
  return tpl;
}

/** Validează un șablon: `null` dacă e corect, altfel eroarea (cu rând și coloană). */
export function templateSyntaxError(source: string): GcsTemplateError | null {
  try {
    compileTemplate(source);
    return null;
  } catch (error) {
    if (error instanceof GcsTemplateError) return error;
    throw error;
  }
}

// ─── Formatarea implicită ────────────────────────────────────────────────────

const DATE_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: "short", timeStyle: "short" },
  medium: { dateStyle: "medium", timeStyle: "short" },
  long: { dateStyle: "long", timeStyle: "short" },
  full: { dateStyle: "full", timeStyle: "short" },
  date: { dateStyle: "medium" },
  date_long: { dateStyle: "long" },
  time: { timeStyle: "short" },
  year: { year: "numeric" },
};

export function defaultTemplateFormat(locale: string, timeZone: string | undefined, now: () => Date): GcsTemplateFormat {
  return {
    date: (d, style) => {
      if (style === "iso") return d.toISOString();
      if (style === "relative") return relativeTime(d, now(), locale);
      return new Intl.DateTimeFormat(locale, { ...(DATE_STYLES[style] ?? DATE_STYLES.medium), ...(timeZone ? { timeZone } : {}) }).format(d);
    },
    number: (n, { decimals, style }) => {
      if (style === "compact") return new Intl.NumberFormat(locale, { notation: "compact" }).format(n);
      if (style === "percent") return new Intl.NumberFormat(locale, { style: "percent" }).format(n);
      return new Intl.NumberFormat(locale, decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {}).format(n);
    },
    relative: (d) => relativeTime(d, now(), locale),
  };
}

// ─── Randarea ────────────────────────────────────────────────────────────────

type Signal = "break" | "continue" | undefined;

/** Valorile `empty` și `blank` din comparații (nu pot fi confundate cu datele, care sunt doar obiecte simple). */
class SpecialValue {
  constructor(readonly v: "empty" | "blank") {}
}
const SPECIALS = { empty: new SpecialValue("empty"), blank: new SpecialValue("blank") };

/** Sloturile: locul unei părți React (`{% slot "content" %}`), ca element pe care îl înlocuiește site-ul. */
export const slotMarkup = (name: string) => `<gcs-slot data-name="${name}"></gcs-slot>`;

class Renderer {
  readonly limits: GcsTemplateLimits;
  readonly deadline: number;
  readonly locale: string;
  readonly format: GcsTemplateFormat;
  readonly components: GcsTemplateComponents;
  readonly filterCtx: GcsTemplateFilterContext;
  size = 0;
  iterations = 0;
  ops = 0;
  depth = 0;
  /** Variabilele: datele (jos), apoi `assign`/`capture`, apoi buclele și parametrii includerilor (sus). */
  scopes: Record<string, unknown>[];
  /** Șablonul curent (pentru pozițiile erorilor). */
  current: { tpl: GcsCompiledTemplate; name: string | null };

  constructor(
    tpl: GcsCompiledTemplate,
    data: Record<string, unknown>,
    readonly opts: GcsTemplateRenderOptions,
  ) {
    this.limits = { ...TEMPLATE_LIMITS, ...opts.limits };
    this.deadline = Date.now() + this.limits.timeMs;
    this.locale = opts.locale ?? "ro";
    const now = () => opts.now ?? new Date();
    this.format = { ...defaultTemplateFormat(this.locale, opts.timeZone, now), ...opts.format };
    const format = this.format;
    this.components = {
      icon: () => "",
      avatar: avatarHtml,
      username: usernameHtml,
      time: (d) => timeHtml(d, format.relative(d), format.date(d, "long")),
      ...opts.components,
    };
    this.scopes = [{ ...data }, {}];
    this.current = { tpl, name: opts.name ?? null };
    this.filterCtx = {
      locale: this.locale,
      formatDate: (d, s) => format.date(d, s),
      formatNumber: (n, o) => format.number(n, o),
      translate: (key, params) => {
        if (!opts.translate) return key;
        try {
          return opts.translate(key, params);
        } catch {
          return key;
        }
      },
      maxString: this.limits.output,
      maxItems: this.limits.iterations,
      fail: (code) => this.fail(code, 0),
    };
  }

  fail(code: GcsTemplateErrorCode, pos: number, detail = ""): never {
    const { line, column } = positionOf(this.current.tpl.lines, pos);
    throw new GcsTemplateError(code, line, column, detail, this.current.name);
  }

  tick(pos: number): void {
    if ((++this.ops & 31) === 0 && Date.now() > this.deadline) this.fail("time_limit", pos);
  }

  write(out: string[], s: string, pos: number): void {
    if (!s) return;
    this.size += s.length;
    if (this.size > this.limits.output) this.fail("output_limit", pos);
    out.push(s);
  }

  lookup(name: string): unknown {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i]!;
      if (Object.prototype.hasOwnProperty.call(scope, name)) return toTemplateValue(scope[name]);
    }
    return undefined;
  }

  setVar(name: string, value: unknown): void {
    this.scopes[1]![name] = value;
  }

  eval(e: GcsTplExpr): unknown {
    switch (e.k) {
      case "lit":
        return e.v;
      case "special":
        return SPECIALS[e.v];
      case "var": {
        let v = this.lookup(e.path[0] as string);
        for (let i = 1; i < e.path.length; i++) {
          const seg = e.path[i]!;
          v = getProperty(v, typeof seg === "string" ? seg : this.eval(seg));
        }
        return v;
      }
      case "range": {
        const from = Math.trunc(toNumber(this.eval(e.from)));
        const to = Math.trunc(toNumber(this.eval(e.to)));
        return new GcsTemplateRange(from, to);
      }
      case "not":
        return !isTruthy(this.eval(e.e));
      case "bin": {
        if (e.op === "and") return isTruthy(this.eval(e.l)) && isTruthy(this.eval(e.r));
        if (e.op === "or") return isTruthy(this.eval(e.l)) || isTruthy(this.eval(e.r));
        return this.compare(e.op, this.eval(e.l), this.eval(e.r));
      }
    }
  }

  compare(op: string, a: unknown, b: unknown): boolean {
    const special = (x: unknown) => (x instanceof SpecialValue ? x.v : null);
    const sa = special(a);
    const sb = special(b);
    if (sa || sb) {
      const value = sa ? b : a;
      const test = (sa ?? sb) === "empty" ? isEmpty(value) : isBlank(value);
      if (op === "==") return test;
      if (op === "!=") return !test;
      return false;
    }
    switch (op) {
      case "==":
        return equals(a, b);
      case "!=":
        return !equals(a, b);
      case "contains":
        if (typeof a === "string") return a.includes(toText(b));
        if (Array.isArray(a)) return a.some((x) => equals(x, b));
        return false;
      default: {
        const x = a instanceof Date ? a.getTime() : a;
        const y = b instanceof Date ? b.getTime() : b;
        if (typeof x === "number" && typeof y === "number") {
          return op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
        }
        if (typeof x === "string" && typeof y === "string") {
          return op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
        }
        return false;
      }
    }
  }

  filtered(f: GcsTplFiltered): unknown {
    let v = this.eval(f.e);
    for (const filter of f.filters) {
      this.tick(filter.pos);
      const fn = GCS_TEMPLATE_FILTERS[filter.name];
      if (!fn) this.fail("unknown_filter", filter.pos, filter.name);
      const args = filter.args.map((a) => this.eval(a));
      const named = Object.fromEntries(filter.named.map(([k, a]) => [k, this.eval(a)]));
      const prev = this.filterCtx.fail;
      this.filterCtx.fail = (code) => this.fail(code, filter.pos, filter.name);
      try {
        v = fn(v, args, named, this.filterCtx);
      } finally {
        this.filterCtx.fail = prev;
      }
    }
    return v;
  }

  nodes(list: GcsTplNode[], out: string[]): Signal {
    for (const node of list) {
      const signal = this.node(node, out);
      if (signal) return signal;
    }
    return undefined;
  }

  node(n: GcsTplNode, out: string[]): Signal {
    switch (n.k) {
      case "text":
        this.write(out, n.v, 0);
        return undefined;
      case "out":
        this.tick(n.pos);
        this.write(out, toOutput(this.filtered(n)), n.pos);
        return undefined;
      case "if":
        this.tick(n.pos);
        for (const b of n.branches) {
          if (b.cond === null || isTruthy(this.eval(b.cond))) return this.nodes(b.body, out);
        }
        return undefined;
      case "case": {
        this.tick(n.pos);
        const v = this.eval(n.e);
        for (const w of n.whens) {
          if (w.values.some((x) => equals(v, this.eval(x)))) return this.nodes(w.body, out);
        }
        return n.else ? this.nodes(n.else, out) : undefined;
      }
      case "for":
        return this.loop(n, out);
      case "break":
      case "continue":
        return n.k;
      case "assign":
        this.tick(n.pos);
        this.setVar(n.name, this.filtered(n));
        return undefined;
      case "capture": {
        const buf: string[] = [];
        const signal = this.nodes(n.body, buf);
        this.setVar(n.name, new GcsSafeHtml(buf.join("")));
        return signal;
      }
      case "include":
        this.include(n, out);
        return undefined;
      case "hook": {
        const name = this.eval(n.name);
        if (typeof name === "string" && isTemplateName(name) && this.opts.hook) this.write(out, this.opts.hook(name), n.pos);
        return undefined;
      }
      case "slot":
        this.write(out, slotMarkup(n.name), n.pos);
        return undefined;
      case "component":
        this.tick(n.pos);
        this.write(out, this.component(n), n.pos);
        return undefined;
    }
  }

  loop(n: Extract<GcsTplNode, { k: "for" }>, out: string[]): Signal {
    this.tick(n.pos);
    const coll = this.eval(n.coll);
    if (coll instanceof GcsTemplateRange && coll.size > this.limits.iterations - this.iterations) this.fail("iteration_limit", n.pos);
    let items = toList(coll === null || coll === undefined ? [] : coll, this.limits.iterations);
    if (n.offset) items = items.slice(Math.max(0, Math.trunc(toNumber(this.eval(n.offset)))));
    if (n.limit) items = items.slice(0, Math.max(0, Math.trunc(toNumber(this.eval(n.limit)))));
    if (n.reversed) items = [...items].reverse();
    if (items.length === 0) return n.else ? this.nodes(n.else, out) : undefined;
    const parent = this.lookup("forloop");
    const scope: Record<string, unknown> = {};
    this.scopes.push(scope);
    try {
      for (let i = 0; i < items.length; i++) {
        if (++this.iterations > this.limits.iterations) this.fail("iteration_limit", n.pos);
        this.tick(n.pos);
        scope[n.name] = items[i];
        scope.forloop = {
          index: i + 1,
          index0: i,
          rindex: items.length - i,
          rindex0: items.length - i - 1,
          first: i === 0,
          last: i === items.length - 1,
          length: items.length,
          parentloop: parent ?? null,
        };
        const signal = this.nodes(n.body, out);
        if (signal === "break") break;
      }
    } finally {
      this.scopes.pop();
    }
    return undefined;
  }

  include(n: Extract<GcsTplNode, { k: "include" }>, out: string[]): void {
    const name = this.eval(n.name);
    if (typeof name !== "string" || !isTemplateName(name)) this.fail("include_not_found", n.pos, toText(name));
    if (this.depth >= this.limits.includeDepth) this.fail("include_depth", n.pos, name);
    const source = this.opts.include?.(name) ?? null;
    if (source === null) this.fail("include_not_found", n.pos, name);
    let tpl: GcsCompiledTemplate;
    try {
      tpl = compileTemplate(source);
    } catch (error) {
      if (error instanceof GcsTemplateError) throw new GcsTemplateError(error.code, error.line, error.column, error.detail, name);
      throw error;
    }
    const params = Object.fromEntries(n.named.map(([k, e]) => [k, this.eval(e)]));
    const saved = this.current;
    this.current = { tpl, name };
    this.depth++;
    this.scopes.push(params);
    try {
      this.nodes(tpl.nodes, out);
    } finally {
      this.scopes.pop();
      this.depth--;
      this.current = saved;
    }
  }

  component(n: Extract<GcsTplNode, { k: "component" }>): string {
    const arg = this.eval(n.args[0]!);
    const opts = Object.fromEntries(n.named.map(([k, e]) => [k, this.eval(e)]));
    switch (n.name) {
      case "icon":
        return typeof arg === "string" && /^(fa-solid|fa-regular|fa-brands) fa-[a-z0-9-]{1,60}$/.test(arg) ? this.components.icon(arg, opts) : "";
      case "avatar":
        return isTemplateUser(arg) ? this.components.avatar(arg, opts) : "";
      case "username":
        return isTemplateUser(arg) ? this.components.username(arg, opts) : "";
      case "time": {
        const d = toDate(arg);
        return d ? this.components.time(d, opts) : "";
      }
    }
  }
}

/**
 * Randează un șablon (sursă sau compilat) cu datele date. Rezultatul e HTML **nesanitizat** încă: apelantul îl trece
 * prin `sanitizeTemplateHtml` înainte să ajungă în pagină. Aruncă `GcsTemplateError` (sintaxă sau limite).
 */
export function renderTemplate(template: string | GcsCompiledTemplate, data: Record<string, unknown>, opts: GcsTemplateRenderOptions = {}): string {
  const tpl = typeof template === "string" ? compileTemplate(template) : template;
  const r = new Renderer(tpl, data, opts);
  const out: string[] = [];
  r.nodes(tpl.nodes, out);
  return out.join("");
}
