import type { GcsDoc } from "@gcs/core";
import { parseDocument } from "htmlparser2";
import { replaceMarkers, rewriteHref, type GcsConvertContext } from "./context";
import { GcsDocWriter, type GcsMark } from "./doc";
import { emojiFor, embedUrlFromIframe, normalizeColor, parseFontSize } from "./style";

/** Nodurile produse de `htmlparser2` (doar câmpurile folosite). */
type HNode = { type: string; name?: string; attribs?: Record<string, string>; children?: HNode[]; data?: string };

export type GcsConvertResult = { doc: GcsDoc | null; unrecognized: number; attachments: string[] };

/** Elemente fără conținut util sau periculoase: dispar cu tot cu conținut. */
const DROP = new Set(["script", "style", "noscript", "template", "object", "embed", "applet", "form", "input", "button", "select", "textarea", "svg", "math", "head", "title", "meta", "link", "base", "frame", "frameset"]);
/** Elemente cunoscute fără echivalent: doar conținutul lor rămâne. */
const TRANSPARENT = new Set(["span", "font", "section", "article", "figure", "figcaption", "header", "footer", "main", "small", "big", "abbr", "cite", "q", "ins", "nav", "aside", "address", "center", "label", "time", "html", "body", "tbody", "thead", "tfoot", "colgroup", "col", "caption", "dl", "dt", "dd", "picture", "source", "wbr"]);
const LANGUAGE = /^[A-Za-z0-9+#-]{1,20}$/;

const classesOf = (el: HNode) => (el.attribs?.class ?? "").split(/\s+/).filter(Boolean);
/** Clasa cu sufixul dat (`…Quote`, `…Spoiler_header`): marcajele conținutului vechi au un prefix propriu. */
const hasClass = (el: HNode, suffix: string) => classesOf(el).some((c) => c === suffix || c.endsWith(suffix));
/** Valoarea primului atribut al cărui nume se termină cu sufixul dat (ex. `…quote-username`). */
const attrEnding = (el: HNode, suffix: string) => Object.entries(el.attribs ?? {}).find(([k]) => k.toLowerCase().endsWith(suffix))?.[1] ?? null;

function textContent(n: HNode): string {
  if (n.type === "text") return n.data ?? "";
  if (n.name === "br") return "\n";
  return (n.children ?? []).map(textContent).join("") + (n.name === "p" || n.name === "div" ? "\n" : "");
}

/** Stilurile inline permise ca mărci: culoare, mărime, aldin, cursiv, subliniat, tăiat. */
function styleMarks(style: string): GcsMark[] {
  const marks: GcsMark[] = [];
  const attrs: Record<string, string | null> = {};
  for (const decl of style.split(";")) {
    const [prop, ...rest] = decl.split(":");
    const name = prop?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!name || !value) continue;
    if (name === "color") {
      const c = normalizeColor(value);
      if (c) attrs.color = c;
    } else if (name === "font-size") {
      const s = parseFontSize(value);
      if (s) attrs.fontSize = s;
    } else if (name === "font-weight" && (value === "bold" || Number(value) >= 600)) marks.push({ type: "bold" });
    else if (name === "font-style" && value === "italic") marks.push({ type: "italic" });
    else if (name === "text-decoration" || name === "text-decoration-line") {
      if (value.includes("underline")) marks.push({ type: "underline" });
      if (value.includes("line-through")) marks.push({ type: "strike" });
    }
  }
  if (attrs.color || attrs.fontSize) marks.push({ type: "textStyle", attrs });
  return marks;
}

function alignOf(el: HNode): string | null {
  const m = /text-align\s*:\s*(left|center|right|justify)/i.exec(el.attribs?.style ?? "");
  return m ? m[1]!.toLowerCase() : (el.attribs?.align?.toLowerCase() ?? null);
}

/**
 * Convertorul conținutului `core-schema` (HTML cu marcaje proprii) în documentul GCS. Recunoaște citatele, mențiunile,
 * spoilerele, codul, embed-urile, atașamentele, emoticoanele și formatarea; ce nu recunoaște rămâne text.
 * Nu produce HTML: rezultatul trece apoi prin `GcsContentRenderer` (validare + sanitizare).
 */
export function convertHtml(html: string, ctx: GcsConvertContext): GcsConvertResult {
  const w = new GcsDocWriter();
  const attachments = new Set<string>();
  const doc = parseDocument(html, { decodeEntities: true, lowerCaseAttributeNames: true }) as unknown as HNode;

  const walk = (nodes: HNode[], marks: GcsMark[]) => {
    for (const n of nodes) node(n, marks);
  };

  const attachment = (fileId: string) => {
    const att = ctx.attachment(fileId);
    if (att) attachments.add(fileId);
    return att;
  };

  const node = (n: HNode, marks: GcsMark[]): void => {
    if (n.type === "text") {
      const text = (n.data ?? "").replace(/[\s ]+/g, " ");
      if (text.trim() || w.hasOpenParagraph) w.text(text, marks);
      return;
    }
    if (n.type === "comment" || n.type === "directive" || n.type === "cdata") return;
    const name = (n.name ?? "").toLowerCase();
    const children = n.children ?? [];
    const a = n.attribs ?? {};
    if (n.type === "script" || n.type === "style" || DROP.has(name)) {
      w.unrecognized++;
      return;
    }
    switch (name) {
      case "p":
      case "div": {
        if (name === "div" && hasClass(n, "Spoiler") && !hasClass(n, "Spoiler_header") && !hasClass(n, "Spoiler_contents")) return spoiler(n, marks);
        // Antetul unui citat sau al unui spoiler (ex. „X a spus:”) e generat de platforma veche.
        if (hasClass(n, "_citation") || hasClass(n, "Spoiler_header")) return;
        const align = alignOf(n);
        if (name === "p") {
          w.textBlock("paragraph", align && align !== "left" ? { textAlign: align } : undefined);
          walk(children, marks);
          w.endParagraph();
        } else {
          w.endParagraph();
          if (align) w.pushAlign(align);
          walk(children, marks);
          if (align) w.popAlign();
          w.endParagraph();
        }
        return;
      }
      case "br":
        return w.hardBreak();
      case "strong":
      case "b":
        return walk(children, [...marks, { type: "bold" }]);
      case "em":
      case "i":
        return walk(children, [...marks, { type: "italic" }]);
      case "u":
        return walk(children, [...marks, { type: "underline" }]);
      case "s":
      case "strike":
      case "del":
        return walk(children, [...marks, { type: "strike" }]);
      case "sub":
        return walk(children, [...marks, { type: "subscript" }]);
      case "sup":
        return walk(children, [...marks, { type: "superscript" }]);
      case "code":
      case "kbd":
      case "samp":
      case "tt":
        return walk(children, [...marks, { type: "code" }]);
      case "span":
        return walk(children, [...marks, ...styleMarks(a.style ?? "")]);
      case "font": {
        const extra: GcsMark[] = [];
        const color = a.color ? normalizeColor(a.color) : null;
        if (color) extra.push({ type: "textStyle", attrs: { color } });
        return walk(children, [...marks, ...extra, ...styleMarks(a.style ?? "")]);
      }
      case "a":
        return link(n, marks);
      case "img":
        return image(n, marks);
      case "iframe": {
        const url = embedUrlFromIframe(replaceMarkers(a.src ?? a["data-embed-src"] ?? "", ctx.oldUrl));
        if (url) w.leaf({ type: "embed", attrs: { url } });
        else w.unrecognized++;
        return;
      }
      case "blockquote":
        return quote(n, marks);
      case "ul":
      case "ol": {
        const start = Number(a.start);
        w.open(name === "ul" ? "bulletList" : "orderedList", name === "ol" && Number.isInteger(start) && start > 1 && start <= 100_000 ? { start } : undefined);
        walk(children, marks);
        return w.close();
      }
      case "li":
        w.open("listItem");
        walk(children, marks);
        return w.close();
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const level = Math.min(4, Math.max(2, Number(name[1])));
        const align = alignOf(n);
        w.textBlock("heading", { level, ...(align && align !== "left" ? { textAlign: align } : {}) });
        walk(children, marks);
        return w.endParagraph();
      }
      case "pre": {
        const lang = classesOf(n).map((c) => /^lang-(.+)$/.exec(c)?.[1]).find((l) => l && LANGUAGE.test(l));
        const code = textContent(n).replace(/ /g, " ");
        if (code.trim()) w.leaf({ type: "codeBlock", ...(lang ? { attrs: { language: lang } } : {}), content: [{ type: "text", text: code }] });
        return;
      }
      case "hr":
        return w.leaf({ type: "horizontalRule" });
      case "details": {
        const summary = children.find((c) => c.name === "summary");
        w.open("spoiler", summaryAttrs(summary ? textContent(summary) : ""));
        walk(children.filter((c) => c !== summary), marks);
        return w.close();
      }
      case "mark":
        return walk(children, [...marks, { type: "highlight" }]);
      case "table":
        w.unrecognized++;
        return table(n, marks);
      default:
        if (!TRANSPARENT.has(name)) w.unrecognized++;
        if (name === "center") {
          w.pushAlign("center");
          walk(children, marks);
          return w.popAlign();
        }
        return walk(children, marks);
    }
  };

  const summaryAttrs = (text: string) => {
    const s = text.replace(/\s+/g, " ").trim().slice(0, 100);
    return s && s.toLowerCase() !== "spoiler" ? { summary: s } : undefined;
  };

  const spoiler = (n: HNode, marks: GcsMark[]) => {
    const header = (n.children ?? []).find((c) => c.type !== "text" && hasClass(c, "Spoiler_header"));
    const contents = (n.children ?? []).find((c) => c.type !== "text" && hasClass(c, "Spoiler_contents"));
    w.open("spoiler", summaryAttrs(header ? textContent(header) : ""));
    walk(contents ? (contents.children ?? []) : (n.children ?? []).filter((c) => c !== header), marks);
    w.close();
  };

  const quote = (n: HNode, marks: GcsMark[]) => {
    const name = (attrEnding(n, "quote-username") ?? "").trim();
    const isQuote = name !== "" || hasClass(n, "Quote");
    const body = () => {
      const contents = (n.children ?? []).find((c) => c.type !== "text" && hasClass(c, "Quote_contents"));
      walk(contents ? (contents.children ?? []) : (n.children ?? []).filter((c) => !(c.type !== "text" && hasClass(c, "_citation"))), marks);
    };
    if (!isQuote) {
      w.open("blockquote");
      body();
      return w.close();
    }
    const post = ctx.post(attrEnding(n, "quote-contentcommentid") ?? "");
    const userSrc = attrEnding(n, "quote-userid");
    const member = userSrc ? ctx.member(userSrc) : null;
    const authorName = (member?.name ?? name).slice(0, 40);
    if (post && authorName) {
      w.open("quote", { postId: post.id, authorName, ...(member ? { authorId: member.id } : {}) });
      body();
      return w.close();
    }
    // Postarea citată nu e (încă) importată: un citat simplu, cu autorul pe primul rând.
    w.open("blockquote");
    if (authorName) {
      w.text(`${authorName}:`, [{ type: "bold" }]);
      w.endParagraph();
    }
    body();
    w.close();
  };

  const link = (n: HNode, marks: GcsMark[]) => {
    const a = n.attribs ?? {};
    const children = n.children ?? [];
    if (a["data-mentionid"] !== undefined) {
      const member = ctx.member(a["data-mentionid"]) ?? ctx.memberByName(textContent(n).replace(/^@/, "").trim());
      if (member) return w.mention(member.id, member.name);
      return w.text(textContent(n), marks);
    }
    if (a["data-fileid"] !== undefined) {
      const att = attachment(a["data-fileid"]);
      const hasImage = children.some((c) => c.name === "img");
      if (hasImage) return walk(children, marks);
      if (att) return w.text(textContent(n).trim() || att.filename, [...marks, { type: "link", attrs: { href: `/files/${att.id}` } }]);
      w.unrecognized++;
      return w.text(textContent(n), marks);
    }
    const href = a.href ? rewriteHref(a.href, ctx) : null;
    walk(children, href ? [...marks, { type: "link", attrs: { href } }] : marks);
  };

  const image = (n: HNode, marks: GcsMark[]) => {
    const a = n.attribs ?? {};
    const alt = (a.alt ?? "").slice(0, 300);
    const rawSrc = a["data-src"] ?? a.src ?? "";
    if (a["data-emoticon"] !== undefined || /Emoticons>/.test(rawSrc)) {
      return w.text(emojiFor(alt || a.title || "", rawSrc) ?? (alt || a.title || ""), marks);
    }
    if (a["data-fileid"] !== undefined) {
      const att = attachment(a["data-fileid"]);
      if (att?.isImage) {
        return w.leaf({ type: "image", attrs: { attachmentId: att.id, alt: alt || att.filename.slice(0, 300), ...(att.width ? { width: att.width } : {}), ...(att.height ? { height: att.height } : {}) } });
      }
      if (att) return w.text(att.filename, [...marks, { type: "link", attrs: { href: `/files/${att.id}` } }]);
      w.unrecognized++;
      return alt ? w.text(alt, marks) : undefined;
    }
    const src = replaceMarkers(rawSrc, ctx.oldUrl);
    if (/^https:\/\//i.test(src) && URL.canParse(src) && !/[\s"'<>]/.test(src) && src.length <= 2000) {
      return w.leaf({ type: "image", attrs: { src, ...(alt ? { alt } : {}) } });
    }
    // Imaginile http (sau alte scheme) nu se încarcă în pagină: rămân ca link (dacă e sigur) sau doar text.
    const href = src ? rewriteHref(src, ctx) : null;
    if (href) return w.text(alt || src, [...marks, { type: "link", attrs: { href } }]);
    if (alt) w.text(alt, marks);
  };

  const table = (n: HNode, marks: GcsMark[]) => {
    const rows: HNode[] = [];
    const collect = (x: HNode) => {
      for (const c of x.children ?? []) {
        if (c.name === "tr") rows.push(c);
        else if (c.type !== "text") collect(c);
      }
    };
    collect(n);
    for (const row of rows) {
      const cells = (row.children ?? []).filter((c) => c.name === "td" || c.name === "th");
      w.endParagraph();
      cells.forEach((cell, i) => {
        if (i > 0) w.text(" | ", marks);
        walk(cell.children ?? [], cell.name === "th" ? [...marks, { type: "bold" }] : marks);
      });
      w.endParagraph();
    }
  };

  walk(doc.children ?? [], []);
  return { doc: w.finish(), unrecognized: w.unrecognized, attachments: [...attachments] };
}
