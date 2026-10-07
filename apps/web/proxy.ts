import { GcsInstallState, installGate } from "@gcs/core";
import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "./lib/actor";
import { getAuth } from "./lib/auth";
import { gcsConfigDir } from "./lib/config";
import { isMaintenanceExempt } from "./lib/maintenance";
import { isRootAdmin, SAFE_MODE_COOKIE, SAFE_MODE_PARAM } from "./lib/plugins";
import { services } from "./lib/services";
import { previewKeyFor, THEME_PREVIEW_COOKIE, THEME_PREVIEW_HEADER, THEME_PREVIEW_PARAM } from "./lib/theme-preview";

/** Odată instalat, rămâne instalat: nu mai verificăm fișierul la fiecare request. */
let installedCache = false;

async function isInstalled(): Promise<boolean> {
  if (!installedCache) installedCache = await new GcsInstallState(gcsConfigDir()).isInstalled();
  return installedCache;
}

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
 * Poarta instalării, apoi modul mentenanță (spec §12.1, Setări → Avansat): cine nu are `acp.access` primește pagina de mentenanță cu 503.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;

  // Poarta instalării (spec §17.1): înainte de instalare, totul duce la /install; după, /install nu mai există.
  const gate = installGate(path, await isInstalled());
  if (gate === "redirect") return NextResponse.redirect(new URL("/install", request.url), 307);
  if (gate === "not_found") return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  if (path === "/install" || path.startsWith("/install/")) return NextResponse.next();

  if (!isMaintenanceExempt(path)) {
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
  const safe = await withSafeMode(request);
  if (safe) return safe;
  return withThemePreview(request);
}

/**
 * Modul sigur al pluginurilor (etapa 6): `?safe=1` îl pornește doar pentru un Root Admin (cookie de sesiune), `?safe=0`
 * îl oprește. Parametrul dispare din adresă. Paginile verifică la fiecare cerere că cookie-ul e al unui Root Admin.
 */
async function withSafeMode(request: NextRequest): Promise<NextResponse | null> {
  const value = request.nextUrl.searchParams.get(SAFE_MODE_PARAM);
  if (value !== "0" && value !== "1") return null;
  const url = request.nextUrl.clone();
  url.searchParams.delete(SAFE_MODE_PARAM);
  const response = NextResponse.redirect(url, 303);
  if (value === "0") {
    response.cookies.delete(SAFE_MODE_COOKIE);
    return response;
  }
  const { actors } = services();
  const session = await (await getAuth()).api.getSession({ headers: request.headers }).catch(() => null);
  const actor = session ? await actors.getActor({ sessionToken: session.session.token, ip: clientIp(request.headers) }) : null;
  if (actor && (await isRootAdmin(actor))) {
    response.cookies.set(SAFE_MODE_COOKIE, "1", { path: "/", httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  }
  return response;
}

/**
 * Previzualizarea editorului vizual de temă: `?gcs-theme-preview=<cheie>` (sau cookie-ul lui, doar în `iframe`) devine
 * header-ul intern citit de layout. Header-ul trimis de client e mereu șters. Layout-ul verifică apoi dreptul pe teme.
 */
function withThemePreview(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(THEME_PREVIEW_HEADER);
  const param = request.nextUrl.searchParams.get(THEME_PREVIEW_PARAM);
  const key = previewKeyFor(param, request.cookies.get(THEME_PREVIEW_COOKIE)?.value, request.headers.get("sec-fetch-dest"));
  if (key) headers.set(THEME_PREVIEW_HEADER, key);
  const response = NextResponse.next({ request: { headers } });
  if (param !== null && key) {
    response.cookies.set(THEME_PREVIEW_COOKIE, key, { path: "/", httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  }
  return response;
}

export const config = {
  // Fără fișierele statice (le servește Next.js direct).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)"],
};
