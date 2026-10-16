import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const LIMIT = { window: 60, max: 5 };

/**
 * „Exportă CSV” din `/chat/history` (staff-ul cu `chat_pro.history_export`): aceleași filtre ca pagina (`q`, `member`,
 * `from`, `to`, `channel`, `hidden`), cel mult 10 000 de rânduri, cu limită pe minut. Fără drept → 404.
 */
export async function GET(req: Request): Promise<Response> {
  const actor = await currentActor();
  const { chatPro, rateLimiter } = services();
  if (!actor.userId || actor.isBanned || !(await chatPro.canUse(actor)) || !(await chatPro.history.canExport(actor))) return new Response("Not found", { status: 404 });
  const limit = await rateLimiter.consume(`chat-history-export:${actor.userId}`, LIMIT);
  if (!limit.allowed) return new Response("Too many requests", { status: 429 });
  const sp = new URL(req.url).searchParams;
  const csv = await chatPro.history.exportCsv(actor, {
    q: sp.get("q") ?? "",
    member: sp.get("member") ?? "",
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    ...(sp.get("channel") ? { channel: sp.get("channel")! } : {}),
    hidden: sp.get("hidden") === "1",
  });
  const day = new Date().toISOString().slice(0, 10);
  // BOM: foile de calcul citesc diacriticele corect.
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chat-history-${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
