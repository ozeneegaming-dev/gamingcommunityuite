/**
 * Prima imagine dintr-un document al editorului (caruselul topicurilor recomandate): un atașament (`/files/<id>`) sau o
 * imagine externă `https://` (nodul imagine sau un embed de imagine); `null` dacă nu are. Citatele se sar.
 */
export function docFirstImage(json: unknown): string | null {
  let found: string | null = null;
  const walk = (n: unknown, depth: number) => {
    if (found || depth > 50 || typeof n !== "object" || n === null) return;
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type === "quote") return;
    const a = node.attrs ?? {};
    if (node.type === "image") {
      if (typeof a.attachmentId === "string" || typeof a.attachmentId === "number") {
        const id = String(a.attachmentId);
        if (/^[A-Za-z0-9_-]{1,40}$/.test(id)) found = `/files/${id}`;
      } else if (typeof a.src === "string" && /^https:\/\/[^\s"'<>]+$/i.test(a.src)) found = a.src;
      return;
    }
    if (node.type === "embed" && typeof a.url === "string" && /^https:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s"'<>]*)?$/i.test(a.url)) {
      found = a.url;
      return;
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c, depth + 1);
  };
  walk(json, 0);
  return found;
}

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
