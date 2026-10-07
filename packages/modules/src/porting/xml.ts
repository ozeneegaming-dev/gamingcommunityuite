import { parseDocument } from "htmlparser2";

/** Un element XML simplificat: numele (cu litere mici), atributele, copiii și textul direct (inclusiv CDATA). */
export type GcsXmlElement = { name: string; attrs: Record<string, string>; children: GcsXmlElement[]; text: string };

type HNode = { type: string; name?: string; attribs?: Record<string, string>; children?: HNode[]; data?: string };

/** Cel mult atâtea elemente într-un document (un XML ostil cu milioane de noduri goale nu blochează procesul). */
const MAX_ELEMENTS = 200_000;
const MAX_DEPTH = 64;

/**
 * Parsează XML ca text, cu `htmlparser2` în mod XML: fără DTD și fără entități externe (doar `&amp;`, `&lt;`… și cele
 * numerice), deci fără XXE sau „billion laughs”. Rezultatul e un arbore simplu; `null` dacă nu există un element rădăcină.
 */
export function parseXml(text: string): GcsXmlElement | null {
  const doc = parseDocument(text.replace(/^\uFEFF/, ""), { xmlMode: true, decodeEntities: true }) as unknown as HNode;
  let count = 0;
  // Adâncimea e plafonată: niciun format sursă nu trece de câteva niveluri, iar recursivitatea nu poate epuiza stiva.
  const convert = (n: HNode, depth: number): GcsXmlElement => {
    if (++count > MAX_ELEMENTS) throw new Error("xml_too_large");
    const el: GcsXmlElement = { name: (n.name ?? "").toLowerCase(), attrs: { ...(n.attribs ?? {}) }, children: [], text: "" };
    for (const c of n.children ?? []) {
      if (c.type === "tag") {
        if (depth < MAX_DEPTH) el.children.push(convert(c, depth + 1));
      }
      else if (c.type === "text") el.text += c.data ?? "";
      else if (c.type === "cdata") el.text += (c.children ?? []).map((t) => t.data ?? "").join("");
    }
    return el;
  };
  const root = (doc.children ?? []).find((c) => c.type === "tag");
  return root ? convert(root, 0) : null;
}

/** Copiii cu numele dat. */
export const childrenNamed = (el: GcsXmlElement | null | undefined, name: string): GcsXmlElement[] => (el ? el.children.filter((c) => c.name === name) : []);

/** Primul copil cu numele dat. */
export const childNamed = (el: GcsXmlElement | null | undefined, name: string): GcsXmlElement | null => el?.children.find((c) => c.name === name) ?? null;

/** Textul unui copil (sau atributul, dacă nu există copilul). */
export const childText = (el: GcsXmlElement, name: string): string => childNamed(el, name)?.text ?? el.attrs[name] ?? "";

/** Toți descendenții cu numele dat (în ordinea documentului). */
export function descendants(el: GcsXmlElement, name: string): GcsXmlElement[] {
  const out: GcsXmlElement[] = [];
  const walk = (n: GcsXmlElement) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}
