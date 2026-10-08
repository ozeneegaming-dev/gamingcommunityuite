import "server-only";
import type { GcsActor } from "@gcs/core";
import { headers } from "next/headers";
import { cache } from "react";
import { getAuth } from "./auth";
import { clientIp } from "./client-ip";
import { services } from "./services";

export { clientIp };

const SESSION_COOKIES = ["__Secure-gcs.session_token", "gcs.session_token"];

/**
 * Token-ul din cookie-ul de sesiune (`<token>.<semnătură>`), fără verificarea semnăturii. Se folosește doar când
 * Better Auth nu mai găsește sesiunea, ca `getActor` să recunoască o sesiune revocată la ban.
 */
function rawSessionToken(cookieHeader: string | null): string | undefined {
  for (const part of cookieHeader?.split(";") ?? []) {
    const [name, ...rest] = part.trim().split("=");
    if (name && SESSION_COOKIES.includes(name)) return decodeURIComponent(rest.join("=")).split(".")[0] || undefined;
  }
  return undefined;
}

/**
 * Actorul request-ului curent: sesiunea validată de Better Auth, apoi grupurile și bannurile (`getActor`).
 * Calculat o singură dată pe request (`cache`): layout-ul, header-ul, pagina și widget-urile îl cer fiecare, iar
 * fiecare calcul înseamnă sesiunea, două verificări de ban și prezența (zeci de interogări repetate altfel).
 */
export const currentActor = cache(async (): Promise<GcsActor> => {
  const h = await headers();
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: h });
  const req: { sessionToken?: string; staleSessionToken?: string; ip: string } = { ip: clientIp(h) };
  if (session) {
    req.sessionToken = session.session.token;
  } else {
    const stale = rawSessionToken(h.get("cookie"));
    if (stale) req.staleSessionToken = stale;
  }
  return services().actors.getActor(req);
});
