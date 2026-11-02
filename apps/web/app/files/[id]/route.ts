import { GcsError } from "@gcs/core";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Descărcarea unui atașament (spec §15). Accesul îl decide `GcsAttachmentService.open` (permisiunile conținutului).
 * Imaginile se afișează în pagină; restul se descarcă. `nosniff` + CSP `sandbox`: browserul nu interpretează fișierul.
 */
export async function GET(req: Request, { params }: Props): Promise<Response> {
  const { id } = await params;
  // `?thumb=1`: miniatura imaginii (ACP → Setări → Încărcări și imagini), dacă are una; altfel fișierul întreg.
  const thumb = new URL(req.url).searchParams.get("thumb") === "1";
  try {
    const file = await services().attachments.open(await currentActor(), id, { thumb });
    const disposition = `${file.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`;
    return new Response(file.body, {
      headers: {
        "Content-Type": file.mime === "text/plain" ? "text/plain; charset=utf-8" : file.mime,
        "Content-Length": String(file.size),
        "Content-Disposition": disposition,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof GcsError) return new Response(null, { status: error.status === 403 ? 404 : error.status });
    throw error;
  }
}
