import { rewriteHref, type GcsConvertContext } from "./context";
import { GcsDocWriter, type GcsMark } from "./doc";
import type { GcsConvertResult } from "./html";
import { normalizeColor, parseFontSize, videoEmbed } from "./style";

/** Un nod BBCode: text sau etichetă cu opțiunea (`[QUOTE=…]`), atributele (`[ATTACH type="full"]`) și copiii. */
type BNode = { text: string } | { tag: string; option: string | null; attrs: Record<string, string>; children: BNode[]; raw: string; end: string | null };

/** Etichetele recunoscute. Restul rămân text (și se numără în raport). */
const KNOWN = new Set([
  "b", "i", "u", "s", "color", "size", "font", "left", "center", "right", "justify", "heading", "url", "email", "img", "media",
  "quote", "attach", "user", "code", "icode", "php", "html", "sql", "plain", "spoiler", "ispoiler", "list", "*", "sub", "sup",
  "hr", "indent", "table", "tr", "td", "th", "thead", "tbody", "h1", "h2", "h3", "h4",
]);
/** Conținutul acestor etichete nu se mai parsează. */
const RAW = new Set(["code", "icode", "php", "html", "sql", "plain"]);
const BLOCK = new Set(["quote", "code", "php", "html", "sql", "spoiler", "list", "left", "center", "right", "justify", "heading", "h1", "h2", "h3", "h4", "table", "tr", "indent", "hr", "media", "img", "attach"]);

const TAG = /\[(\/?)([a-z][a-z0-9]*|\*)(?:=("[^"\]]*"|'[^'\]]*'|[^\]]*?))?((?:\s+[a-z_-]+=(?:"[^"]*"|'[^']*'|[^\s\]]*))*)\s*\]/gi;
const LANGUAGE = /^[A-Za-z0-9+#-]{1,20}$/;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s[\]<>"']+[^\s[\]<>"'.,;:!?)]/gi;

const unquote = (v: string) => v.replace(/^(["'])(.*)\1$/s, "$2").trim();

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-z_-]+)=("[^"]*"|'[^']*'|[^\s\]]*)/gi)) out[m[1]!.toLowerCase()] = unquote(m[2]!);
  return out;
}

/** Parserul BBCode: o etichetă neînchisă sau o închidere fără deschidere rămân text. */
export function parseBbcode(input: string): BNode[] {
  const root: BNode[] = [];
  const stack: Extract<BNode, { tag: string }>[] = [];
  const target = () => (stack.length > 0 ? stack[stack.length - 1]!.children : root);
  const pushText = (text: string) => {
    if (!text) return;
    const list = target();
    const last = list[list.length - 1];
    if (last && "text" in last) last.text += text;
    else list.push({ text });
  };
  let pos = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(input); m; m = TAG.exec(input)) {
    const [raw, slash, nameRaw, option, attrRaw] = m;
    const name = nameRaw!.toLowerCase();
    pushText(input.slice(pos, m.index));
    pos = m.index + raw.length;
    if (!slash) {
      // `[*]` închide elementul de listă anterior.
      if (name === "*") {
        const top = stack[stack.length - 1];
        if (top?.tag === "*") {
          top.end = "";
          stack.pop();
        }
        if (!stack.some((s) => s.tag === "list")) {
          pushText(raw);
          continue;
        }
      }
      const node: Extract<BNode, { tag: string }> = { tag: name, option: option !== undefined ? unquote(option) : null, attrs: parseAttrs(attrRaw ?? ""), children: [], raw, end: null };
      if (RAW.has(name)) {
        const close = new RegExp(`\\[/${name}\\]`, "i");
        const rest = input.slice(pos);
        const end = close.exec(rest);
        if (!end) {
          pushText(raw);
          continue;
        }
        node.children.push({ text: rest.slice(0, end.index) });
        node.end = end[0];
        target().push(node);
        pos += end.index + end[0].length;
        TAG.lastIndex = pos;
        continue;
      }
      if (name === "hr") {
        node.end = "";
        target().push(node);
        continue;
      }
      target().push(node);
      stack.push(node);
      continue;
    }
    // O închidere: se închid și etichetele deschise în interior (ex. `[*]` din listă).
    const at = stack.map((s) => s.tag).lastIndexOf(name);
    if (at === -1) {
      pushText(raw);
      continue;
    }
    while (stack.length > at) {
      const done = stack.pop()!;
      done.end = done.tag === name ? raw : done.tag === "*" ? "" : null;
    }
  }
  pushText(input.slice(pos));
  return root;
}

function plain(nodes: BNode[]): string {
  return nodes.map((n) => ("text" in n ? n.text : plain(n.children))).join("");
}

/** Textul original al unei etichete necunoscute sau neînchise: `[tag=opt]` + conținut + `[/tag]`. */
function literal(n: Extract<BNode, { tag: string }>): BNode[] {
  return [{ text: n.raw }, ...n.children, ...(n.end ? [{ text: n.end }] : [])];
}

/** `[QUOTE="Nume, post: 123, member: 5"]` → numele, postarea și membrul din sursă. */
function quoteOption(option: string | null): { name: string; post: string | null; member: string | null } {
  if (!option) return { name: "", post: null, member: null };
  const post = /(?:^|,)\s*post:\s*(\d+)/i.exec(option)?.[1] ?? null;
  const member = /(?:^|,)\s*member:\s*(\d+)/i.exec(option)?.[1] ?? null;
  const name = option.replace(/,\s*(post|member|convMessage):\s*\d+/gi, "").trim();
  return { name, post, member };
}

/**
 * Convertorul conținutului `prefixed-schema` (BBCode) în documentul GCS: formatare, linkuri (rescrise), imagini https,
 * embed-uri, citate (legate de postarea nouă), mențiuni, atașamente, cod, spoilere, liste. Etichetele necunoscute
 * rămân text, iar raportul le numără.
 */
export function convertBbcode(input: string, ctx: GcsConvertContext): GcsConvertResult {
  const w = new GcsDocWriter();
  const attachments = new Set<string>();
  let newlines = 0;
  /** După un bloc (citat, cod, listă…), primul rând nou e doar despărțitorul din sursă. */
  let afterBlock = false;

  const blockBoundary = () => {
    w.endParagraph();
    newlines = 0;
    afterBlock = true;
  };

  /** Rândurile noi acumulate înaintea unui conținut inline: unul = `hardBreak`, două sau mai multe = paragraf nou. */
  const beforeInline = () => {
    if (afterBlock && newlines > 0) newlines--;
    afterBlock = false;
    if (newlines >= 2) w.endParagraph();
    else if (newlines === 1) w.hardBreak();
    newlines = 0;
  };

  const emitText = (text: string, marks: GcsMark[], autolink: boolean) => {
    const parts = text.replace(/\r\n?/g, "\n").split("\n");
    parts.forEach((part, i) => {
      if (i > 0) newlines++;
      if (part === "") return;
      beforeInline();
      if (!autolink) return w.text(part, marks);
      let last = 0;
      for (const m of part.matchAll(URL_IN_TEXT)) {
        w.text(part.slice(last, m.index), marks);
        const href = rewriteHref(m[0], ctx);
        w.text(m[0], href ? [...marks, { type: "link", attrs: { href } }] : marks);
        last = m.index! + m[0].length;
      }
      w.text(part.slice(last), marks);
    });
  };

  const walk = (nodes: BNode[], marks: GcsMark[], linked: boolean) => {
    for (const n of nodes) {
      if ("text" in n) emitText(n.text, marks, !linked);
      else tag(n, marks, linked);
    }
  };

  const tag = (n: Extract<BNode, { tag: string }>, marks: GcsMark[], linked: boolean): void => {
    if (!KNOWN.has(n.tag) || n.end === null) {
      w.unrecognized++;
      return walk(literal(n), marks, linked);
    }
    if (BLOCK.has(n.tag)) blockBoundary();
    const opt = n.option ?? "";
    switch (n.tag) {
      case "b":
        return walk(n.children, [...marks, { type: "bold" }], linked);
      case "i":
        return walk(n.children, [...marks, { type: "italic" }], linked);
      case "u":
        return walk(n.children, [...marks, { type: "underline" }], linked);
      case "s":
        return walk(n.children, [...marks, { type: "strike" }], linked);
      case "sub":
        return walk(n.children, [...marks, { type: "subscript" }], linked);
      case "sup":
        return walk(n.children, [...marks, { type: "superscript" }], linked);
      case "icode":
        return walk(n.children, [...marks, { type: "code" }], true);
      case "color": {
        const color = normalizeColor(opt);
        return walk(n.children, color ? [...marks, { type: "textStyle", attrs: { color } }] : marks, linked);
      }
      case "size": {
        const fontSize = parseFontSize(opt);
        return walk(n.children, fontSize ? [...marks, { type: "textStyle", attrs: { fontSize } }] : marks, linked);
      }
      case "font":
      case "indent":
      case "tbody":
      case "thead":
      case "ispoiler":
      case "plain":
        return walk(n.children, marks, linked || n.tag === "plain");
      case "left":
      case "center":
      case "right":
      case "justify":
        w.pushAlign(n.tag);
        walk(n.children, marks, linked);
        w.popAlign();
        return blockBoundary();
      case "heading":
      case "h1":
      case "h2":
      case "h3":
      case "h4": {
        const n1 = n.tag === "heading" ? Number(opt) || 1 : Number(n.tag[1]);
        w.textBlock("heading", { level: Math.min(4, Math.max(2, n1 + 1)) });
        walk(n.children, marks, linked);
        return blockBoundary();
      }
      case "url":
      case "email": {
        const target = (opt || plain(n.children)).trim();
        const href = n.tag === "email" ? (/^[^\s@]+@[^\s@]+$/.test(target) ? `mailto:${target}` : null) : rewriteHref(target, ctx);
        if (!href) w.unrecognized++;
        return walk(n.children, href ? [...marks, { type: "link", attrs: { href } }] : marks, true);
      }
      case "img": {
        const src = plain(n.children).trim();
        const alt = (n.attrs.alt ?? "").slice(0, 300);
        if (/^https:\/\//i.test(src) && URL.canParse(src) && !/[\s"'<>]/.test(src) && src.length <= 2000) {
          w.leaf({ type: "image", attrs: { src, ...(alt ? { alt } : {}) } });
        } else {
          const href = rewriteHref(src, ctx);
          if (href) w.text(alt || src, [...marks, { type: "link", attrs: { href } }]);
          else if (src) w.text(src, marks);
        }
        return blockBoundary();
      }
      case "media": {
        const id = plain(n.children).trim();
        const site = opt.toLowerCase();
        const url =
          site === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(id.split(":")[0]!)
            ? `https://www.youtube.com/watch?v=${id.split(":")[0]}`
            : site === "twitch"
              ? id.startsWith("clip:")
                ? `https://clips.twitch.tv/${id.slice(5)}`
                : id.startsWith("video:")
                  ? `https://www.twitch.tv/videos/${id.slice(6)}`
                  : `https://www.twitch.tv/${id}`
              : null;
        const embed = url ? videoEmbed(url) : null;
        if (embed) w.leaf({ type: "embed", attrs: { url: embed } });
        else {
          w.unrecognized++;
          if (id) w.text(`${opt}: ${id}`, marks);
        }
        return blockBoundary();
      }
      case "attach": {
        const id = plain(n.children).trim();
        const att = /^\d+$/.test(id) ? ctx.attachment(id) : null;
        if (!att) {
          w.unrecognized++;
          return blockBoundary();
        }
        attachments.add(id);
        if (att.isImage) {
          const alt = (n.attrs.alt ?? att.filename).slice(0, 300);
          w.leaf({ type: "image", attrs: { attachmentId: att.id, alt, ...(att.width ? { width: att.width } : {}), ...(att.height ? { height: att.height } : {}) } });
        } else w.text(att.filename, [...marks, { type: "link", attrs: { href: `/files/${att.id}` } }]);
        return blockBoundary();
      }
      case "user": {
        const member = ctx.member(opt) ?? ctx.memberByName(plain(n.children).replace(/^@/, "").trim());
        if (member) {
          beforeInline();
          return w.mention(member.id, member.name);
        }
        return walk(n.children, marks, linked);
      }
      case "quote": {
        const q = quoteOption(n.option);
        const post = q.post ? ctx.post(q.post) : null;
        const member = q.member ? ctx.member(q.member) : null;
        const authorName = (member?.name ?? q.name).slice(0, 40);
        if (post && authorName) w.open("quote", { postId: post.id, authorName, ...(member ? { authorId: member.id } : {}) });
        else {
          w.open("blockquote");
          if (authorName) {
            w.text(`${authorName}:`, [{ type: "bold" }]);
            w.endParagraph();
          }
        }
        newlines = 0;
        afterBlock = true;
        walk(n.children, [], false);
        w.close();
        return blockBoundary();
      }
      case "spoiler": {
        const summary = opt.slice(0, 100).trim();
        w.open("spoiler", summary ? { summary } : undefined);
        newlines = 0;
        afterBlock = true;
        walk(n.children, [], false);
        w.close();
        return blockBoundary();
      }
      case "code":
      case "php":
      case "html":
      case "sql": {
        const lang = n.tag === "code" ? opt.toLowerCase() : n.tag;
        const code = plain(n.children).replace(/^\n+/, "");
        if (code.trim()) w.leaf({ type: "codeBlock", ...(lang && LANGUAGE.test(lang) ? { attrs: { language: lang } } : {}), content: [{ type: "text", text: code }] });
        return blockBoundary();
      }
      case "list": {
        const ordered = opt !== "" && opt !== "disc" && opt !== "circle" && opt !== "square";
        const start = Number(opt);
        w.open(ordered ? "orderedList" : "bulletList", ordered && Number.isInteger(start) && start > 1 && start <= 100_000 ? { start } : undefined);
        for (const c of n.children) {
          if ("text" in c) {
            if (c.text.trim()) emitText(c.text.trim(), marks, !linked);
            continue;
          }
          if (c.tag === "*") {
            w.open("listItem");
            newlines = 0;
            afterBlock = true;
            walk(c.children, marks, linked);
            w.close();
          } else tag(c, marks, linked);
        }
        w.close();
        return blockBoundary();
      }
      case "*":
        return walk(n.children, marks, linked);
      case "hr":
        w.leaf({ type: "horizontalRule" });
        return blockBoundary();
      case "table":
        w.unrecognized++;
        walk(n.children, marks, linked);
        return blockBoundary();
      case "tr": {
        const cells = n.children.filter((c): c is Extract<BNode, { tag: string }> => !("text" in c) && (c.tag === "td" || c.tag === "th"));
        cells.forEach((cell, i) => {
          if (i > 0) w.text(" | ", marks);
          walk(cell.children, cell.tag === "th" ? [...marks, { type: "bold" }] : marks, linked);
        });
        return blockBoundary();
      }
      case "td":
      case "th":
        return walk(n.children, marks, linked);
    }
  };

  walk(parseBbcode(input), [], false);
  return { doc: w.finish(), unrecognized: w.unrecognized, attachments: [...attachments] };
}
