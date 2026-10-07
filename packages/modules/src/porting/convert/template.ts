/**
 * Conversia șabloanelor sursei în funcții de randare pentru `server.mjs`.
 *
 * 1. Lexerul sintaxei (`brace`: `{{if}}`, `{lang="…"}`, `{$var}`; `tag`: `<ns:if is="…">`, `{{ phrase('…') }}`, `{$var}`)
 *    înlocuiește fiecare construcție de șablon cu un marcaj (caractere din zona privată Unicode);
 * 2. HTML-ul cu marcaje e rescris pentru sanitizer-ul pluginurilor: clasele prefixate `gcsp-`, `id` → clasă, fără
 *    `style`/`on*`, `data-*` → `data-gcsp-*`, `h1` → `h2`, fără `<script>`/`<style>`, iconițele → `<gcs-icon>`;
 * 3. Marcajele devin un arbore (HTML, valori, fraze, `if`, `foreach`, `include`, `TODO`), emis apoi ca JavaScript.
 *
 * Textele sursei intră în cod doar prin `JSON.stringify` sau ca comentarii pe un rând curățate (`commentText`):
 * un șablon ostil nu poate injecta cod în plugin. Nimic din șablon nu se execută la conversie.
 */
import { PLUGIN_GCS_CLASSES } from "@gcs/core";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { commentText } from "../text";
import type { GcsPortTemplateSyntax } from "../types";

/** O valoare din datele șablonului: o cale simplă (`item.title`) sau o expresie nerecunoscută (rămâne `TODO`). */
export type GcsTplExpr = { path: string[] } | { raw: string };
export type GcsTplCond = { expr: GcsTplExpr; negate: boolean };

export type GcsTplNode =
  | { t: "html"; html: string }
  | { t: "out"; expr: GcsTplExpr; filter?: "number" | "date" }
  | { t: "phrase"; key: string; params: { name: string; expr: GcsTplExpr }[] }
  | { t: "setting"; key: string }
  | { t: "if"; branches: { cond: GcsTplCond; body: GcsTplNode[] }[]; otherwise: GcsTplNode[] | null }
  | { t: "for"; expr: GcsTplExpr; item: string; key: string | null; body: GcsTplNode[] }
  | { t: "include"; name: string }
  | { t: "todo"; raw: string; text?: string };

/** Ce a găsit conversia (pentru raport și pentru comentariile din funcție). */
export type GcsTplStats = { todos: number; dropped: { scripts: number; styles: number; inlineStyles: number; handlers: number; forms: number } };

/** O construcție găsită de lexer (înlocuită în HTML cu un marcaj). */
type Token =
  | { k: "if"; cond: GcsTplCond }
  | { k: "elseif"; cond: GcsTplCond }
  | { k: "else" }
  | { k: "endif" }
  | { k: "for"; expr: GcsTplExpr; item: string; key: string | null }
  | { k: "endfor" }
  | { k: "node"; node: GcsTplNode };

const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";
const MARK_RE = /\uE000(\d+)\uE001/g;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const todo = (raw: string, text?: string): Token => ({ k: "node", node: { t: "todo", raw, ...(text !== undefined ? { text } : {}) } });

// ─── Expresiile ───

/**
 * O expresie simplă ca o cale: `$item->title`, `$item['title']`, `$item.title`, `count($items)`, `isset($x)`.
 * Orice altceva (operatori, apeluri, literali) rămâne expresie brută.
 */
export function parsePath(raw: string): GcsTplExpr {
  let s = raw.trim();
  for (let i = 0; i < 3; i++) {
    const call = /^\\?(?:count|isset|is_array|is_countable|trim)\s*\(([\s\S]*)\)$/i.exec(s);
    if (call) s = call[1]!.trim();
    else if (/^\(([\s\S]*)\)$/.test(s)) s = s.slice(1, -1).trim();
  }
  const m = /^\$([A-Za-z_]\w*)((?:->\w+|\.\w+|\[\s*(?:'[\w-]+'|"[\w-]+"|\d+)\s*\])*)$/.exec(s);
  if (!m) return { raw: raw.trim() };
  const path = [m[1]!];
  for (const seg of m[2]!.matchAll(/->(\w+)|\.(\w+)|\[\s*(?:'([\w-]+)'|"([\w-]+)"|(\d+))\s*\]/g)) path.push(seg[1] ?? seg[2] ?? seg[3] ?? seg[4] ?? seg[5]!);
  return path.length <= 8 ? { path } : { raw: raw.trim() };
}

/** O condiție: o cale, eventual negată (`!$x`, `empty($x)`, `$x is empty`). */
export function parseCond(raw: string): GcsTplCond {
  let s = raw.trim();
  let negate = false;
  for (;;) {
    if (s.startsWith("!") && !s.startsWith("!=")) {
      negate = !negate;
      s = s.slice(1).trim();
      continue;
    }
    const empty = /^\\?empty\s*\(([\s\S]*)\)$/i.exec(s);
    if (empty) {
      negate = !negate;
      s = empty[1]!.trim();
      continue;
    }
    const isEmpty = /^([\s\S]+?)\s+is\s+(not\s+)?empty$/i.exec(s);
    if (isEmpty) {
      negate = isEmpty[2] ? negate : !negate;
      s = isEmpty[1]!.trim();
      continue;
    }
    break;
  }
  const expr = parsePath(s);
  return "path" in expr ? { expr, negate } : { expr: { raw: raw.trim() }, negate: false };
}

/** Atributele `nume="valoare"` ale unei construcții (`lang="x" sprintf="$a"`, `is="$x"`). */
function attrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? "";
  return out;
}

/** Argumentele unei liste separate prin virgulă, la nivelul de sus (fără virgulele din paranteze sau șiruri). */
function splitTop(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      cur += c;
      if (c === "\\") cur += src[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ─── Lexerele ───

/** Sfârșitul unei construcții `{…}` care începe la `start` (ghilimelele pot conține `}`); -1 dacă nu se închide. */
function closingBrace(src: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "}") return i;
    else if (c === "{" || c === "\n") return -1;
  }
  return -1;
}

function braceStatement(body: string): Token {
  const s = body.trim();
  const word = /^(\w+)\b\s*([\s\S]*)$/.exec(s);
  const kw = word?.[1]?.toLowerCase();
  const rest = word?.[2] ?? "";
  if (kw === "if") return { k: "if", cond: parseCond(rest) };
  if (kw === "elseif") return { k: "elseif", cond: parseCond(rest) };
  if (kw === "else") return /^if\b/i.test(rest) ? { k: "elseif", cond: parseCond(rest.slice(2)) } : { k: "else" };
  if (kw === "endif") return { k: "endif" };
  if (kw === "foreach") {
    const m = /^([\s\S]+?)\s+as\s+(?:\$(\w+)\s*=>\s*)?\$(\w+)\s*$/i.exec(rest);
    return m ? { k: "for", expr: parsePath(m[1]!), item: m[3]!, key: m[2] ?? null } : { k: "for", expr: { raw: rest }, item: "item", key: null };
  }
  if (kw === "for" || kw === "while") return { k: "for", expr: { raw: s }, item: "item", key: null };
  if (kw === "endforeach" || kw === "endfor" || kw === "endwhile") return { k: "endfor" };
  return todo(`{{${s}}}`);
}

function braceTag(body: string, raw: string): Token {
  if (body.startsWith("$")) {
    const [expr] = body.split("|");
    return { k: "node", node: { t: "out", expr: parsePath(expr!) } };
  }
  const a = attrs(body);
  const kind = /^(\w+)\s*=/.exec(body)?.[1]?.toLowerCase() ?? "";
  switch (kind) {
    case "lang": {
      if (!/^[\w.-]{1,120}$/.test(a.lang ?? "")) return todo(raw);
      const list = a.sprintf ?? a.htmlsprintf ?? a.pluralize ?? "";
      const params = list ? splitTop(list).map((p, i) => ({ name: `p${i + 1}`, expr: parsePath(p) })) : [];
      return { k: "node", node: { t: "phrase", key: a.lang!, params } };
    }
    case "setting":
      return /^[\w.-]{1,80}$/.test(a.setting ?? "") ? { k: "node", node: { t: "setting", key: a.setting! } } : todo(raw);
    case "expression":
    case "truncate":
    case "wordbreak":
      return { k: "node", node: { t: "out", expr: parsePath(a[kind] ?? "") } };
    case "number":
      return { k: "node", node: { t: "out", expr: parsePath(a.number ?? ""), filter: "number" } };
    case "datetime":
    case "date":
      return { k: "node", node: { t: "out", expr: parsePath(a[kind] ?? ""), filter: "date" } };
    case "template":
      return /^\w{1,80}$/.test(a.template ?? "") ? { k: "node", node: { t: "include", name: `${a.location || "front"}/${a.group || "global"}/${a.template}` } } : todo(raw);
    case "url":
      return todo(raw, "#");
    default:
      return todo(raw, "");
  }
}

/** Sintaxa `brace`: `{{instrucțiune}}` și `{tip="…"}` / `{$var}`. */
function lexBrace(src: string): (string | Token)[] {
  const out: (string | Token)[] = [];
  let text = "";
  let i = 0;
  // Fără `}}` mai departe, restul `{{` sunt text (fără căutări repetate până la capăt).
  let statements = true;
  while (i < src.length) {
    if (statements && src.startsWith("{{", i)) {
      const end = src.indexOf("}}", i + 2);
      if (end === -1) statements = false;
      if (end !== -1) {
        out.push(text, braceStatement(src.slice(i + 2, end)));
        text = "";
        i = end + 2;
        continue;
      }
    }
    if (src[i] === "{" && /^\{(?:\$|[a-z]+=)/.test(src.slice(i, i + 20))) {
      const end = closingBrace(src, i);
      if (end !== -1) {
        const raw = src.slice(i, end + 1);
        out.push(text, braceTag(raw.slice(1, -1), raw));
        text = "";
        i = end + 1;
        continue;
      }
    }
    text += src[i]!;
    i++;
  }
  out.push(text);
  return out;
}

/** O interpolare `{{ … }}` din sintaxa `tag`: fraze, valori, filtre simple; restul rămâne `TODO`. */
function tagInterpolation(body: string, raw: string): Token {
  const s = body.trim();
  const phrase = /^phrase\(\s*(['"])([\w.-]{1,120})\1\s*(?:,\s*\{([\s\S]*)\})?\s*\)$/.exec(s);
  if (phrase) {
    const params = phrase[3]
      ? splitTop(phrase[3])
          .map((p) => /^(['"])(\w{1,40})\1\s*:\s*([\s\S]+)$/.exec(p))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => ({ name: m[2]!, expr: parsePath(m[3]!) }))
      : [];
    return { k: "node", node: { t: "phrase", key: phrase[2]!, params } };
  }
  const filtered = /^([\s\S]+?)\|\s*(\w+)(?:\([^)]*\))?$/.exec(s);
  const base = filtered ? filtered[1]! : s;
  const filter = filtered?.[2]?.toLowerCase();
  const expr = parsePath(base);
  if ("path" in expr) return { k: "node", node: { t: "out", expr, ...(filter === "number" || filter === "number_short" ? { filter: "number" as const } : filter === "date" ? { filter: "date" as const } : {}) } };
  if (/^(?:link|base_url|link_type)\(/.test(s)) return todo(raw, "#");
  return todo(raw, "");
}

/** Taguri cu spațiu de nume ale căror conținut nu se păstrează (comentarii, scripturi, stiluri inline, atribuiri). */
const TAG_DROP_CONTENT = new Set(["comment", "js", "css", "set", "head", "macro", "extension", "extends"]);

/** Sintaxa `tag`: `<ns:if is="…">`, `<ns:foreach loop="…" value="…">`, `{{ … }}`, `{$var}`. */
function lexTag(src: string, templateType: string): (string | Token)[] {
  const out: (string | Token)[] = [];
  let text = "";
  const re = /<(\/?)([a-z][a-z0-9]{0,9}):([a-z][a-z0-9_]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>|\{\{([\s\S]*?)\}\}|\{(\$[A-Za-z_][\w.]*(?:\|\w+)?)\}/g;
  let last = 0;
  const unclosed = new Set<string>();
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    text += src.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[6] !== undefined) {
      out.push(text, tagInterpolation(m[6], m[0]));
      text = "";
      continue;
    }
    if (m[7] !== undefined) {
      const [path, filter] = m[7].split("|");
      out.push(text, { k: "node", node: { t: "out", expr: parsePath(path!), ...(filter === "number" ? { filter: "number" as const } : filter === "date" ? { filter: "date" as const } : {}) } });
      text = "";
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[3]!.toLowerCase();
    const selfClosing = m[5] === "/";
    const a = attrs(m[4] ?? "");
    let token: Token | string | null = null;
    switch (tag) {
      case "if":
        token = closing ? { k: "endif" } : { k: "if", cond: parseCond((a.is ?? "").replace(/^\{|\}$/g, "")) };
        break;
      case "elseif":
        token = { k: "elseif", cond: parseCond((a.is ?? "").replace(/^\{|\}$/g, "")) };
        break;
      case "else":
        token = { k: "else" };
        break;
      case "foreach":
        token = closing
          ? { k: "endfor" }
          : { k: "for", expr: parsePath((a.loop ?? "").replace(/^\{|\}$/g, "")), item: (a.value ?? "$item").replace(/^\$/, "").replace(/\W/g, "") || "item", key: a.key ? a.key.replace(/^\$/, "").replace(/\W/g, "") || null : null };
        break;
      // Comentariile dispar; CSS-ul inclus e deja în `assets/style.css`.
      case "contentcheck":
      case "comment":
      case "css":
        token = "";
        break;
      case "title":
      case "h1":
        token = closing ? "</h2>" : '<h2 class="gcsp-title">';
        break;
      case "description":
        token = closing ? "</p>" : '<p class="gcsp-description">';
        break;
      case "fa": {
        const icon = /^(?:fa-(?:solid|regular|brands)\s+)?(fa-[a-z0-9-]{1,60})$/.exec((a.icon ?? "").trim())?.[1];
        token = icon && isGcsIcon(`fa-solid ${icon}`) ? `<gcs-icon name="fa-solid ${icon}"></gcs-icon>` : "";
        break;
      }
      case "username":
        token = closing ? "" : { k: "node", node: { t: "out", expr: (() => {
          const e = parsePath((a.user ?? "").replace(/^\{|\}$/g, ""));
          return "path" in e ? { path: [...e.path, "username"] } : e;
        })() } };
        break;
      case "date":
        token = closing ? "" : { k: "node", node: { t: "out", expr: parsePath((a.time ?? "").replace(/^\{|\}$/g, "")), filter: "date" } };
        break;
      case "include": {
        const name = (a.template ?? "").replace(/^[a-z]+:/, "");
        token = /^[\w.-]{1,80}$/.test(name) ? { k: "node", node: { t: "include", name: `${/^([a-z]+):/.exec(a.template ?? "")?.[1] ?? templateType}:${name}` } } : todo(m[0]);
        break;
      }
      default:
        token = todo(m[0]);
    }
    // Conținutul tagurilor eliminate (comentarii, scripturi inline, atribuiri) dispare cu tot cu ele.
    const closeTag = `</${m[2]}:${m[3]}>`;
    if (!closing && !selfClosing && TAG_DROP_CONTENT.has(tag) && !unclosed.has(closeTag)) {
      const close = src.indexOf(closeTag, last);
      // Un tag fără închidere nu se mai caută (un șablon ostil cu mii de taguri deschise nu face citirea pătratică).
      if (close === -1) unclosed.add(closeTag);
      else {
        last = close + closeTag.length;
        re.lastIndex = last;
      }
    }
    if (typeof token === "string") text += token;
    else {
      out.push(text, token);
      text = "";
    }
  }
  out.push(text + src.slice(last));
  return out;
}

// ─── Rescrierea HTML-ului ───

const GCS_CLASSES = new Set<string>(PLUGIN_GCS_CLASSES);

/** Clasa prefixată `gcsp-` (aceeași funcție pentru HTML și pentru selectorii CSS). Marcajele rămân neatinse. */
export function prefixClass(name: string): string {
  if (name.startsWith("gcsp-") || GCS_CLASSES.has(name) || name.startsWith(MARK_OPEN)) return name;
  return `gcsp-${name.replace(/[^A-Za-z0-9_\-\uE000-\uE001]/g, "-")}`;
}

const ATTR_RE = /\s*(?:(\uE000\d+\uE001)|([^\s"'=<>/`\uE000]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?)/g;
/** Taguri interactive (formulare): sanitizer-ul pluginurilor le scoate; le numărăm pentru `TODO`. */
const FORM_TAGS = new Set(["form", "input", "select", "textarea", "button"]);

function iconTag(classes: string): string | null {
  const names = classes.split(/\s+/);
  const icon = names.find((c) => /^fa-[a-z0-9-]+$/.test(c) && !/^fa-(?:solid|regular|brands|light|duotone|fw|lg|xs|sm|[0-9]x|spin|pulse|border|pull-left|pull-right|inverse|stack|li|ul)$/.test(c));
  if (!icon || !names.some((c) => /^fa[srb]?$|^fa-(?:solid|regular|brands)$/.test(c))) return null;
  const style = names.includes("fa-regular") || names.includes("far") ? "fa-regular" : names.includes("fa-brands") || names.includes("fab") ? "fa-brands" : "fa-solid";
  return isGcsIcon(`${style} ${icon}`) ? `<gcs-icon name="${style} ${icon}"></gcs-icon>` : null;
}

/** Rescrie HTML-ul (cu marcaje) pentru sanitizer-ul pluginurilor și numără ce s-a scos. */
export function rewriteHtml(html: string, stats: GcsTplStats): string {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, () => {
      stats.dropped.scripts++;
      return "";
    })
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, () => {
      stats.dropped.styles++;
      return "";
    });
  // Iconițele Font Awesome goale (`<i class="fa fa-star"></i>`) devin `<gcs-icon>`.
  out = out.replace(/<i\b((?:[^<>"']|"[^"]*"|'[^']*')*)>\s*<\/i\s*>/gi, (m, attrText: string) => {
    const cls = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrText);
    return (cls && iconTag(cls[1] ?? cls[2] ?? "")) ?? m;
  });
  return out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g, (_m, slash: string, rawName: string, rawAttrs: string) => {
    let name = rawName.toLowerCase();
    if (name === "h1") name = "h2";
    if (FORM_TAGS.has(name) && !slash) stats.dropped.forms++;
    if (slash) return `</${name}>`;
    const selfClose = /\/\s*$/.test(rawAttrs);
    const parts: string[] = [];
    const extraClasses: string[] = [];
    let classIndex = -1;
    for (const a of (selfClose ? rawAttrs.replace(/\/\s*$/, "") : rawAttrs).matchAll(ATTR_RE)) {
      if (a[1]) {
        parts.push(a[1]);
        continue;
      }
      const attr = a[2]?.toLowerCase();
      if (!attr) continue;
      const rawValue = a[3];
      const value = rawValue === undefined ? undefined : /^["']/.test(rawValue) ? rawValue.slice(1, -1) : rawValue;
      if (attr === "style") {
        stats.dropped.inlineStyles++;
        continue;
      }
      if (attr.startsWith("on")) {
        stats.dropped.handlers++;
        continue;
      }
      if (attr === "id") {
        if (value && /^[A-Za-z][\w-]*$/.test(value)) extraClasses.push(`gcsp-id-${value}`);
        continue;
      }
      if (attr === "class") {
        classIndex = parts.length;
        parts.push(`class="${(value ?? "").split(/\s+/).filter(Boolean).map(prefixClass).join(" ")}"`);
        continue;
      }
      const finalName = attr.startsWith("data-") && !attr.startsWith("data-gcsp-") ? `data-gcsp-${attr.slice(5)}` : attr;
      parts.push(value === undefined ? finalName : `${finalName}="${value.replace(/"/g, "&quot;")}"`);
    }
    if (extraClasses.length) {
      if (classIndex === -1) parts.push(`class="${extraClasses.join(" ")}"`);
      else parts[classIndex] = parts[classIndex]!.replace(/"$/, ` ${extraClasses.join(" ")}"`);
    }
    return `<${name}${parts.length ? ` ${parts.join(" ")}` : ""}${selfClose ? " /" : ""}>`;
  });
}

// ─── Arborele ───

const MAX_NESTING = 32;

/** Construiește arborele din lista de bucăți HTML și construcții. Blocurile neînchise se închid la final. */
function buildTree(seq: (string | Token)[], stats: GcsTplStats): GcsTplNode[] {
  type Frame = { kind: "root" } | { kind: "if"; node: Extract<GcsTplNode, { t: "if" }>; target: GcsTplNode[] } | { kind: "for"; node: Extract<GcsTplNode, { t: "for" }> };
  const root: GcsTplNode[] = [];
  const stack: { frame: Frame; body: GcsTplNode[] }[] = [{ frame: { kind: "root" }, body: root }];
  const top = () => stack[stack.length - 1]!;
  // Peste `MAX_NESTING` niveluri, blocurile devin `TODO` (conținutul rămâne): emiterea recursivă are adâncimea mărginită.
  let ignored = 0;
  for (const part of seq) {
    if (typeof part === "string") {
      if (part) top().body.push({ t: "html", html: part });
      continue;
    }
    const opens = part.k === "if" || part.k === "for";
    if (part.k !== "node" && (ignored > 0 || (opens && stack.length > MAX_NESTING))) {
      if (opens) ignored++;
      else if (part.k === "endif" || part.k === "endfor") ignored--;
      stats.todos++;
      top().body.push({ t: "todo", raw: part.k });
      continue;
    }
    switch (part.k) {
      case "node":
        if (part.node.t === "todo") stats.todos++;
        top().body.push(part.node);
        break;
      case "if": {
        const node: Extract<GcsTplNode, { t: "if" }> = { t: "if", branches: [{ cond: part.cond, body: [] }], otherwise: null };
        top().body.push(node);
        stack.push({ frame: { kind: "if", node, target: node.branches[0]!.body }, body: node.branches[0]!.body });
        break;
      }
      case "elseif":
      case "else": {
        const f = top().frame;
        if (f.kind !== "if") {
          stats.todos++;
          top().body.push({ t: "todo", raw: part.k === "else" ? "else" : "elseif" });
          break;
        }
        const body: GcsTplNode[] = [];
        if (part.k === "elseif") f.node.branches.push({ cond: part.cond, body });
        else f.node.otherwise = body;
        stack[stack.length - 1] = { frame: f, body };
        break;
      }
      case "endif":
        if (top().frame.kind === "if") stack.pop();
        break;
      case "for": {
        const node: Extract<GcsTplNode, { t: "for" }> = { t: "for", expr: part.expr, item: part.item, key: part.key, body: [] };
        top().body.push(node);
        stack.push({ frame: { kind: "for", node }, body: node.body });
        break;
      }
      case "endfor":
        if (top().frame.kind === "for") stack.pop();
        break;
    }
  }
  return root;
}

/** Șablonul ca arbore, cu statisticile conversiei. */
export function parseTemplate(body: string, syntax: GcsPortTemplateSyntax, templateType = "public"): { nodes: GcsTplNode[]; stats: GcsTplStats } {
  const stats: GcsTplStats = { todos: 0, dropped: { scripts: 0, styles: 0, inlineStyles: 0, handlers: 0, forms: 0 } };
  const seq = syntax === "brace" ? lexBrace(body) : lexTag(body, templateType);
  // Construcțiile devin marcaje, HTML-ul se rescrie, apoi marcajele se pun înapoi ca noduri.
  const tokens: Token[] = [];
  let marked = "";
  for (const part of seq) {
    if (typeof part === "string") marked += part.replace(/[\uE000\uE001]/g, "");
    else marked += `${MARK_OPEN}${tokens.push(part) - 1}${MARK_CLOSE}`;
  }
  const rewritten = rewriteHtml(marked, stats);
  const parts: (string | Token)[] = [];
  let last = 0;
  for (const m of rewritten.matchAll(MARK_RE)) {
    parts.push(rewritten.slice(last, m.index), tokens[Number(m[1])]!);
    last = m.index! + m[0].length;
  }
  parts.push(rewritten.slice(last));
  return { nodes: buildTree(parts, stats), stats };
}

// ─── Emiterea JavaScript ───

export type GcsTplEmitContext = {
  /** Cheia frazei în `lang/*.json` a pluginului pentru o cheie a sursei (`null` = fraza nu există). */
  phrase: (key: string) => string | null;
  /** Cheia setării pluginului pentru o cheie a sursei (`null` = nu există). */
  setting: (key: string) => string | null;
  /** Numele funcției unui alt șablon (pentru `include`), dacă e convertit. */
  template: (name: string) => string | null;
};

const lit = (s: string) => JSON.stringify(s);

/** Codul JavaScript al corpului unei funcții de randare (`d0` = datele, `ctx` = contextul pluginului). */
export function emitTemplate(nodes: GcsTplNode[], ctx: GcsTplEmitContext, indent = "  "): string {
  const lines: string[] = [];
  let depth = 0;
  const scopes: string[] = ["d0"];
  const push = (line: string) => lines.push(`${indent}${"  ".repeat(depth)}${line}`);
  // Segmentele căilor sunt doar `[A-Za-z0-9_-]` (vezi `parsePath`), deci tabloul JSON e un literal JavaScript sigur.
  const value = (expr: GcsTplExpr): string => ("path" in expr ? `get(${scopes[scopes.length - 1]}, ${JSON.stringify(expr.path)})` : `pending(${lit(expr.raw.slice(0, 300))})`);
  const cond = (c: GcsTplCond) => {
    if ("raw" in c.expr) return `pending(${lit(c.expr.raw.slice(0, 300))})`;
    return `${c.negate ? "!" : ""}truthy(${value(c.expr)})`;
  };
  const todoComment = (raw: string) => push(`// TODO(portare): ${commentText(raw)}`);

  const walk = (list: GcsTplNode[]) => {
    let html = "";
    const flush = () => {
      if (html) push(`h.push(${lit(html)});`);
      html = "";
    };
    for (const n of list) {
      if (n.t === "html") {
        html += n.html;
        continue;
      }
      flush();
      switch (n.t) {
        case "out":
          if ("raw" in n.expr) todoComment(n.expr.raw);
          push(`h.push(${n.filter === "number" ? "num" : n.filter === "date" ? "date" : "esc"}(ctx, ${value(n.expr)}));`);
          break;
        case "phrase": {
          const key = ctx.phrase(n.key);
          if (!key) todoComment(`fraza lipsă: ${n.key}`);
          const params = n.params.length ? `, { ${n.params.map((p) => `${lit(p.name)}: str(${value(p.expr)})`).join(", ")} }` : "";
          push(`h.push(ctx.escape(ctx.t(${lit(key ?? n.key)}${params})));`);
          break;
        }
        case "setting": {
          const key = ctx.setting(n.key);
          if (key) push(`h.push(esc(ctx, ctx.settings.get(${lit(key)})));`);
          else todoComment(`setarea lipsă: ${n.key}`);
          break;
        }
        case "include": {
          const fn = ctx.template(n.name);
          if (fn) push(`h.push(${fn}(${scopes[scopes.length - 1]}, ctx));`);
          else todoComment(`șablon inclus, neconvertit: ${n.name}`);
          break;
        }
        case "todo":
          todoComment(n.raw);
          if (n.text) push(`h.push(${lit(n.text)});`);
          break;
        case "if":
          n.branches.forEach((b, i) => {
            if ("raw" in b.cond.expr) todoComment(`condiție: ${b.cond.expr.raw}`);
            push(`${i === 0 ? "if" : "} else if"} (${cond(b.cond)}) {`);
            depth++;
            walk(b.body);
            depth--;
          });
          if (n.otherwise) {
            push("} else {");
            depth++;
            walk(n.otherwise);
            depth--;
          }
          push("}");
          break;
        case "for": {
          if ("raw" in n.expr) todoComment(`buclă: ${n.expr.raw}`);
          const parent = scopes[scopes.length - 1]!;
          const scope = `d${scopes.length}`;
          const item = IDENT.test(n.item) ? n.item : "item";
          const key = n.key && IDENT.test(n.key) ? n.key : null;
          push(`for (const [k${scopes.length}, v${scopes.length}] of entries(${value(n.expr)})) {`);
          depth++;
          push(`const ${scope} = scope(${parent}, ${lit(item)}, v${scopes.length}${key ? `, ${lit(key)}, k${scopes.length}` : ""});`);
          scopes.push(scope);
          walk(n.body);
          scopes.pop();
          depth--;
          push("}");
          break;
        }
      }
    }
    flush();
  };
  walk(nodes);
  return lines.join("\n");
}

/** Funcțiile ajutătoare folosite de șabloanele generate (incluse o singură dată în `server.mjs`). */
export const TEMPLATE_RUNTIME = `// Ajutoarele șabloanelor convertite: citiri sigure din date (fără __proto__/constructor), escapare, liste.
const BLOCKED = new Set(["__proto__", "prototype", "constructor"]);
function get(scope, path) {
  let v = scope;
  for (const p of path) {
    if (v === null || v === undefined || BLOCKED.has(p) || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, p)) return undefined;
    v = v[p];
  }
  return v;
}
function scope(parent, name, value, keyName, key) {
  const s = Object.assign(Object.create(null), parent);
  if (!BLOCKED.has(name)) s[name] = value;
  if (keyName && !BLOCKED.has(keyName)) s[keyName] = key;
  return s;
}
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v) && v !== "0";
}
function entries(v) {
  if (Array.isArray(v)) return v.map((x, i) => [i, x]);
  if (v && typeof v === "object") return Object.entries(v);
  return [];
}
function str(v) {
  return v === null || v === undefined ? "" : typeof v === "object" ? "" : String(v);
}
function esc(ctx, v) {
  return ctx.escape(str(v));
}
function num(ctx, v) {
  const n = Number(v);
  return Number.isFinite(n) ? ctx.escape(n.toLocaleString(ctx.locale)) : esc(ctx, v);
}
function date(ctx, v) {
  const d = new Date(typeof v === "number" && v < 1e11 ? v * 1000 : v);
  return Number.isNaN(d.getTime()) ? esc(ctx, v) : ctx.escape(d.toLocaleString(ctx.locale));
}
// Logica de șablon nerecunoscută (vezi TODO-ul de lângă): falsă până la portare.
function pending(_expression) {
  return undefined;
}
`;
