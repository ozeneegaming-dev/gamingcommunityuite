import { GcsError } from "@gcs/core";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const TYPES = new Set(["forums.post", "pm.message", "profile.status", "chat.message"]);

/** Butonul „Traduce” (specul etapei 5): traduce un conținut în limba interfeței viewer-ului. */
export async function POST(req: Request) {
  if (!isSameOrigin(await headers())) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { contentType?: unknown; contentId?: unknown } | null;
  const contentType = typeof body?.contentType === "string" ? body.contentType : "";
  const contentId = typeof body?.contentId === "string" || typeof body?.contentId === "number" ? String(body.contentId) : "";
  if (!TYPES.has(contentType) || !/^[A-Za-z0-9_-]{1,40}$/.test(contentId)) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const result = await services().translation.translate(await currentActor(), { contentType, contentId }, await getLocale());
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GcsError) {
      return Response.json({ error: error.code, params: error.params ?? {} }, { status: error.status });
    }
    console.error("[gcs] traducerea a eșuat", error);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
