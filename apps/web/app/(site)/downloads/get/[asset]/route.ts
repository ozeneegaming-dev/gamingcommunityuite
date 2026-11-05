import { GcsError, GcsRateLimited } from "@gcs/core";
import { downloadFileHref } from "@gcs/modules";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ asset: string }> };

/**
 * Descărcarea unui fișier (fără linkuri directe): tokenul din pagina fișierului (`?t=`), drepturile categoriei, VIP-ul și
 * limita pe membru, verificate de `downloads.service.open` la fiecare cerere. Fișierul iese din stocarea privată în flux,
 * mereu ca atașament; un link extern e o redirecționare. Fără drept / token expirat → înapoi la pagina fișierului.
 */
export async function GET(req: Request, { params }: Props): Promise<Response> {
  const { asset } = await params;
  const { downloads, db } = services();
  const token = new URL(req.url).searchParams.get("t");
  try {
    const opened = await downloads.service.open(await currentActor(), asset, token);
    if (opened.kind === "redirect") return Response.redirect(opened.url, 302);
    const safe = opened.name.replace(/[^A-Za-z0-9_.-]/g, "_");
    return new Response(opened.body, {
      headers: {
        "Content-Type": opened.mime || "application/octet-stream",
        "Content-Length": String(opened.size),
        "Content-Disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(opened.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof GcsRateLimited) return new Response(null, { status: 429, headers: { "Retry-After": error.params?.retryAfter ?? "600" } });
    if (error instanceof GcsError && error.status === 403) {
      // Linkul copiat în altă parte (token lipsă / expirat) sau fără drept: pagina fișierului explică de ce.
      const row = /^[a-z0-9]{8,40}$/i.test(asset) ? await db.downloadAsset.findUnique({ where: { id: asset }, select: { file: { select: { id: true, slug: true } } } }) : null;
      if (row?.file) return Response.redirect(new URL(downloadFileHref(row.file), req.url), 303);
      return new Response(null, { status: 404 });
    }
    if (error instanceof GcsError) return new Response(null, { status: error.status });
    throw error;
  }
}
