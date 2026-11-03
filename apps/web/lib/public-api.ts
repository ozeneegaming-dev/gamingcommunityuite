import "server-only";
import { GcsError, type GcsActor } from "@gcs/core";
import type { GcsApiScope } from "@gcs/modules";
import { clientIp } from "./client-ip";
import { services } from "./services";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * O rută `/api/v1` (ACP › Sistem › API): cheia din `Authorization: Bearer gcs_…` cu dreptul `scope`, apoi datele
 * văzute ca vizitator (`fn` → `null` = 404). Răspunsul e `{ data }` sau `{ error }`; cererile cu o cheie validă se
 * notează în jurnalul cheii.
 */
export async function publicApiRoute(req: Request, scope: GcsApiScope, fn: (guest: GcsActor, url: URL) => Promise<unknown>): Promise<Response> {
  const { apiKeys, actors } = services();
  const ip = clientIp(req.headers);
  const url = new URL(req.url);
  let keyId: number;
  try {
    keyId = await apiKeys.authorize(req.headers.get("authorization"), scope);
  } catch (error) {
    if (!(error instanceof GcsError)) throw error;
    const headers: Record<string, string> = { ...NO_STORE, "WWW-Authenticate": 'Bearer realm="gcs"' };
    if (error.params?.retryAfter) headers["Retry-After"] = error.params.retryAfter;
    return Response.json({ error: error.params?.reason ?? error.code }, { status: error.status, headers });
  }
  let status = 200;
  try {
    const data = await fn(await actors.forGuest(ip), url);
    if (data === null) {
      status = 404;
      return Response.json({ error: "not_found" }, { status, headers: NO_STORE });
    }
    return Response.json({ data }, { headers: NO_STORE });
  } catch (error) {
    status = 500;
    throw error;
  } finally {
    await apiKeys.record(keyId, { at: Date.now(), path: url.pathname, status, ip });
  }
}
