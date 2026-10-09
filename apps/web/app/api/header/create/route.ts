import { currentActor } from "@/lib/actor";
import { quickCreateItems } from "@/lib/quick-create.server";

export const dynamic = "force-dynamic";

/** Meniul „+ Creează” al antetului: itemii viewer-ului în pagina dată (`?path=/forum/12-x`). Doar pentru membri. */
export async function GET(req: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor.userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const path = (new URL(req.url).searchParams.get("path") ?? "/").slice(0, 300);
  const data = await quickCreateItems(actor, path.startsWith("/") ? path : "/");
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
