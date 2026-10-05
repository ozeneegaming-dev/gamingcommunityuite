const MAX_SLUG = 80;

/** Slug pentru URL-uri (`/topic/{id}-{slug}`): fără diacritice, litere mici, cuvinte despărțite prin `-`. Niciodată gol. */
export function slugify(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > MAX_SLUG) break;
    slug = next;
  }
  if (!slug && words[0]) slug = words[0].slice(0, MAX_SLUG);
  return slug || "topic";
}

/** `128-cum-intru-pe-server` → `{ id: 128, slug: "cum-intru-pe-server" }`; `128` → slug gol. Altceva → `null`. */
export function parseRef(ref: string): { id: number; slug: string } | null {
  const m = /^(\d{1,15})(?:-(.*))?$/.exec(ref);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, slug: m[2] ?? "" };
}

/**
 * `cmabc123-krypt` → `{ id: "cmabc123", slug: "krypt" }` (id-urile userilor sunt cuid-uri, fără `-`).
 * Doar caractere sigure în id; altceva → `null`.
 */
export function parseUserRef(ref: string): { id: string; slug: string } | null {
  const m = /^([a-z0-9]{8,40})(?:-(.*))?$/i.exec(ref);
  return m ? { id: m[1]!, slug: m[2] ?? "" } : null;
}
