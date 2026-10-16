import { currentActor } from "@/lib/actor";
import { viewerTheme } from "@/lib/appearance";
import { FEED_TABS, type GcsFeedTab } from "@/lib/cockpit";
import { cockpitData, cockpitFeed } from "@/lib/cockpit.server";

export const dynamic = "force-dynamic";

/**
 * Consola Hero Cockpit: `?feed=<tab>` = rândurile „Feed live” ale tab-ului; altfel toate datele consolei (când
 * vizitatorul ajunge pe pagina principală fără reîncărcare). Consola oprită în temă → 404.
 */
export async function GET(req: Request): Promise<Response> {
  const { shown } = await viewerTheme();
  const settings = shown.settings.cockpit;
  if (!settings.enabled) return Response.json({ error: "not_found" }, { status: 404 });
  const actor = await currentActor();
  const headers = { "Cache-Control": "private, no-store" };
  const feed = new URL(req.url).searchParams.get("feed");
  if (feed !== null) {
    const tab: GcsFeedTab = (FEED_TABS as readonly string[]).includes(feed) ? (feed as GcsFeedTab) : "all";
    return Response.json({ items: await cockpitFeed(actor, tab) }, { headers });
  }
  return Response.json(await cockpitData(actor, settings), { headers });
}
