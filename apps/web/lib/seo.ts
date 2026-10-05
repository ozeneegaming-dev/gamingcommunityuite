import "server-only";
import type { GcsActor } from "@gcs/core";
import { services } from "./services";

/** Adresa publică a site-ului: setarea `site.url`, altfel `GCS_BASE_URL`. Fără `/` la final. */
export async function siteBaseUrl(): Promise<string> {
  let url = "";
  try {
    url = await services().settings.get<string>("site.url");
  } catch {
    // Baza poate lipsi (ex. înainte de instalare).
  }
  url ||= process.env.GCS_BASE_URL ?? "http://localhost:3000";
  return URL.canParse(url) ? new URL(url).origin : "http://localhost:3000";
}

/** Un vizitator (fără cont): ce văd motoarele de căutare. */
export async function guestActor(): Promise<GcsActor> {
  const guest = await services().db.group.findUniqueOrThrow({ where: { key: "guest" }, select: { id: true } });
  return { userId: null, groupIds: [guest.id], primaryGroupId: guest.id, isBanned: false, ip: "0.0.0.0" };
}

/** Textul simplu dintr-un HTML de postare (deja sanitizat), scurtat la `max` caractere, pentru descrieri. */
export function excerpt(html: string, max = 200): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** Prima imagine dintr-un HTML de postare (pentru OpenGraph). */
export function firstImage(html: string): string | null {
  return /<img[^>]+src="([^"]+)"/.exec(html)?.[1] ?? null;
}
