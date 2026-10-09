import "server-only";
import { headers } from "next/headers";
import { getAuth } from "./auth";

/** Cât de recentă trebuie să fie autentificarea unui cont fără parolă ca să-și poată cere ștergerea (specul §5). */
export const FRESH_SIGN_IN_MS = 15 * 60_000;

/** Sesiunea curentă a fost creată în ultimele 15 minute (o autentificare „proaspătă”). */
export async function freshSignIn(now = Date.now()): Promise<boolean> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  return session !== null && now - new Date(session.session.createdAt).getTime() <= FRESH_SIGN_IN_MS;
}
