import "server-only";
import { guestPresenceId, staffGroupIds, type GcsActor } from "@gcs/core";
import { describeLocation, forumContainer, normalizePrivacy, toRef, userRefSelect, type GcsLocation, type GcsUserRef } from "@gcs/modules";
import { services } from "./services";

export const ONLINE_FILTERS = ["all", "members", "staff", "guests"] as const;
export type GcsOnlineFilter = (typeof ONLINE_FILTERS)[number];

/** Locul afișat: ce face vizitatorul, cu titlul topicului / forumului / profilului doar dacă viewer-ul îl poate vedea. */
export type GcsWhereLocation = GcsLocation & { title?: string; href?: string };

export type GcsWhereRow = {
  key: string;
  kind: "user" | "guest";
  user: (GcsUserRef & { staff: boolean; hidden: boolean }) | null;
  location: GcsWhereLocation | null;
  at: string;
  /** Doar pentru staff. */
  ip: string | null;
};

export type GcsWhereView = { rows: GcsWhereRow[]; counts: Record<GcsOnlineFilter, number>; hidden: number; staffView: boolean };

/**
 * Pagina /online (Membri v2): cine e pe site acum și unde („Vede topicul X”), cu ora; IP-ul doar pentru staff. Membrii
 * cu statusul ascuns nu apar pentru ceilalți (sunt numărați); staff-ul îi vede, marcați. Titlurile topicurilor și
 * forumurilor apar doar dacă viewer-ul are acces la forum.
 */
export async function whereOnline(viewer: GcsActor, filter: GcsOnlineFilter, now = Date.now()): Promise<GcsWhereView> {
  const { whereabouts, presence, db, permissions } = services();
  const [entries, online, staffView, staffIds] = await Promise.all([whereabouts.list(now), presence.online(now), permissions.can(viewer, "mod.access"), staffGroupIds(db)]);
  const seen = new Set(entries.map((e) => `${e.kind}:${e.id}`));
  // Membrii notați de prezență, dar fără o pagină cunoscută încă (ex. doar prin chat-ul în timp real).
  const all = [...entries, ...online.users.filter((id) => !seen.has(`user:${id}`)).map((id) => ({ kind: "user" as const, id, path: "", title: "", ip: null, at: now }))];
  const userIds = all.filter((e) => e.kind === "user").map((e) => e.id);
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { ...userRefSelect, privacy: true, primaryGroupId: true, groups: { select: { groupId: true } } } });
  const byId = new Map(users.map((u) => [u.id, u]));

  // Titlurile locurilor (topicuri, forumuri, profiluri), cu accesul viewer-ului.
  const locations = new Map<string, GcsWhereLocation>();
  const topicIds = new Set<number>();
  const forumIds = new Set<number>();
  const profileRefs = new Set<string>();
  for (const e of all) {
    if (!e.path) continue;
    const loc = describeLocation(e.path);
    locations.set(e.path, loc);
    if (loc.kind === "topic") topicIds.add(loc.id);
    if (loc.kind === "forum") forumIds.add(loc.id);
    if (loc.kind === "profile") profileRefs.add(loc.ref.split("-")[0]!);
  }
  const [topics, forums, profiles] = await Promise.all([
    db.topic.findMany({ where: { id: { in: [...topicIds] }, visibility: "VISIBLE" }, select: { id: true, title: true, slug: true, forumId: true } }),
    db.forum.findMany({ where: { id: { in: [...forumIds] } }, select: { id: true, name: true, slug: true } }),
    db.user.findMany({ where: { id: { in: [...profileRefs] } }, select: { id: true, name: true } }),
  ]);
  const readable = new Set<number>();
  for (const fid of new Set([...topics.map((t) => t.forumId), ...forums.map((f) => f.id)])) {
    if (await permissions.can(viewer, "forums.read", forumContainer(fid))) readable.add(fid);
  }
  for (const [path, loc] of locations) {
    if (loc.kind === "topic") {
      const topic = topics.find((t) => t.id === loc.id);
      if (topic && readable.has(topic.forumId)) locations.set(path, { ...loc, title: topic.title, href: `/topic/${topic.id}-${topic.slug}` });
    } else if (loc.kind === "forum") {
      const forum = forums.find((f) => f.id === loc.id);
      if (forum && readable.has(forum.id)) locations.set(path, { ...loc, title: forum.name, href: `/forum/${forum.id}-${forum.slug}` });
    } else if (loc.kind === "profile") {
      const u = profiles.find((p) => p.id === loc.ref.split("-")[0]);
      if (u) locations.set(path, { ...loc, title: u.name, href: path });
    }
  }

  const counts: Record<GcsOnlineFilter, number> = { all: 0, members: 0, staff: 0, guests: 0 };
  let hidden = 0;
  const rows: GcsWhereRow[] = [];
  for (const e of all) {
    let user: GcsWhereRow["user"] = null;
    if (e.kind === "user") {
      const u = byId.get(e.id);
      if (!u) continue;
      const isHidden = !normalizePrivacy(u.privacy).showOnline;
      if (isHidden && !staffView && u.id !== viewer.userId) {
        hidden++;
        continue;
      }
      const staff = [u.primaryGroupId, ...u.groups.map((g) => g.groupId)].some((id) => staffIds.includes(id));
      user = { ...toRef(u), staff, hidden: isHidden };
    }
    const row: GcsWhereRow = { key: `${e.kind}:${e.id}`, kind: e.kind, user, location: e.path ? (locations.get(e.path) ?? null) : null, at: new Date(e.at).toISOString(), ip: staffView ? e.ip : null };
    counts.all++;
    if (e.kind === "guest") counts.guests++;
    else counts.members++;
    if (user?.staff) counts.staff++;
    if (filter === "members" && e.kind !== "user") continue;
    if (filter === "guests" && e.kind !== "guest") continue;
    if (filter === "staff" && !user?.staff) continue;
    rows.push(row);
  }
  // Vizitatorii văzuți doar de prezență (fără pagină): numărați, nu listați.
  const knownGuests = new Set(entries.filter((e) => e.kind === "guest").map((e) => e.id));
  const extraGuests = Math.max(0, online.guests - knownGuests.size);
  counts.guests += extraGuests;
  counts.all += extraGuests;
  return { rows, counts, hidden, staffView };
}

/** Id-ul de prezență al vizitatorului curent (pentru „tu”). */
export const guestKeyFor = (ip: string) => `guest:${guestPresenceId(ip)}`;
