import { onlineView } from "@/lib/online";

export const dynamic = "force-dynamic";

/** Lista „Cine e online”, reîmprospătată de client la 60 s. */
export async function GET() {
  return Response.json(await onlineView(), { headers: { "Cache-Control": "no-store" } });
}
