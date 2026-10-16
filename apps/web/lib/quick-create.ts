/**
 * Meniul „+ Creează” din antet (specul 2026-10-10-hero-cockpit §1): itemii vin din aplicații și drepturi, iar în
 * pagina unui forum (sau a unui topic) primul item e „Topic nou în <forum>”. Partea pură (fără server) construiește
 * lista din ce poate viewer-ul; `quickCreateItems` (în `quick-create.server.ts`) citește drepturile.
 */

export type GcsQuickCreateItem = {
  key: string;
  href: string;
  icon: string;
  /** Cheia textului (`header.create.items.<key>`) și parametrii lui. */
  labelKey: string;
  params?: Record<string, string>;
  /** Itemul paginii curente (forumul în care ești), evidențiat sus. */
  context?: boolean;
};

export type GcsQuickCreateInput = {
  /** Forumul paginii curente (pagina forumului sau a unui topic din el), dacă viewer-ul poate posta acolo. */
  forum: { id: number; slug: string; name: string } | null;
  /** Forumurile în care viewer-ul poate porni topicuri (pentru „Topic nou în…”), în ordinea indexului. */
  forums: { id: number; slug: string; name: string }[];
  canMessage: boolean;
  /** Aplicațiile pornite și drepturile lor (doar aplicațiile instalate contribuie). */
  clans: boolean;
  tickets: boolean;
  sanctions: boolean;
};

/** Cât de multe forumuri apar în submeniul „Topic nou în…”. */
export const QUICK_CREATE_FORUMS = 8;

const topicHref = (f: { id: number; slug: string }) => `/forum/${f.id}-${f.slug}/new`;

export function buildQuickCreate(input: GcsQuickCreateInput): { items: GcsQuickCreateItem[]; forums: GcsQuickCreateItem[] } {
  const items: GcsQuickCreateItem[] = [];
  if (input.forum) {
    items.push({ key: "topicHere", href: topicHref(input.forum), icon: "fa-solid fa-pen-to-square", labelKey: "topicIn", params: { forum: input.forum.name }, context: true });
  }
  if (input.canMessage) items.push({ key: "message", href: "/messages/new", icon: "fa-solid fa-envelope", labelKey: "message" });
  if (input.clans) items.push({ key: "clan", href: "/clans/new", icon: "fa-solid fa-people-group", labelKey: "clan" });
  if (input.tickets) items.push({ key: "ticket", href: "/servers/tickets/new", icon: "fa-solid fa-ticket", labelKey: "ticket" });
  if (input.sanctions) items.push({ key: "sanction", href: "/bans/new", icon: "fa-solid fa-gavel", labelKey: "sanction" });
  const forums = input.forums
    .filter((f) => f.id !== input.forum?.id)
    .slice(0, QUICK_CREATE_FORUMS)
    .map((f) => ({ key: `forum-${f.id}`, href: topicHref(f), icon: "fa-solid fa-comments", labelKey: "forum", params: { forum: f.name } }));
  return { items, forums };
}

/** Forumul sau topicul din adresa paginii (`/forum/12-slug…`, `/topic/34-slug…`). */
export function pageContext(pathname: string): { forumId: number } | { topicId: number } | null {
  const forum = /^\/forum\/(\d{1,9})(?:-|\/|$)/.exec(pathname);
  if (forum) return { forumId: Number(forum[1]) };
  const topic = /^\/topic\/(\d{1,9})(?:-|\/|$)/.exec(pathname);
  if (topic) return { topicId: Number(topic[1]) };
  return null;
}
