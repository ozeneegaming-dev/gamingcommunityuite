import { GCS_FONT_SIZES, GCS_TEXT_ALIGNS, type GcsDoc, type GcsDocNode } from "@gcs/core";

export type GcsMark = NonNullable<GcsDocNode["marks"]>[number];
type Attrs = Record<string, string | number | null>;

const BLOCK_CONTAINERS = new Set(["blockquote", "quote", "spoiler"]);
const LISTS = new Set(["bulletList", "orderedList"]);
const INLINE = new Set(["text", "mention", "hardBreak"]);
const LEAF_BLOCKS = new Set(["image", "embed", "horizontalRule"]);
/** Câte containere imbricate (citate, liste) se păstrează; mai adânc, conținutul se aplatizează. */
const MAX_NESTING = 12;
/** Peste atâtea noduri, documentul devine text simplu (validatorul acceptă 10 000). */
const MAX_NODES = 9000;

/**
 * Scriitorul documentului GCS (Tiptap JSON), comun convertorului HTML și celui BBCode. Convertoarele adaugă noduri
 * „liber” (text, blocuri, containere); `finish()` aduce rezultatul la regulile validatorului (`GcsContentRenderer`):
 * textul liber intră în paragrafe, elementele listelor în `listItem`, containerele goale dispar, textele cu aceleași
 * mărci se unesc, imbricarea și mărimea sunt plafonate.
 */
export class GcsDocWriter {
  private readonly root: GcsDocNode = { type: "doc", content: [] };
  private readonly stack: GcsDocNode[] = [this.root];
  private para: GcsDocNode | null = null;
  private readonly aligns: string[] = [];
  /** Elemente nerecunoscute, păstrate ca text (raportul le numără). */
  unrecognized = 0;

  private get top(): GcsDocNode {
    return this.stack[this.stack.length - 1]!;
  }

  /** Alinierea paragrafelor create de acum înainte (`left` = implicit). */
  pushAlign(align: string): void {
    this.endParagraph();
    this.aligns.push(align);
  }

  popAlign(): void {
    this.endParagraph();
    this.aligns.pop();
  }

  private currentAlign(): Attrs | undefined {
    const a = this.aligns[this.aligns.length - 1];
    return a && a !== "left" && (GCS_TEXT_ALIGNS as readonly string[]).includes(a) ? { textAlign: a } : undefined;
  }

  private inline(node: GcsDocNode): void {
    if (!this.para) {
      const attrs = this.currentAlign();
      this.para = { type: "paragraph", content: [], ...(attrs ? { attrs } : {}) };
      this.top.content!.push(this.para);
    }
    this.para.content!.push(node);
  }

  text(text: string, marks: GcsMark[] = []): void {
    if (text === "") return;
    this.inline(marks.length > 0 ? { type: "text", text, marks: [...marks] } : { type: "text", text });
  }

  hardBreak(): void {
    if (this.para) this.inline({ type: "hardBreak" });
  }

  mention(id: string, label: string): void {
    this.inline({ type: "mention", attrs: { id, label: label.slice(0, 40) } });
  }

  /** Paragraful curent se închide; textul următor pornește unul nou. */
  endParagraph(): void {
    this.para = null;
  }

  get hasOpenParagraph(): boolean {
    return this.para !== null && (this.para.content?.length ?? 0) > 0;
  }

  /** Un paragraf sau un titlu explicit (ex. `<p style="text-align:center">`, `<h2>`): textul următor intră în el. */
  textBlock(type: "paragraph" | "heading", attrs?: Attrs): void {
    this.para = null;
    const merged = type === "paragraph" ? (attrs ?? this.currentAlign()) : attrs;
    const node: GcsDocNode = { type, content: [], ...(merged ? { attrs: merged } : {}) };
    this.top.content!.push(node);
    this.para = node;
  }

  /** Un bloc fără conținut editabil: imagine, embed, linie, bloc de cod. */
  leaf(node: GcsDocNode): void {
    this.para = null;
    this.top.content!.push(node);
  }

  /** Deschide un container (citat, spoiler, listă, element de listă). */
  open(type: string, attrs?: Attrs): void {
    this.para = null;
    const node: GcsDocNode = { type, content: [], ...(attrs ? { attrs } : {}) };
    this.top.content!.push(node);
    this.stack.push(node);
  }

  close(): void {
    this.para = null;
    if (this.stack.length > 1) this.stack.pop();
  }

  /** Documentul final, valid pentru renderer, sau `null` dacă nu a rămas nimic. */
  finish(): GcsDoc | null {
    while (this.stack.length > 1) this.stack.pop();
    let content = normalizeBlocks(this.root.content ?? [], 0);
    if (content.length === 0) return null;
    if (countNodes(content) > MAX_NODES) content = flatten(content);
    return { type: "doc", content };
  }
}

function countNodes(nodes: GcsDocNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countNodes(node.content ?? []);
  return n;
}

/** Textul simplu al unor noduri (pentru aplatizare și pentru textul de rezervă). */
export function docText(nodes: GcsDocNode[]): string {
  const out: string[] = [];
  const walk = (n: GcsDocNode) => {
    if (n.type === "text") out.push(n.text ?? "");
    else if (n.type === "hardBreak") out.push("\n");
    else if (n.type === "mention") out.push(`@${n.attrs?.label ?? ""}`);
    else if (n.type === "embed") out.push(`\n${n.attrs?.url ?? ""}\n`);
    else {
      for (const c of n.content ?? []) walk(c);
      if (!INLINE.has(n.type)) out.push("\n\n");
    }
  };
  nodes.forEach(walk);
  return out.join("");
}

/**
 * Un document de text simplu: paragrafe despărțite de rânduri goale, rândurile cu `hardBreak`. Un text foarte lung
 * (prea multe noduri pentru validator) devine cel mult 2 000 de paragrafe, cu rândurile unite prin spațiu.
 */
export function plainDoc(text: string): GcsDoc | null {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  const content: GcsDocNode[] = paragraphs.map((p) => {
    const inline: GcsDocNode[] = [];
    p.split("\n").forEach((line, j) => {
      if (j > 0) inline.push({ type: "hardBreak" });
      if (line) inline.push({ type: "text", text: line });
    });
    return { type: "paragraph", content: inline };
  });
  if (countNodes(content) <= MAX_NODES) return { type: "doc", content };
  const chunk = Math.ceil(paragraphs.length / 2000);
  const compact: GcsDocNode[] = [];
  for (let i = 0; i < paragraphs.length; i += chunk) {
    compact.push({ type: "paragraph", content: [{ type: "text", text: paragraphs.slice(i, i + chunk).join(" ").replace(/\s*\n\s*/g, " ") }] });
  }
  return { type: "doc", content: compact };
}

function flatten(nodes: GcsDocNode[]): GcsDocNode[] {
  return plainDoc(docText(nodes))?.content ?? [];
}

function normalizeBlocks(children: GcsDocNode[], depth: number): GcsDocNode[] {
  const out: GcsDocNode[] = [];
  let run: GcsDocNode[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const p = cleanInline({ type: "paragraph", content: run });
    if (p) out.push(p);
    run = [];
  };
  for (const c of children) {
    if (INLINE.has(c.type)) {
      run.push(c);
      continue;
    }
    flush();
    // Un element de listă în afara unei liste: doar conținutul lui.
    if (c.type === "listItem") {
      out.push(...normalizeBlocks(c.content ?? [], depth));
      continue;
    }
    out.push(...normalizeNode(c, depth));
  }
  flush();
  return out;
}

function normalizeNode(n: GcsDocNode, depth: number): GcsDocNode[] {
  if (n.type === "paragraph" || n.type === "heading") {
    const p = cleanInline(n);
    return p ? [p] : [];
  }
  if (n.type === "codeBlock") {
    const text = (n.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : c.type === "hardBreak" ? "\n" : "")).join("").replace(/^\n+|\s+$/g, "");
    return text ? [{ type: "codeBlock", ...(n.attrs ? { attrs: n.attrs } : {}), content: [{ type: "text", text }] }] : [];
  }
  if (LEAF_BLOCKS.has(n.type)) return [n];
  if (LISTS.has(n.type)) {
    if (depth + 2 > MAX_NESTING) return normalizeBlocks((n.content ?? []).flatMap((c) => c.content ?? [c]), depth);
    const items: GcsDocNode[] = [];
    let loose: GcsDocNode[] = [];
    const flushLoose = () => {
      if (loose.length === 0) return;
      const content = normalizeBlocks(loose, depth + 2);
      if (content.length > 0) items.push({ type: "listItem", content });
      loose = [];
    };
    for (const c of n.content ?? []) {
      if (c.type === "listItem") {
        flushLoose();
        const content = normalizeBlocks(c.content ?? [], depth + 2);
        if (content.length > 0) items.push({ type: "listItem", content });
      } else loose.push(c);
    }
    flushLoose();
    return items.length > 0 ? [{ type: n.type, ...(n.attrs ? { attrs: n.attrs } : {}), content: items }] : [];
  }
  if (BLOCK_CONTAINERS.has(n.type)) {
    if (depth + 1 > MAX_NESTING) return normalizeBlocks(n.content ?? [], depth);
    const content = normalizeBlocks(n.content ?? [], depth + 1);
    return content.length > 0 ? [{ type: n.type, ...(n.attrs ? { attrs: n.attrs } : {}), content }] : [];
  }
  return [];
}

function sameMarks(a: GcsMark[] | undefined, b: GcsMark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** Mărcile unui text: fără dubluri (ultima câștigă), `textStyle` combinat, maxim 10. */
function cleanMarks(marks: GcsMark[] | undefined): GcsMark[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  const byType = new Map<string, GcsMark>();
  for (const m of marks) {
    if (m.type === "textStyle") {
      const prev = byType.get("textStyle")?.attrs ?? {};
      const attrs: Record<string, string | null> = { ...prev };
      if (m.attrs?.color) attrs.color = m.attrs.color;
      if (m.attrs?.fontSize && (GCS_FONT_SIZES as readonly string[]).includes(m.attrs.fontSize)) attrs.fontSize = m.attrs.fontSize;
      byType.set("textStyle", { type: "textStyle", attrs });
    } else byType.set(m.type, m);
  }
  const out = [...byType.values()].filter((m) => m.type !== "textStyle" || Object.values(m.attrs ?? {}).some(Boolean)).slice(0, 10);
  // Codul inline nu se combină cu stilurile (editorul nu le permite împreună).
  return out.length > 0 ? out : undefined;
}

function cleanInline(n: GcsDocNode): GcsDocNode | null {
  const merged: GcsDocNode[] = [];
  for (const c of n.content ?? []) {
    if (c.type === "text") {
      const marks = cleanMarks(c.marks);
      const prev = merged[merged.length - 1];
      if (prev?.type === "text" && sameMarks(prev.marks, marks)) prev.text = (prev.text ?? "") + (c.text ?? "");
      else merged.push(marks ? { type: "text", text: c.text ?? "", marks } : { type: "text", text: c.text ?? "" });
    } else merged.push(c);
  }
  // Spațiile și rândurile noi de la capete nu contează.
  while (merged[0]?.type === "hardBreak") merged.shift();
  while (merged[merged.length - 1]?.type === "hardBreak") merged.pop();
  const first = merged[0];
  if (first?.type === "text") first.text = (first.text ?? "").replace(/^\s+/, "");
  const last = merged[merged.length - 1];
  if (last?.type === "text") last.text = (last.text ?? "").replace(/\s+$/, "");
  const content = merged.filter((c) => c.type !== "text" || (c.text ?? "") !== "");
  for (let i = content.length - 1; i > 0; i--) {
    if (content[i]!.type === "hardBreak" && content[i - 1]!.type === "hardBreak" && content[i - 2]?.type === "hardBreak") content.splice(i, 1);
  }
  if (!content.some((c) => c.type !== "hardBreak")) return null;
  return { type: n.type, ...(n.attrs ? { attrs: n.attrs } : {}), content };
}
