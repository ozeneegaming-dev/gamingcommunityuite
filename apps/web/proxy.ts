import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "./lib/actor";
import { getAuth } from "./lib/auth";
import { services } from "./lib/services";

/** Căile disponibile și în mentenanță: login-ul (staff-ul trebuie să poată intra), autentificarea și health-check-ul. */
const MAINTENANCE_EXEMPT = [/^\/login$/, /^\/api\/auth\//, /^\/api\/health$/, /^\/maintenance$/, /^\/gcs-names\.css$/];

/** Actorul are `acp.access` (staff-ul vede site-ul normal în mentenanță). */
async function hasAcpAccess(request: NextRequest): Promise<boolean> {
  const { actors, permissions } = services();
  const session = await (await getAuth()).api.getSession({ headers: request.headers });
  if (!session) return false;
  const actor = await actors.getActor({ sessionToken: session.session.token, ip: clientIp(request.headers) });
  return permissions.can(actor, "acp.access");
}

/**
 * Proxy-ul Next.js 16 (fostul middleware), rulat pe Node.js înaintea fiecărei pagini.
 * Mod mentenanță (spec §12.1, Setări → Avansat): cine nu are `acp.access` primește pagina de mentenanță cu 503.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  if (!MAINTENANCE_EXEMPT.some((r) => r.test(path))) {
    const maintenance = await services()
      .settings.get<boolean>("system.maintenance")
      .catch(() => false);
    if (maintenance && !(await hasAcpAccess(request))) {
      return NextResponse.rewrite(new URL("/maintenance", request.url), {
        status: 503,
        headers: { "Retry-After": "300", "Cache-Control": "no-store" },
      });
    }
  }
  return NextResponse.next();
}

export const config = {
  // Fără fișierele statice (le servește Next.js direct).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)"],
};
