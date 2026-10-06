import "server-only";
import { isPluginKey } from "@gcs/core";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { cache } from "react";
import { currentActor } from "./actor";
import { services } from "./services";

/** Cookie-ul modului sigur (`?safe=1`): doar o cerere; fiecare request verifică din nou că e un Root Admin. */
export const SAFE_MODE_COOKIE = "gcs-safe-mode";
export const SAFE_MODE_PARAM = "safe";

/** Actorul e Root Admin (grupul `root_admin`, nebanat). */
export async function isRootAdmin(actor: { userId: string | null; groupIds: number[]; isBanned: boolean }): Promise<boolean> {
  if (!actor.userId || actor.isBanned) return false;
  const groups = await services().db.group.findMany({ where: { id: { in: actor.groupIds } }, select: { key: true } });
  return groups.some((g) => g.key === "root_admin") && !groups.some((g) => g.key === "banned");
}

/**
 * Modul sigur al cererii curente (designul pluginurilor §3.5): cookie-ul `gcs-safe-mode` și un Root Admin. Un cookie
 * pus de altcineva nu schimbă nimic (pluginurile rulează normal pentru el).
 */
export const safeModeActive = cache(async (): Promise<boolean> => {
  if ((await cookies()).get(SAFE_MODE_COOKIE)?.value !== "1") return false;
  return isRootAdmin(await currentActor());
});

/** Gazda pluginurilor, după prima încărcare (cel mult 3 s la pornirea serverului). */
export async function pluginHost() {
  const { plugins } = services();
  await plugins.ready();
  return plugins;
}

/**
 * HTML-ul pluginurilor pentru un punct de extensie (ex. `postbit.after_fields`), sanitizat și în ordinea priorității;
 * gol în modul sigur sau fără pluginuri pe punct (fără niciun apel). Folosit de componente și de `{% hook %}` din șabloane.
 */
export async function pluginHookHtml(point: string, data: Record<string, string | number | null>): Promise<string[]> {
  const plugins = await pluginHost();
  if (!plugins.hasHook(point) || (await safeModeActive())) return [];
  const [actor, locale] = await Promise.all([currentActor(), getLocale()]);
  return (await plugins.renderHook(point, data, { actor, locale })).map((p) => p.html);
}

/** Cheia unui plugin din URL (`/p/<cheie>`, `/api/plugins/<cheie>`), sau `null`. */
export function pluginKeyParam(raw: string): string | null {
  const key = decodeURIComponent(raw);
  return isPluginKey(key) ? key : null;
}

/** Parametrii de căutare ca text simplu (cel mult 20, valori ≤ 500 de caractere), pentru paginile pluginurilor. */
export function pluginQuery(params: Record<string, string | string[] | undefined> | URLSearchParams): Record<string, string> {
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v] as const);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (typeof v !== "string" || k === SAFE_MODE_PARAM || !/^[A-Za-z0-9_.-]{1,40}$/.test(k)) continue;
    out[k] = v.slice(0, 500);
    if (Object.keys(out).length >= 20) break;
  }
  return out;
}
