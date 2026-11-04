import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Click-ul pe o reclamă: se numără (ACP › Promovare › Reclame), apoi duce la adresa ei. Fără reclamă → pagina principală. */
export async function GET(_req: Request, { params }: Props): Promise<Response> {
  const { id } = await params;
  const target = /^\d{1,9}$/.test(id) ? await services().ads.click(Number(id)).catch(() => null) : null;
  return new Response(null, { status: 302, headers: { Location: target ?? "/", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
