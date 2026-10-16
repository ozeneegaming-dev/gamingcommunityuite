import "server-only";
import type { GcsActor } from "@gcs/core";
import { BRIDGE_PERMISSION } from "@gcs/modules";
import { buildQuickCreate, pageContext, type GcsQuickCreateItem } from "./quick-create";
import { services } from "./services";

/**
 * Itemii meniului „+ Creează” pentru viewer, în pagina dată (contextul: forumul paginii sau al topicului). Fiecare
 * aplicație contribuie doar dacă e pornită și accesibilă, iar fiecare item doar cu dreptul lui.
 */
export async function quickCreateItems(actor: GcsActor, pathname: string): Promise<{ items: GcsQuickCreateItem[]; forums: GcsQuickCreateItem[] }> {
  if (!actor.userId || actor.isBanned) return { items: [], forums: [] };
  const { db, permissions, apps, bridge, forumQueries } = services();
  const usable = await apps.accessFilter(actor);

  // Forumurile care primesc topicuri, vizibile și cu dreptul de a porni topicuri.
  const rows = await db.forum.findMany({ where: { type: { in: ["FORUM", "QA"] } }, orderBy: [{ parentId: "asc" }, { position: "asc" }], select: { id: true, name: true, slug: true } });
  const refs = rows.map((f) => ({ type: "forum", id: String(f.id) }));
  const [viewable, creatable] = await Promise.all([permissions.filterContainers(actor, "forums.view", refs), permissions.filterContainers(actor, "forums.create", refs)]);
  const forums = rows.filter((f) => viewable.has(String(f.id)) && creatable.has(String(f.id)));

  // Contextul: forumul paginii, sau forumul topicului deschis.
  const ctx = pageContext(pathname);
  let forumId: number | null = null;
  if (ctx && "forumId" in ctx) forumId = ctx.forumId;
  else if (ctx && "topicId" in ctx && (await forumQueries.topicAccess(actor, ctx.topicId)).canRead) {
    forumId = (await db.topic.findUnique({ where: { id: ctx.topicId }, select: { forumId: true } }))?.forumId ?? null;
  }
  const forum = forumId === null ? null : (forums.find((f) => f.id === forumId) ?? null);

  const servers = usable("servers");
  const [clan, ticket, sanctions] = await Promise.all([
    usable("clans") ? permissions.can(actor, "clans.create") : false,
    servers ? permissions.can(actor, BRIDGE_PERMISSION.ticketsCreate) : false,
    servers ? bridge.sanctions.abilities(actor).then((a) => a.staff || a.grants.length > 0) : false,
  ]);
  return buildQuickCreate({ forum, forums, canMessage: true, clans: clan, tickets: ticket, sanctions });
}
