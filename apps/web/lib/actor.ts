import "server-only";
import type { GcsActor } from "@gcs/core";
import { headers } from "next/headers";
import { getAuth } from "./auth";
import { services } from "./services";

/**
 * IP-ul clientului. În producție, Caddy e singurul proxy din fața aplicației și setează `X-Forwarded-For`;
 * prima adresă din listă e a clientului.
 */
export function clientIp(h: Headers): string {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "0.0.0.0";
}

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

/** Actorul request-ului curent: sesiunea validată de Better Auth, apoi grupurile și bannurile (`getActor`). */
export async function currentActor(): Promise<GcsActor> {
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
}
