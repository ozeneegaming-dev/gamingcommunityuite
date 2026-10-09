import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const SHOWN = 6;

/**
 * Dropdown-ul „Mesaje” din antet: ultimele conversații (cele noi primele), cu starea necitită, autorul și extrasul
 * ultimului mesaj, plus numărul de necitite. Doar pentru membri.
 */
export async function GET(): Promise<Response> {
  const actor = await currentActor();
  if (!actor.userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { conversationQueries, conversations } = services();
  const [inbox, unread] = await Promise.all([conversationQueries.inbox(actor, 1), conversations.unreadCount(actor.userId)]);
  const items = inbox.items.slice(0, SHOWN).map((c) => {
    const others = c.participants.filter((p) => p.id !== actor.userId);
    const author = c.last?.author ?? others[0] ?? null;
    return {
      id: c.id,
      title: c.title,
      href: `/messages/${c.id}`,
      unread: c.unread,
      at: c.lastMessageAt,
      snippet: c.last?.snippet ?? "",
      user: author ? { id: author.id, name: author.name, nameKey: author.nameKey, image: author.image, frameKey: author.frameKey } : null,
    };
  });
  return Response.json({ unread, items }, { headers: { "Cache-Control": "private, no-store" } });
}
