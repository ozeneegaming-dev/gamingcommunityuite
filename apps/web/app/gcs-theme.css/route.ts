import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * CSS-ul publicat al unei teme (specul etapei 5, „Teme”): `?t=<cheie>&v=<versiune>`. Doar temele active; altfel
 * tema implicită. Când versiunea din URL e cea curentă, browserul îl poate păstra mult (la „Publică” URL-ul se schimbă).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { themes } = services();
  const theme = await themes.active(url.searchParams.get("t"));
  const current = url.searchParams.get("v") === String(theme.version);
  return new Response(themes.css(theme), {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": current ? "public, max-age=86400" : "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
