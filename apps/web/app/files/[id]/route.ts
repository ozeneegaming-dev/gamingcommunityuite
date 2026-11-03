import { GcsError, parseByteRange } from "@gcs/core";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Descărcarea unui atașament (spec §15). Accesul îl decide `GcsAttachmentService.open` (permisiunile conținutului).
 * Imaginile se afișează în pagină; restul se descarcă. `nosniff` + CSP `sandbox`: browserul nu interpretează fișierul.
 * Videoul antetului răspunde și la cererile `Range` (206), fără de care unele browsere (Safari) nu-l redau.
 */
export async function GET(req: Request, { params }: Props): Promise<Response> {
  const { id } = await params;
  // `?thumb=1`: miniatura imaginii (ACP → Setări → Încărcări și imagini), dacă are una; altfel fișierul întreg.
  const thumb = new URL(req.url).searchParams.get("thumb") === "1";
  let unsatisfiable = false;
  const range = (size: number) => {
    const r = parseByteRange(req.headers.get("range"), size);
    if (r !== "unsatisfiable") return r;
    unsatisfiable = true;
    return null;
  };
  try {
    const file = await services().attachments.open(await currentActor(), id, { thumb, range });
    const disposition = `${file.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`;
    const headers: Record<string, string> = {
      "Content-Type": file.mime === "text/plain" ? "text/plain; charset=utf-8" : file.mime,
      "Content-Length": String(file.size),
      "Content-Disposition": disposition,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
      "Cache-Control": "private, max-age=3600",
    };
    if (file.seekable) headers["Accept-Ranges"] = "bytes";
    if (unsatisfiable) {
      await file.body.cancel().catch(() => {});
      return new Response(null, { status: 416, headers: { ...headers, "Content-Length": "0", "Content-Range": `bytes */${file.size}` } });
    }
    if (file.range) {
      const { start, end } = file.range;
      return new Response(file.body, { status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${file.size}` } });
    }
    return new Response(file.body, { headers });
  } catch (error) {
    if (error instanceof GcsError) return new Response(null, { status: error.status === 403 ? 404 : error.status });
    throw error;
  }
}
