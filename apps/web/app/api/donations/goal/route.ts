import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Progresul unui obiectiv de donații (widget-ul „Obiectivul lunii” și cardul din `/donatii`, reîmprospătate live):
 * `?goal=<id>` (gol = primul obiectiv activ vizibil). `{ goal: null }` = obiectivul nu există sau nu e pentru viewer.
 * Aplicația VIP oprită → 404 (proxy-ul, după rutele aplicației).
 */
export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("goal") ?? "";
  const id = /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  if (raw !== "" && id === null) return Response.json({ error: "invalid" }, { status: 400 });
  const { apps, donations } = services();
  if (!(await apps.enabled("vip"))) return Response.json({ error: "not_found" }, { status: 404 });
  const goal = await donations.goalView(await currentActor(), id);
  return Response.json({ goal }, { headers: { "Cache-Control": "private, no-store" } });
}
