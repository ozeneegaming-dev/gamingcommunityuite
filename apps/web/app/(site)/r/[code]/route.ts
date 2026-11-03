import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS } from "@gcs/modules";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

/**
 * Linkul de invitație `/r/<id>`: lasă cookie-ul recomandării (30 de zile; contul creat cu el, pe orice cale, se leagă
 * de cel care a invitat) și duce la înregistrare. Un link invalid sau programul oprit duce doar la pagina principală.
 * Adresa de redirecționare e relativă (în spatele proxy-ului, `req.url` poate fi adresa internă).
 */
export async function GET(req: Request, { params }: Props): Promise<Response> {
  const { code } = await params;
  const valid = /^[A-Za-z0-9_-]{8,40}$/.test(code) && (await services().referrals.validReferrer(code).catch(() => false));
  const headers = new Headers({ Location: valid ? "/register" : "/", "Cache-Control": "no-store" });
  if (valid) {
    const secure = req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
    headers.append("Set-Cookie", `${REFERRAL_COOKIE}=${code}; Path=/; Max-Age=${REFERRAL_COOKIE_DAYS * 86_400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  }
  return new Response(null, { status: 303, headers });
}
