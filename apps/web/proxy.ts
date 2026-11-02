import { GcsInstallState, installGate, loadMfaRequiredGroups, mfaSetupRequired, type GcsActor } from "@gcs/core";
import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "./lib/actor";
import { getAuth } from "./lib/auth";
import { gcsConfigDir } from "./lib/config";
import { isMaintenanceExempt } from "./lib/maintenance";
import { NAV_PREVIEW_COOKIE, NAV_PREVIEW_HEADER, NAV_PREVIEW_PARAM, navPreviewFor } from "./lib/nav-preview";
import { isRootAdmin, SAFE_MODE_COOKIE, SAFE_MODE_PARAM } from "./lib/plugins";
import { services } from "./lib/services";
import { previewKeyFor, SITE_AREA_HEADER, SITE_PATH_HEADER, siteAreaFor, THEME_PREVIEW_COOKIE, THEME_PREVIEW_HEADER, THEME_PREVIEW_PARAM } from "./lib/theme-preview";

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

/** Adresa alternativă a indexului forumului (când pagina de pornire e altă aplicație); vezi `lib/landing.ts`. */
const FORUM_INDEX_ALT = "/forum";

/** Actorul cererii (membru sau vizitator), pentru accesul pe grup la aplicații. */
async function requestActor(request: NextRequest): Promise<GcsActor> {
  const session = await (await getAuth()).api.getSession({ headers: request.headers }).catch(() => null);
  return services().actors.getActor({ ...(session ? { sessionToken: session.session.token } : {}), ip: clientIp(request.headers) });
}

/**
 * Aplicațiile (specul 2026-10-09-acp-navigatie-aplicatii §2.3–2.4):
 * - o cale a unei aplicații restricționate pe grup (`app.routes`) răspunde 404 celor fără acces (paginile, API-ul);
 * - `/` se rescrie intern (adresa rămâne `/`) spre pagina aplicației de pornire, dacă nu e Forumul și vizitatorul o
 *   poate accesa; altfel `/` randează Forumul, iar `/forum` duce (307) pe `/`. `/` nu redirecționează niciodată: fără bucle.
 * Actorul se calculează doar pentru aplicațiile restricționate. Baza indisponibilă: paginile decid singure.
 */
async function appRouting(request: NextRequest): Promise<NextResponse | URL | null> {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/admin") || path.startsWith("/_next/")) return null;
  const { apps } = services();
  try {
    if (path === "/" || path === FORUM_INDEX_ALT) {
      const target = await apps.landingFor(null);
      // Pornirea e o aplicație restricționată pe grup pe care vizitatorul nu o poate accesa: `/` îi arată Forumul.
      const usable = target !== null && (!(await apps.restrictedApps()).has(target.key) || (await apps.canAccess(await requestActor(request), target.key)));
      const url = request.nextUrl.clone();
      if (path === "/") {
        if (!usable) return null;
        url.pathname = target.href;
        return url;
      }
      // `/forum` când `/` arată chiar forumul: redirect HTTP spre `/` (o singură adresă; `/` nu redirecționează niciodată).
      if (usable) return null;
      url.pathname = "/";
      return NextResponse.redirect(url, 307);
    }
    const app = apps.routeApp(path);
    if (!app || !(await apps.restrictedApps()).has(app)) return null;
    if (await apps.canAccess(await requestActor(request), app)) return null;
    if (path.startsWith("/api/")) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  } catch {
    return null;
  }
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
  const mfa = await mfaGate(request);
  if (mfa) return mfa;
  const safe = await withSafeMode(request);
  if (safe) return safe;
  const legacy = await legacyRedirect(request);
  if (legacy) return legacy;
  const routed = await appRouting(request);
  if (routed instanceof NextResponse) return routed;
  return withThemePreview(request, routed);
}

/** Pagina pe care membrul își activează 2FA (Setări → Securitate). */
const MFA_SETUP_PATH = "/settings/security";
/**
 * Ce rămâne deschis cât timp 2FA e obligatoriu și încă neactivat: configurarea, API-ul (autentificarea, ieșirea), ACP-ul
 * (cere oricum 2FA, cu pagina lui de configurare), intrarea, „Am uitat parola”, paginile legale și fișierele.
 */
const MFA_OPEN = [/^\/settings\/security(\/|$)/, /^\/api\//, /^\/_next\//, /^\/admin(\/|$)/, /^\/(login|register|forgot-password|reset-password|terms|privacy|rules|maintenance|install)(\/|$)/, /\.[a-z0-9]{2,5}$/i];

/**
 * 2FA obligatoriu pe grupuri (ACP → Setări → Securitate): un membru dintr-un grup ales, fără 2FA activ, e trimis la
 * Setări → Securitate până îl activează (orice pagină, inclusiv navigarea din aplicație și Server Actions). Fără grupuri
 * alese sau fără cookie de sesiune nu costă nimic în plus; o eroare nu blochează site-ul.
 */
async function mfaGate(request: NextRequest): Promise<NextResponse | null> {
  const path = request.nextUrl.pathname;
  if (MFA_OPEN.some((r) => r.test(path))) return null;
  if (!request.cookies.getAll().some((c) => c.name.endsWith("session_token"))) return null;
  try {
    const { settings, actors } = services();
    const required = await loadMfaRequiredGroups(settings);
    if (required.length === 0) return null;
    const session = await (await getAuth()).api.getSession({ headers: request.headers });
    if (!session || (session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true) return null;
    const actor = await actors.getActor({ sessionToken: session.session.token, ip: clientIp(request.headers) });
    if (!actor.userId || !mfaSetupRequired({ groupIds: actor.groupIds, twoFactorEnabled: false }, required)) return null;
    const url = request.nextUrl.clone();
    url.pathname = MFA_SETUP_PATH;
    url.search = "?mfa=required";
    return NextResponse.redirect(url, 307);
  } catch {
    return null;
  }
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
 * Redirecturile 301 de la adresele site-ului vechi, după importul din altă platformă (ACP → Sistem → Conversii).
 * Oprite (implicit), costă o citire din cache-ul Redis; baza de date se întreabă doar pentru o adresă care arată ca
 * una veche. Next cere aici o adresă absolută; pe același host o trimite clientului relativă (în build-ul standalone
 * host-ul din `request.url` e cel intern).
 */
async function legacyRedirect(request: NextRequest): Promise<NextResponse | null> {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") || path.startsWith("/admin") || path.startsWith("/_next/")) return null;
  const target = await services()
    .importer.resolveLegacy(path, request.nextUrl.search)
    .catch(() => null);
  if (!target) return null;
  return NextResponse.redirect(new URL(target, request.url), 301);
}

/**
 * Previzualizarea editorului vizual de temă: `?gcs-theme-preview=<cheie>` (sau cookie-ul lui, doar în `iframe`) devine
 * header-ul intern citit de layout. Header-ul trimis de client e mereu șters. Layout-ul verifică apoi dreptul pe teme.
 */
function withThemePreview(request: NextRequest, rewrite: URL | null = null): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(THEME_PREVIEW_HEADER);
  // Zona cererii (ACP sau site), pentru clasa designului temei; valoarea venită din afară e suprascrisă.
  headers.set(SITE_AREA_HEADER, siteAreaFor(request.nextUrl.pathname));
  // Calea cererii (pentru layout: consola Hero Cockpit se calculează pe server doar pe paginile unde apare).
  headers.set(SITE_PATH_HEADER, request.nextUrl.pathname);
  const param = request.nextUrl.searchParams.get(THEME_PREVIEW_PARAM);
  const key = previewKeyFor(param, request.cookies.get(THEME_PREVIEW_COOKIE)?.value, request.headers.get("sec-fetch-dest"));
  if (key) headers.set(THEME_PREVIEW_HEADER, key);
  // Manager meniu v2: previzualizarea ciornei meniului (același mecanism; header-ul venit din afară e șters).
  headers.delete(NAV_PREVIEW_HEADER);
  const navParam = request.nextUrl.searchParams.get(NAV_PREVIEW_PARAM);
  const navPreview = navPreviewFor(navParam, request.cookies.get(NAV_PREVIEW_COOKIE)?.value, request.headers.get("sec-fetch-dest"));
  if (navPreview) headers.set(NAV_PREVIEW_HEADER, "1");
  // Aplicația de pornire: `/` rescris intern spre pagina ei (cu aceleași headere ale cererii).
  const response = rewrite ? NextResponse.rewrite(rewrite, { request: { headers } }) : NextResponse.next({ request: { headers } });
  if (param !== null && key) {
    response.cookies.set(THEME_PREVIEW_COOKIE, key, { path: "/", httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  }
  if (navParam !== null && navPreview) {
    response.cookies.set(NAV_PREVIEW_COOKIE, "1", { path: "/", httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  }
  return response;
}

export const config = {
  // Fără fișierele statice (le servește Next.js direct).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)"],
};
