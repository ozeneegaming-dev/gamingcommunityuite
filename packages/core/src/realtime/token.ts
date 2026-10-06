import { jwtVerify, SignJWT } from "jose";

export const REALTIME_AUDIENCE = "gcs-realtime";

/** Cine se conectează la `gcs-realtime`: un membru (`userId`) sau un vizitator (`guestId`, pentru prezență). */
export type GcsRealtimeClaims = { userId: string | null; guestId: string };

const key = (secret: string) => new TextEncoder().encode(`gcs-realtime:${secret}`);

/** Secretul aplicației (`GCS_SECRET`); în dezvoltare există o valoare implicită, în producție lipsa lui e o eroare. */
export function realtimeSecret(env: Record<string, string | undefined> = process.env): string {
  if (env.GCS_SECRET) return env.GCS_SECRET;
  if (env.NODE_ENV === "production") throw new Error("GCS_SECRET lipsește");
  return "gcs-dev-secret-not-for-production-use";
}

/** Tokenul de conectare (JWT HS256, 5 minute), emis de web din sesiune. */
export async function signRealtimeToken(claims: GcsRealtimeClaims, secret: string, ttlSec = 300, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ gid: claims.guestId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId ?? "")
    .setAudience(REALTIME_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSec)
    .sign(key(secret));
}

/** Întoarce identitatea din token sau `null` (expirat, falsificat, altă audiență). */
export async function verifyRealtimeToken(token: string, secret: string, now = Date.now()): Promise<GcsRealtimeClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      audience: REALTIME_AUDIENCE,
      algorithms: ["HS256"],
      currentDate: new Date(now),
    });
    if (typeof payload.gid !== "string" || typeof payload.sub !== "string") return null;
    return { userId: payload.sub || null, guestId: payload.gid };
  } catch {
    return null;
  }
}
