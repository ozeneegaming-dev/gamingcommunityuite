/** Textul simplu al unui document al editorului (fără citate), scurtat la `max` caractere (notificări, widget-uri). */
export function docSnippet(json: unknown, max = 140): string {
  const parts: string[] = [];
  const walk = (n: unknown, depth: number) => {
    if (depth > 50 || typeof n !== "object" || n === null) return;
    const node = n as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type === "quote") return;
    if (node.type === "text" && typeof node.text === "string") parts.push(node.text);
    if (node.type === "mention" && typeof node.attrs?.label === "string") parts.push(`@${node.attrs.label}`);
    if (Array.isArray(node.content)) for (const c of node.content) walk(c, depth + 1);
    if (node.type === "paragraph" || node.type === "heading") parts.push(" ");
  };
  walk(json, 0);
  const text = parts.join("").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
