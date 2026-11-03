import { GcsError } from "@gcs/core";
import { FILES_ACP_SECTION } from "@gcs/modules";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Previzualizarea unui fișier în ACP › Sistem › Fișiere (miniatura cu `?thumb=1`): și fișierele pe care adminul nu le-ar
 * vedea pe site (ex. încărcate de alt membru și încă nelegate). Fără poarta ACP sau dreptul pe secțiune → 404, ca
 * restul ACP-ului. Aceleași anteturi de siguranță ca `/files/<id>`.
 */
export async function GET(req: Request, { params }: Props): Promise<Response> {
  const { id } = await params;
  const ctx = await getAcpContext();
  const { acp, attachments } = services();
  if (ctx.state !== "ok" || !(await acp.can(ctx.actor, FILES_ACP_SECTION, "view"))) return new Response("Not Found", { status: 404 });
  try {
    const file = await attachments.openTrusted(id, { thumb: new URL(req.url).searchParams.get("thumb") === "1" });
    return new Response(file.body, {
      headers: {
        "Content-Type": file.mime === "text/plain" ? "text/plain; charset=utf-8" : file.mime,
        "Content-Length": String(file.size),
        "Content-Disposition": `${file.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof GcsError) return new Response(null, { status: error.status === 403 ? 404 : error.status });
    throw error;
  }
}
