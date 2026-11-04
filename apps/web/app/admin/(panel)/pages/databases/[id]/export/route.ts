import { toResult } from "@gcs/core";
import { PAGES_ACP } from "@gcs/modules";
import { assertAcpAction } from "@/lib/acp";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** „Descarcă” o bază de date ca pachet `.json` (setările, câmpurile, categoriile și, cu `?records=1`, înregistrările). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await params).id);
  const withRecords = new URL(req.url).searchParams.get("records") === "1";
  const result = await toResult(async () => {
    const actor = await assertAcpAction(PAGES_ACP.databases, "view");
    return services().pagesAdmin.exportDatabase(actor, id, withRecords);
  });
  if (!result.ok) return Response.json(result, { status: result.error.status });
  return new Response(JSON.stringify(result.data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="gcs-pages-${result.data.database.key}.json"`, "cache-control": "no-store" },
  });
}
