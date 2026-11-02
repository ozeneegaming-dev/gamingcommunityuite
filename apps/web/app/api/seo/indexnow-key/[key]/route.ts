import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ key: string }> };

/**
 * Fișierul cheii IndexNow (`/<cheie>.txt`, rescris de proxy aici): conținutul e cheia, doar dacă e cheia salvată în
 * ACP → Promovare → SEO; orice altă cheie → 404. Motoarele îl citesc ca să verifice că anunțurile vin de la site.
 */
export async function GET(_req: Request, { params }: Props): Promise<Response> {
  const { key } = await params;
  if (!/^[a-f0-9]{32}$/.test(key)) return new Response(null, { status: 404 });
  const served = await services()
    .indexNow.servedKey(key)
    .catch(() => null);
  if (!served) return new Response(null, { status: 404 });
  return new Response(served, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
