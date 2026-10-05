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

/** Actorul request-ului curent: sesiunea validată de Better Auth, apoi grupurile și bannurile (`getActor`). */
export async function currentActor(): Promise<GcsActor> {
  const h = await headers();
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: h });
  const req: { sessionToken?: string; ip: string } = { ip: clientIp(h) };
  if (session) req.sessionToken = session.session.token;
  return services().actors.getActor(req);
}
