import { MEMBERS_ACP_SECTION } from "@gcs/core";
import type { NextRequest } from "next/server";
import { getAcpContext } from "@/lib/acp";
import { parseMemberSearch } from "@/lib/member-search";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Exportul CSV al listei ACP → Membri (Membri v2), cu aceeași căutare ca pagina (parametrii adresei). Aceeași gardă ca
 * ACP-ul: fără acces → 404. Intră în jurnal.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const ctx = await getAcpContext();
  const { acp, members, memberAdmin } = services();
  if (ctx.state !== "ok" || !(await acp.can(ctx.actor, MEMBERS_ACP_SECTION, "view"))) {
    return new Response("Not Found", { status: 404 });
  }
  const query = parseMemberSearch(Object.fromEntries(request.nextUrl.searchParams));
  const csv = await memberAdmin.exportCsv(ctx.actor, await members.where(query));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="members-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
