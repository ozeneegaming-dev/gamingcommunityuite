import "server-only";
import type { GcsNotificationListOptions, GcsNotificationTab, GcsNotificationView } from "@gcs/core";
import { notificationText, toRef, userRefSelect, type GcsUserRef } from "@gcs/modules";
import { services } from "./services";

/**
 * O notificare gata de afișat (clopoțel, pagina `/notifications`, toast): textul tradus (cu gruparea „Ana și alți 3”),
 * linkul, primul actor (numele stilizat), cei mai recenți actori (avatarele) și categoria (iconița).
 */
export type GcsNotificationItem = {
  id: number;
  type: string;
  text: string;
  href: string;
  snippet: string | null;
  read: boolean;
  important: boolean;
  count: number;
  updatedAt: string;
  actor: GcsUserRef | null;
  actors: GcsUserRef[];
  icon: string;
};

/** Iconița categoriei fiecărui tip (din catalogul aplicațiilor active). */
async function typeIcons(): Promise<Map<string, string>> {
  const catalog = await services().notifications.catalog();
  return new Map(catalog.flatMap((c) => c.types.map((t) => [t.key, c.icon] as const)));
}

async function toItems(rows: GcsNotificationView[], locale: string): Promise<GcsNotificationItem[]> {
  const { db } = services();
  const ids = [...new Set(rows.flatMap((r) => r.actorIds))];
  const [users, icons] = await Promise.all([
    ids.length > 0 ? db.user.findMany({ where: { id: { in: ids } }, select: userRefSelect }) : Promise.resolve([]),
    typeIcons(),
  ]);
  const refs = new Map(users.map((u) => [u.id, toRef(u)] as const));
  return rows.map((r) => {
    const actors = r.actorIds.map((id) => refs.get(id)).filter((u): u is GcsUserRef => !!u);
    return {
      id: r.id,
      type: r.type,
      text: notificationText({ type: r.type, actors: actors.map((a) => a.name), count: r.count, title: typeof r.data.title === "string" ? r.data.title : "", data: r.data }, locale),
      href: typeof r.data.href === "string" ? r.data.href : "/notifications",
      snippet: typeof r.data.snippet === "string" && r.data.snippet ? r.data.snippet : null,
      read: r.read,
      important: r.important,
      count: r.count,
      updatedAt: r.updatedAt,
      actor: actors[0] ?? null,
      actors,
      icon: icons.get(r.type) ?? "fa-solid fa-bell",
    };
  });
}

export async function notificationItems(userId: string, locale: string, opts: GcsNotificationListOptions = {}): Promise<GcsNotificationItem[]> {
  return toItems(await services().notifications.list(userId, opts), locale);
}

/** O singură notificare a userului (și una doar pentru toast), pentru toast-ul live. */
export async function notificationItem(userId: string, id: number, locale: string): Promise<GcsNotificationItem | null> {
  const row = await services().notifications.get(userId, id);
  return row ? ((await toItems([row], locale))[0] ?? null) : null;
}

/** Ziua calendaristică (YYYY-MM-DD) a unui moment, în fusul dat (fus invalid → UTC). */
function localDay(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Secțiunea listei (Azi, Ieri, Săptămâna aceasta, Mai vechi) a unei notificări, în fusul orar al membrului. */
export function daySection(iso: string, now: Date, timeZone: string): "today" | "yesterday" | "week" | "older" {
  const days = Math.round((Date.parse(localDay(now, timeZone)) - Date.parse(localDay(new Date(iso), timeZone))) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  return "older";
}

/** Taburile paginii notificărilor și tabul cerut (necunoscut → „Toate”). */
export async function notificationTab(key: string | undefined): Promise<{ tabs: GcsNotificationTab[]; tab: GcsNotificationTab }> {
  const tabs = await services().notifications.tabs();
  return { tabs, tab: tabs.find((t) => t.key === key) ?? tabs[0]! };
}
