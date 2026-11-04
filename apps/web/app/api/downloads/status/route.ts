import { GcsForbidden, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { currentActor } from "@/lib/actor";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Starea fișierelor încărcate de vizitator (`{ ids: [...] }`): primit, verificat (antivirus), gata sau respins. */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
    return services().downloads.uploads.status(await currentActor(), ids);
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
