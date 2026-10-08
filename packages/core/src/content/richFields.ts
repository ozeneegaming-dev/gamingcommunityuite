/**
 * Câmpurile cu text formatat din afara postărilor (semnătura, regulile chat-ului, anunțul, câmpurile de profil „Text
 * lung”), specul `2026-10-07-editor-campuri.md`. Partea pură (fără Node, fără sanitizer): profilurile, conversia
 * textului vechi și verificarea unui document după profil. Exportată și ca `@gcs/core/rich-fields`, ca paginile client
 * să dea editorului exact aceleași liste pe care le aplică serverul.
 */

/** Un nod de document (JSON Tiptap), cât trebuie pentru verificări. */
type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

export type GcsRichFieldKey = "signature" | "chatRules" | "announcement" | "profileText" | "clanDescription";

/** Ce acceptă un câmp: nodurile și mărcile permise și limitele implicite. */
export type GcsRichFieldProfile = {
  key: GcsRichFieldKey;
  /** Nodurile permise, pe lângă `doc` și `text`. */
  nodes: readonly string[];
  marks: readonly string[];
  /** Limita implicită de caractere (textul simplu, ca la postări). */
  maxChars: number;
  /** Numărul maxim implicit de imagini; imaginile vin doar din adrese https (fără atașamente). */
  maxImages: number;
};

const TEXT_MARKS = ["bold", "italic", "underline", "strike", "code", "link", "subscript", "superscript", "highlight", "textStyle"] as const;
const LISTS = ["bulletList", "orderedList", "listItem"] as const;

/** Profilurile câmpurilor. Editorul primește aceleași liste (`allow`), deci nu poate produce altceva. */
export const GCS_RICH_FIELDS = {
  // Tot ce scrie editorul postărilor, fără video: semnăturile vechi (editorul complet) rămân valabile.
  signature: {
    key: "signature",
    nodes: ["paragraph", "heading", ...LISTS, "blockquote", "codeBlock", "horizontalRule", "hardBreak", "image", "quote", "spoiler", "mention"],
    marks: TEXT_MARKS,
    maxChars: 500,
    maxImages: 1,
  },
  chatRules: {
    key: "chatRules",
    nodes: ["paragraph", "heading", ...LISTS, "blockquote", "horizontalRule", "hardBreak"],
    marks: TEXT_MARKS,
    maxChars: 5000,
    maxImages: 0,
  },
  announcement: {
    key: "announcement",
    nodes: ["paragraph", "heading", ...LISTS, "blockquote", "horizontalRule", "hardBreak", "image"],
    marks: TEXT_MARKS,
    maxChars: 5000,
    maxImages: 4,
  },
  profileText: {
    key: "profileText",
    nodes: ["paragraph", ...LISTS, "blockquote", "horizontalRule", "hardBreak"],
    marks: ["bold", "italic", "underline", "strike", "link", "highlight", "textStyle"],
    maxChars: 5000,
    maxImages: 0,
  },
  // Descrierea unui clan (specul 2026-10-08-clanuri): titluri, liste, citate și cel mult 2 imagini din adrese https.
  clanDescription: {
    key: "clanDescription",
    nodes: ["paragraph", "heading", ...LISTS, "blockquote", "horizontalRule", "hardBreak", "image"],
    marks: TEXT_MARKS,
    maxChars: 5000,
    maxImages: 2,
  },
} as const satisfies Record<GcsRichFieldKey, GcsRichFieldProfile>;

/** Valoarea e un document al editorului (nu un text vechi)? */
export function isRichDoc(value: unknown): value is { type: "doc"; content: unknown[] } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { type?: unknown }).type === "doc" && Array.isArray((value as { content?: unknown }).content);
}

/**
 * Textul simplu (valorile vechi ale câmpurilor) → document: **un paragraf pe rând**; rândurile goale devin paragrafe
 * goale (în editor apar ca rânduri goale). `null` pentru un text fără niciun caracter vizibil.
 */
export function plainTextToDoc(text: string): { type: "doc"; content: DocNode[] } | null {
  // Fără caractere de control (în afară de tab și rândul nou): nu au ce căuta într-un text afișat.
  const clean = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  if (clean.trim() === "") return null;
  const lines = clean.replace(/^\n+|\s+$/g, "").split("\n");
  return { type: "doc", content: lines.map((line) => (line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] })) };
}

/** Valoarea unui câmp (document, text vechi sau gol) → document sau `null` (câmp gol). */
export function richValueToDoc(value: unknown): unknown {
  if (typeof value === "string") return plainTextToDoc(value);
  if (value === null || value === undefined) return null;
  return value;
}

/** Parcurge nodurile unui document (adâncimea e deja limitată de validator; aici doar o plasă de siguranță). */
function walk(node: DocNode, visit: (n: DocNode) => void, depth = 0): void {
  if (depth > 50) return;
  visit(node);
  for (const child of node.content ?? []) walk(child, visit, depth + 1);
}

/**
 * Verifică un document **deja validat** de `GcsContentRenderer` după profilul câmpului: nodurile și mărcile permise,
 * imaginile (doar din adrese https, cel mult `maxImages`). Întoarce codul erorii sau `null`.
 */
export function richDocIssue(doc: unknown, profile: GcsRichFieldProfile, maxImages = profile.maxImages): "format_not_allowed" | "too_many_images" | null {
  let issue: "format_not_allowed" | "too_many_images" | null = null;
  let images = 0;
  walk(doc as DocNode, (n) => {
    if (issue) return;
    if (n.type === "doc" || n.type === "text") {
      if (n.marks?.some((m) => !profile.marks.includes(m.type))) issue = "format_not_allowed";
      return;
    }
    if (!profile.nodes.includes(n.type)) {
      issue = "format_not_allowed";
      return;
    }
    if (n.type === "image") {
      // Atașamentele sunt legate de postări (drepturi, ștergere); aceste câmpuri primesc doar adrese.
      if (n.attrs?.attachmentId || typeof n.attrs?.src !== "string") issue = "format_not_allowed";
      else if (++images > maxImages) issue = "too_many_images";
    }
  });
  return issue;
}
