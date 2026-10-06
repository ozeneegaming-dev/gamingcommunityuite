/**
 * Parserul limbajului de șabloane GCS (de tip Liquid): textul șablonului → AST. Fără `eval`, fără `Function`, fără
 * acces la sistem: AST-ul e interpretat de `render.ts`, care nu știe decât să citească date și să scrie text.
 *
 * Sintaxa: `{{ expr | filtru: arg, cheie: valoare }}`, `{% tag argumente %}`, `{{-`/`-}}` și `{%-`/`-%}` taie
 * spațiile din jur. Erorile au rândul și coloana (1-based) din sursă.
 */

export const TEMPLATE_MAX_SOURCE = 64 * 1024;

export type GcsTemplateErrorCode =
  | "too_long"
  | "unclosed_output"
  | "unclosed_tag"
  | "unclosed_block"
  | "unclosed_string"
  | "unexpected_char"
  | "unexpected_token"
  | "unexpected_end"
  | "unknown_tag"
  | "unknown_filter"
  | "unmatched_end"
  | "invalid_name"
  | "break_outside_loop"
  | "time_limit"
  | "iteration_limit"
  | "output_limit"
  | "include_depth"
  | "include_not_found";

/** O eroare de șablon, cu poziția ei (rând și coloană, de la 1) și, la includeri, șablonul în care a apărut. */
export class GcsTemplateError extends Error {
  constructor(
    readonly code: GcsTemplateErrorCode,
    readonly line: number,
    readonly column: number,
    readonly detail: string = "",
    readonly template: string | null = null,
  ) {
    super(`${code}${detail ? ` (${detail})` : ""} at ${line}:${column}${template ? ` in ${template}` : ""}`);
    this.name = "GcsTemplateError";
  }
}

// ─── AST ─────────────────────────────────────────────────────────────────────

export type GcsTplExpr =
  | { k: "lit"; v: unknown; pos: number }
  | { k: "special"; v: "empty" | "blank"; pos: number }
  | { k: "var"; path: (string | GcsTplExpr)[]; pos: number }
  | { k: "range"; from: GcsTplExpr; to: GcsTplExpr; pos: number }
  | { k: "bin"; op: string; l: GcsTplExpr; r: GcsTplExpr; pos: number }
  | { k: "not"; e: GcsTplExpr; pos: number };

export type GcsTplArgs = { args: GcsTplExpr[]; named: [string, GcsTplExpr][] };
export type GcsTplFilter = GcsTplArgs & { name: string; pos: number };
export type GcsTplFiltered = { e: GcsTplExpr; filters: GcsTplFilter[] };

export type GcsTplNode =
  | { k: "text"; v: string }
  | ({ k: "out"; pos: number } & GcsTplFiltered)
  | { k: "if"; branches: { cond: GcsTplExpr | null; body: GcsTplNode[] }[]; pos: number }
  | { k: "case"; e: GcsTplExpr; whens: { values: GcsTplExpr[]; body: GcsTplNode[] }[]; else: GcsTplNode[] | null; pos: number }
  | {
      k: "for";
      name: string;
      coll: GcsTplExpr;
      limit: GcsTplExpr | null;
      offset: GcsTplExpr | null;
      reversed: boolean;
      body: GcsTplNode[];
      else: GcsTplNode[] | null;
      pos: number;
    }
  | { k: "break"; pos: number }
  | { k: "continue"; pos: number }
  | ({ k: "assign"; name: string; pos: number } & GcsTplFiltered)
  | { k: "capture"; name: string; body: GcsTplNode[]; pos: number }
  | ({ k: "include"; name: GcsTplExpr; pos: number } & { named: [string, GcsTplExpr][] })
  | { k: "hook"; name: GcsTplExpr; pos: number }
  | { k: "slot"; name: string; pos: number }
  | ({ k: "component"; name: GcsTplComponent; pos: number } & GcsTplArgs);

/** Componentele platformei, scrise ca taguri: `{% icon "fa-solid fa-star" %}`, `{% avatar user, size: "s" %}`… */
export const TEMPLATE_COMPONENTS = ["icon", "avatar", "username", "time"] as const;
export type GcsTplComponent = (typeof TEMPLATE_COMPONENTS)[number];

/** Un șablon compilat: AST-ul și sursa (pentru pozițiile erorilor de randare). */
export type GcsCompiledTemplate = { nodes: GcsTplNode[]; source: string; lines: number[] };

/** Tagurile cunoscute (inclusiv cele de închidere și ramurile). */
export const TEMPLATE_TAGS = [
  "if",
  "elsif",
  "else",
  "endif",
  "unless",
  "endunless",
  "case",
  "when",
  "endcase",
  "for",
  "endfor",
  "break",
  "continue",
  "assign",
  "capture",
  "endcapture",
  "comment",
  "endcomment",
  "raw",
  "endraw",
  "include",
  "hook",
  "slot",
  ...TEMPLATE_COMPONENTS,
] as const;

/** Numele filtrelor; implementarea e în `filters.ts` (testul verifică să fie aceleași). */
export const TEMPLATE_FILTERS = [
  "abs",
  "append",
  "capitalize",
  "ceil",
  "compact",
  "date",
  "default",
  "divided_by",
  "downcase",
  "escape",
  "first",
  "floor",
  "join",
  "last",
  "lstrip",
  "map",
  "minus",
  "modulo",
  "newline_to_br",
  "number",
  "plus",
  "prepend",
  "remove",
  "replace",
  "reverse",
  "round",
  "rstrip",
  "size",
  "slice",
  "sort",
  "split",
  "strip",
  "t",
  "times",
  "tint",
  "truncate",
  "truncatewords",
  "uniq",
  "upcase",
  "url_encode",
  "where",
] as const;
const FILTERS = new Set<string>(TEMPLATE_FILTERS);

const NAME_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
/** Numele unui slot sau al unui punct de extensie: `content`, `postbit.after_fields`. */
export const isTemplateName = (v: string) => v.length <= 80 && NAME_RE.test(v);

// ─── Poziții ─────────────────────────────────────────────────────────────────

/** Începutul fiecărui rând (offset), pentru a transforma un offset în rând:coloană. */
export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function positionOf(lines: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lines[lo]! + 1 };
}

// ─── Lexer ───────────────────────────────────────────────────────────────────

type RawToken =
  | { type: "text"; value: string }
  | { type: "output"; body: string; start: number; bodyStart: number }
  | { type: "tag"; name: string; args: string; start: number; argsStart: number };

/** Spațiile de la începutul / sfârșitul unui text (pentru `-` din `{{-` și `-}}`). */
const trimEnd = (s: string) => s.replace(/\s+$/, "");
const trimStart = (s: string) => s.replace(/^\s+/, "");

function lex(source: string, fail: (code: GcsTemplateErrorCode, offset: number, detail?: string) => never): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  let trimNext = false;
  const pushText = (value: string) => {
    let v = value;
    if (trimNext) {
      v = trimStart(v);
      trimNext = false;
    }
    if (v) tokens.push({ type: "text", value: v });
  };
  const trimPrevious = () => {
    const last = tokens[tokens.length - 1];
    if (last?.type === "text") {
      last.value = trimEnd(last.value);
      if (!last.value) tokens.pop();
    }
  };

  while (i < source.length) {
    const open = source.slice(i).search(/\{[{%]/);
    if (open === -1) {
      pushText(source.slice(i));
      break;
    }
    const start = i + open;
    if (start > i) pushText(source.slice(i, start));
    else trimNext = false;
    const isOutput = source[start + 1] === "{";
    let bodyStart = start + 2;
    if (source[bodyStart] === "-") {
      bodyStart++;
      trimPrevious();
    }
    // Închiderea: `}}` sau `%}`, ignorând ce e între ghilimele.
    const close = isOutput ? "}}" : "%}";
    let quote: string | null = null;
    let end = -1;
    for (let j = bodyStart; j < source.length; j++) {
      const c = source[j]!;
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === close[0] && source[j + 1] === close[1]) {
        end = j;
        break;
      }
    }
    if (end === -1) fail(isOutput ? "unclosed_output" : "unclosed_tag", start);
    let bodyEnd = end;
    let trimAfter = false;
    if (bodyEnd > bodyStart && source[bodyEnd - 1] === "-") {
      bodyEnd--;
      trimAfter = true;
    }
    const body = source.slice(bodyStart, bodyEnd);
    i = end + 2;
    if (isOutput) {
      tokens.push({ type: "output", body, start, bodyStart });
      trimNext = trimAfter;
      continue;
    }
    const m = /^\s*([a-z_]+)?/.exec(body)!;
    const name = m[1] ?? "";
    const argsStart = bodyStart + m[0].length;
    const args = body.slice(m[0].length);
    if (name === "raw" || name === "comment") {
      // Conținutul nu se parsează: textul exact (`raw`) sau nimic (`comment`), până la tagul de închidere.
      const endRe = name === "raw" ? /\{%-?\s*endraw\s*-?%\}/g : /\{%-?\s*endcomment\s*-?%\}/g;
      endRe.lastIndex = i;
      const found = endRe.exec(source);
      if (!found) fail("unclosed_block", start, name);
      if (name === "raw") {
        let text = source.slice(i, found.index);
        if (trimAfter) text = trimStart(text);
        if (found[0].startsWith("{%-")) text = trimEnd(text);
        trimNext = false;
        if (text) tokens.push({ type: "text", value: text });
      }
      i = found.index + found[0].length;
      trimNext = found[0].endsWith("-%}");
      continue;
    }
    tokens.push({ type: "tag", name, args, start, argsStart });
    trimNext = trimAfter;
  }
  return tokens;
}

// ─── Expresii ────────────────────────────────────────────────────────────────

type ETok = { t: "str" | "num" | "id" | "op" | "p"; v: string; n?: number; pos: number };

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/;
const NUM_RE = /^-?\d+(?:\.\d+)?/;

function tokenizeExpr(text: string, base: number, fail: (code: GcsTemplateErrorCode, offset: number, detail?: string) => never): ETok[] {
  const out: ETok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const pos = base + i;
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end === -1) fail("unclosed_string", pos);
      out.push({ t: "str", v: text.slice(i + 1, end), pos });
      i = end + 1;
      continue;
    }
    const rest = text.slice(i);
    const num = NUM_RE.exec(rest);
    if (num && (c !== "-" || /\d/.test(rest[1] ?? ""))) {
      out.push({ t: "num", v: num[0], n: Number(num[0]), pos });
      i += num[0].length;
      continue;
    }
    const id = IDENT_RE.exec(rest);
    if (id) {
      out.push({ t: "id", v: id[0], pos });
      i += id[0].length;
      continue;
    }
    const two = rest.slice(0, 2);
    if (["==", "!=", "<>", "<=", ">=", ".."].includes(two)) {
      out.push({ t: two === ".." ? "p" : "op", v: two, pos });
      i += 2;
      continue;
    }
    if ("<>=".includes(c)) {
      out.push({ t: "op", v: c, pos });
      i++;
      continue;
    }
    if (".[]()|:,".includes(c)) {
      out.push({ t: "p", v: c, pos });
      i++;
      continue;
    }
    fail("unexpected_char", pos, c);
  }
  return out;
}

const KEYWORD_LITERALS: Record<string, unknown> = { true: true, false: false, nil: null, null: null };
const COMPARISONS = new Set(["==", "!=", "<>", "<", ">", "<=", ">="]);

/** Parserul unei expresii (o listă de tokenuri), cu poziția de final pentru erori. */
class ExprParser {
  i = 0;
  constructor(
    private readonly toks: ETok[],
    private readonly end: number,
    private readonly fail: (code: GcsTemplateErrorCode, offset: number, detail?: string) => never,
  ) {}

  peek(): ETok | undefined {
    return this.toks[this.i];
  }
  done(): boolean {
    return this.i >= this.toks.length;
  }
  isP(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === "p" && t.v === v;
  }
  isId(v?: string): boolean {
    const t = this.peek();
    return !!t && t.t === "id" && (v === undefined || t.v === v);
  }
  next(): ETok {
    const t = this.toks[this.i++];
    if (!t) this.fail("unexpected_end", this.end);
    return t;
  }
  expectP(v: string): ETok {
    const t = this.next();
    if (t.t !== "p" || t.v !== v) this.fail("unexpected_token", t.pos, t.v);
    return t;
  }
  expectId(): ETok {
    const t = this.next();
    if (t.t !== "id") this.fail("unexpected_token", t.pos, t.v);
    return t;
  }
  finish(): void {
    const t = this.peek();
    if (t) this.fail("unexpected_token", t.pos, t.v);
  }

  /** `expr | filtru: a, b, cheie: c | alt_filtru` */
  filtered(): GcsTplFiltered {
    const e = this.or();
    const filters: GcsTplFilter[] = [];
    while (this.isP("|")) {
      this.next();
      const name = this.expectId();
      if (!FILTERS.has(name.v)) this.fail("unknown_filter", name.pos, name.v);
      const args: GcsTplArgs = { args: [], named: [] };
      if (this.isP(":")) {
        this.next();
        this.argList(args);
      }
      filters.push({ name: name.v, pos: name.pos, ...args });
    }
    return { e, filters };
  }

  /** Argumente separate prin virgulă: poziționale (`"x"`, `user.name`) sau numite (`size: "s"`). */
  argList(into: GcsTplArgs): void {
    for (;;) {
      const t = this.peek();
      const after = this.toks[this.i + 1];
      if (t?.t === "id" && after?.t === "p" && after.v === ":") {
        this.next();
        this.next();
        into.named.push([t.v, this.primary()]);
      } else {
        into.args.push(this.primary());
      }
      if (!this.isP(",")) break;
      this.next();
    }
  }

  /** Argumentele numite de după un tag (`{% include "x" a: 1, b: 2 %}`), cu virgula opțională. */
  namedList(): [string, GcsTplExpr][] {
    const named: [string, GcsTplExpr][] = [];
    while (!this.done()) {
      if (this.isP(",")) this.next();
      const key = this.expectId();
      this.expectP(":");
      named.push([key.v, this.primary()]);
    }
    return named;
  }

  or(): GcsTplExpr {
    let l = this.and();
    while (this.isId("or")) {
      const t = this.next();
      l = { k: "bin", op: "or", l, r: this.and(), pos: t.pos };
    }
    return l;
  }
  and(): GcsTplExpr {
    let l = this.not();
    while (this.isId("and")) {
      const t = this.next();
      l = { k: "bin", op: "and", l, r: this.not(), pos: t.pos };
    }
    return l;
  }
  not(): GcsTplExpr {
    if (this.isId("not")) {
      const t = this.next();
      return { k: "not", e: this.not(), pos: t.pos };
    }
    return this.cmp();
  }
  cmp(): GcsTplExpr {
    const l = this.primary();
    const t = this.peek();
    if (t && ((t.t === "op" && COMPARISONS.has(t.v)) || (t.t === "id" && t.v === "contains"))) {
      this.next();
      return { k: "bin", op: t.v === "<>" ? "!=" : t.v, l, r: this.primary(), pos: t.pos };
    }
    return l;
  }

  primary(): GcsTplExpr {
    const t = this.next();
    if (t.t === "str") return { k: "lit", v: t.v, pos: t.pos };
    if (t.t === "num") return { k: "lit", v: t.n, pos: t.pos };
    if (t.t === "p" && t.v === "(") {
      const from = this.or();
      if (this.isP("..")) {
        this.next();
        const to = this.or();
        this.expectP(")");
        return { k: "range", from, to, pos: t.pos };
      }
      this.expectP(")");
      return from;
    }
    if (t.t !== "id") this.fail("unexpected_token", t.pos, t.v);
    if (t.v in KEYWORD_LITERALS) return { k: "lit", v: KEYWORD_LITERALS[t.v], pos: t.pos };
    if (t.v === "empty" || t.v === "blank") return { k: "special", v: t.v, pos: t.pos };
    const path: (string | GcsTplExpr)[] = [t.v];
    for (;;) {
      if (this.isP(".")) {
        this.next();
        const seg = this.next();
        if (seg.t !== "id" && seg.t !== "num") this.fail("unexpected_token", seg.pos, seg.v);
        path.push(seg.v);
      } else if (this.isP("[")) {
        this.next();
        path.push(this.or());
        this.expectP("]");
      } else {
        break;
      }
    }
    return { k: "var", path, pos: t.pos };
  }
}

// ─── Parserul de blocuri ─────────────────────────────────────────────────────

/** Ce tag închide fiecare bloc, plus ramurile permise în el. */
const BLOCKS: Record<string, { end: string; branches: string[] }> = {
  if: { end: "endif", branches: ["elsif", "else"] },
  unless: { end: "endunless", branches: ["elsif", "else"] },
  case: { end: "endcase", branches: ["when", "else"] },
  for: { end: "endfor", branches: ["else"] },
  capture: { end: "endcapture", branches: [] },
};
const KNOWN_TAGS = new Set<string>(TEMPLATE_TAGS);

/**
 * Parsează un șablon. Aruncă `GcsTemplateError` cu rândul și coloana primei probleme (tag necunoscut, filtru
 * necunoscut, bloc neînchis, expresie greșită…).
 */
export function parseTemplate(source: string): GcsCompiledTemplate {
  const lines = lineStarts(source);
  const fail = (code: GcsTemplateErrorCode, offset: number, detail = ""): never => {
    const { line, column } = positionOf(lines, offset);
    throw new GcsTemplateError(code, line, column, detail);
  };
  if (source.length > TEMPLATE_MAX_SOURCE) fail("too_long", 0);
  const tokens = lex(source, fail);
  let at = 0;
  let loops = 0;

  const expr = (text: string, base: number) => new ExprParser(tokenizeExpr(text, base, fail), base + text.length, fail);

  /** Parsează noduri până la unul dintre tagurile `stop` (întors, cu argumentele lui), sau până la final. */
  function block(stop: string[], opener: { name: string; start: number } | null): { nodes: GcsTplNode[]; tag: Extract<RawToken, { type: "tag" }> | null } {
    const nodes: GcsTplNode[] = [];
    while (at < tokens.length) {
      const tok = tokens[at++]!;
      if (tok.type === "text") {
        nodes.push({ k: "text", v: tok.value });
        continue;
      }
      if (tok.type === "output") {
        const p = expr(tok.body, tok.bodyStart);
        if (p.done()) fail("unexpected_end", tok.start);
        const f = p.filtered();
        p.finish();
        nodes.push({ k: "out", pos: tok.start, ...f });
        continue;
      }
      if (stop.includes(tok.name)) return { nodes, tag: tok };
      if (!KNOWN_TAGS.has(tok.name)) fail(tok.name ? "unknown_tag" : "unexpected_token", tok.start, tok.name);
      nodes.push(tag(tok));
    }
    if (opener) fail("unclosed_block", opener.start, opener.name);
    return { nodes, tag: null };
  }

  function noArgs(tok: Extract<RawToken, { type: "tag" }>): void {
    if (tok.args.trim()) fail("unexpected_token", tok.argsStart + tok.args.search(/\S/), tok.args.trim().split(/\s+/)[0]);
  }

  function nameArg(tok: Extract<RawToken, { type: "tag" }>): string {
    const p = expr(tok.args, tok.argsStart);
    const t = p.next();
    if (t.t !== "str" || !isTemplateName(t.v)) fail("invalid_name", t.pos, t.v);
    p.finish();
    return t.v;
  }

  function tag(tok: Extract<RawToken, { type: "tag" }>): GcsTplNode {
    const pos = tok.start;
    switch (tok.name) {
      case "if":
      case "unless": {
        const branches: { cond: GcsTplExpr | null; body: GcsTplNode[] }[] = [];
        let cond: GcsTplExpr | null = condition(tok);
        if (tok.name === "unless") cond = { k: "not", e: cond, pos };
        const spec = BLOCKS[tok.name]!;
        let seenElse = false;
        for (;;) {
          const { nodes, tag: end } = block([spec.end, ...spec.branches], { name: tok.name, start: pos });
          branches.push({ cond, body: nodes });
          if (!end || end.name === spec.end) {
            if (end) noArgs(end);
            break;
          }
          if (seenElse) fail("unexpected_token", end.start, end.name);
          if (end.name === "else") {
            noArgs(end);
            seenElse = true;
            cond = null;
          } else {
            cond = condition(end);
          }
        }
        return { k: "if", branches, pos };
      }
      case "case": {
        const p = expr(tok.args, tok.argsStart);
        const e = p.or();
        p.finish();
        const whens: { values: GcsTplExpr[]; body: GcsTplNode[] }[] = [];
        let other: GcsTplNode[] | null = null;
        // Textul dintre `case` și primul `when` se ignoră (de obicei doar spații).
        let { tag: next } = block(["when", "else", "endcase"], { name: "case", start: pos });
        while (next && next.name !== "endcase") {
          if (next.name === "when") {
            const wp = expr(next.args, next.argsStart);
            const values = [wp.primary()];
            while (wp.isP(",") || wp.isId("or")) {
              wp.next();
              values.push(wp.primary());
            }
            wp.finish();
            const r = block(["when", "else", "endcase"], { name: "case", start: pos });
            whens.push({ values, body: r.nodes });
            next = r.tag;
          } else {
            noArgs(next);
            const r = block(["endcase"], { name: "case", start: pos });
            other = r.nodes;
            next = r.tag;
          }
        }
        return { k: "case", e, whens, else: other, pos };
      }
      case "for": {
        const p = expr(tok.args, tok.argsStart);
        const name = p.expectId();
        const inTok = p.expectId();
        if (inTok.v !== "in") fail("unexpected_token", inTok.pos, inTok.v);
        const coll = p.primary();
        let limit: GcsTplExpr | null = null;
        let offset: GcsTplExpr | null = null;
        let reversed = false;
        while (!p.done()) {
          if (p.isP(",")) p.next();
          const opt = p.expectId();
          if (opt.v === "reversed") {
            reversed = true;
            continue;
          }
          if (opt.v !== "limit" && opt.v !== "offset") fail("unexpected_token", opt.pos, opt.v);
          p.expectP(":");
          if (opt.v === "limit") limit = p.primary();
          else offset = p.primary();
        }
        loops++;
        const first = block(["else", "endfor"], { name: "for", start: pos });
        let other: GcsTplNode[] | null = null;
        loops--;
        if (first.tag?.name === "else") {
          noArgs(first.tag);
          const r = block(["endfor"], { name: "for", start: pos });
          other = r.nodes;
          if (r.tag) noArgs(r.tag);
        } else if (first.tag) {
          noArgs(first.tag);
        }
        return { k: "for", name: name.v, coll, limit, offset, reversed, body: first.nodes, else: other, pos };
      }
      case "break":
      case "continue":
        noArgs(tok);
        if (loops === 0) fail("break_outside_loop", pos, tok.name);
        return { k: tok.name, pos };
      case "assign": {
        const p = expr(tok.args, tok.argsStart);
        const name = p.expectId();
        const eq = p.next();
        if (eq.t !== "op" || eq.v !== "=") fail("unexpected_token", eq.pos, eq.v);
        const f = p.filtered();
        p.finish();
        return { k: "assign", name: name.v, pos, ...f };
      }
      case "capture": {
        const p = expr(tok.args, tok.argsStart);
        const name = p.expectId();
        p.finish();
        const r = block(["endcapture"], { name: "capture", start: pos });
        if (r.tag) noArgs(r.tag);
        return { k: "capture", name: name.v, body: r.nodes, pos };
      }
      case "include": {
        const p = expr(tok.args, tok.argsStart);
        const name = p.primary();
        if (name.k === "lit" && (typeof name.v !== "string" || !isTemplateName(name.v))) fail("invalid_name", name.pos, String(name.v));
        return { k: "include", name, named: p.namedList(), pos };
      }
      case "hook": {
        const p = expr(tok.args, tok.argsStart);
        const name = p.primary();
        if (name.k !== "lit" || typeof name.v !== "string" || !isTemplateName(name.v)) fail("invalid_name", name.pos, String(name.k === "lit" ? name.v : ""));
        p.finish();
        return { k: "hook", name, pos };
      }
      case "slot":
        return { k: "slot", name: nameArg(tok), pos };
      case "icon":
      case "avatar":
      case "username":
      case "time": {
        const p = expr(tok.args, tok.argsStart);
        const args: GcsTplArgs = { args: [], named: [] };
        if (p.done()) fail("unexpected_end", tok.argsStart);
        p.argList(args);
        p.finish();
        return { k: "component", name: tok.name, pos, ...args };
      }
      default:
        // Ramuri sau închideri fără blocul lor (`endif` singur, `else` în afara unui `if`…).
        return fail("unmatched_end", pos, tok.name);
    }
  }

  function condition(tok: Extract<RawToken, { type: "tag" }>): GcsTplExpr {
    const p = expr(tok.args, tok.argsStart);
    if (p.done()) fail("unexpected_end", tok.argsStart);
    const e = p.or();
    p.finish();
    return e;
  }

  const { nodes, tag: stray } = block([], null);
  if (stray) fail("unmatched_end", stray.start, stray.name);
  return { nodes, source, lines };
}

/** Validează un nume de cheie de șablon (`grup.nume`). */
export const isTemplateKey = (v: unknown): v is string => typeof v === "string" && isTemplateName(v) && v.includes(".");
