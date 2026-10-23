import type { GcsMail, GcsNotificationService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { slugify } from "../forums/slug";
import { notificationText, type GcsNotificationMailItem } from "./emails";

/**
 * Rezumatul săptămânal „Ce ai ratat” (Notificări v2, ideea 19 din backlog): topicurile populare ale săptămânii pe care
 * membrul le poate citi, mențiunile lui necitite, momentele serverelor (cu aplicația Servere activă) și secțiunile
 * aduse de alte aplicații. Livrarea urmează canalele tipului `core.weekly_digest` (implicit: emailul pornit, pe site un
 * rând în clopoțel); notificările cu emailul „săptămânal” intră în același email.
 */

export const WEEKLY_DIGEST_TYPE = "core.weekly_digest";
export const WEEKLY_TARGET = "core.weekly";
const WEEK_MS = 7 * 86_400_000;
const TOPIC_CANDIDATES = 15;
const TOPICS_SHOWN = 5;
const MENTIONS_SHOWN = 3;
const SERVERS_SHOWN = 3;

export type GcsWeeklyTopic = { id: number; title: string; href: string; replies: number; views: number };
export type GcsWeeklyMention = { text: string; href: string; at: string };
export type GcsWeeklyServer = { id: number; name: string; href: string; peak: number; maxPlayers: number; matches: number };
/** O secțiune adusă de o aplicație (titlul și rândurile gata traduse, în limba dată). */
export type GcsWeeklyExtra = { key: string; title: string; items: { text: string; href: string }[] };

export type GcsWeeklyDigest = {
  since: string;
  topics: GcsWeeklyTopic[];
  mentions: { count: number; items: GcsWeeklyMention[] };
  servers: GcsWeeklyServer[];
  extras: GcsWeeklyExtra[];
};

/** O secțiune a unei aplicații: primește membrul, limba și începutul săptămânii; `null` = nimic de arătat. */
export type GcsWeeklySectionProvider = (ctx: { userId: string; locale: string; since: Date; now: Date }) => Promise<GcsWeeklyExtra | null>;

const topicHref = (t: { id: number; title: string }) => `/topic/${t.id}-${slugify(t.title)}`;

/** Rezumatul are ceva de arătat (altfel nu se trimite). */
export const weeklyHasContent = (d: GcsWeeklyDigest, items = 0): boolean =>
  d.topics.length > 0 || d.mentions.count > 0 || d.servers.length > 0 || d.extras.some((e) => e.items.length > 0) || items > 0;

/** Constructorul rezumatului: datele comune ale săptămânii (o dată pe rulare) și cele ale fiecărui membru. */
export class GcsWeeklyDigestBuilder {
  private readonly sections = new Map<string, GcsWeeklySectionProvider>();

  constructor(
    private readonly deps: {
      db: PrismaClient;
      notifications: GcsNotificationService;
      /** Aplicația Servere e activă (altfel fără momentele serverelor). */
      serversEnabled: () => Promise<boolean>;
    },
  ) {}

  /** O aplicație își adaugă secțiunea în rezumat (ex. clanurile, turneele). O cheie repetată o înlocuiește. */
  registerSection(key: string, provider: GcsWeeklySectionProvider): void {
    this.sections.set(key, provider);
  }

  /** Topicurile noi ale săptămânii, cele mai discutate primele (candidații, înainte de verificarea accesului). */
  async topicCandidates(since: Date): Promise<(GcsWeeklyTopic & { authorId: string | null })[]> {
    const rows = await this.deps.db.topic.findMany({
      where: { createdAt: { gte: since }, visibility: "VISIBLE" },
      orderBy: [{ repliesCount: "desc" }, { viewsCount: "desc" }, { id: "desc" }],
      take: TOPIC_CANDIDATES,
      select: { id: true, title: true, repliesCount: true, viewsCount: true, authorId: true },
    });
    return rows.map((t) => ({ id: t.id, title: t.title, href: topicHref(t), replies: t.repliesCount, views: t.viewsCount, authorId: t.authorId }));
  }

  /** Serverele cu cei mai mulți jucători în săptămână (vârful din istoric) și meciurile terminate. */
  async serverHighlights(since: Date): Promise<GcsWeeklyServer[]> {
    if (!(await this.deps.serversEnabled())) return [];
    const peaks = await this.deps.db.serverSnapshot.groupBy({ by: ["serverId"], where: { at: { gte: since } }, _max: { peak: true, players: true, maxPlayers: true } });
    const ranked = peaks
      .map((p) => ({ serverId: p.serverId, peak: Math.max(p._max.peak ?? 0, p._max.players ?? 0), maxPlayers: p._max.maxPlayers ?? 0 }))
      .filter((p) => p.peak > 0)
      .sort((a, b) => b.peak - a.peak)
      .slice(0, SERVERS_SHOWN * 2);
    if (ranked.length === 0) return [];
    const [servers, matches] = await Promise.all([
      this.deps.db.gameServer.findMany({ where: { id: { in: ranked.map((r) => r.serverId) }, enabled: true }, select: { id: true, name: true, slug: true } }),
      this.deps.db.gameMatch.groupBy({ by: ["serverId"], where: { serverId: { in: ranked.map((r) => r.serverId) }, status: "ENDED", endedAt: { gte: since } }, _count: { _all: true } }),
    ]);
    const byId = new Map(servers.map((s) => [s.id, s]));
    const played = new Map(matches.map((m) => [m.serverId, m._count._all]));
    return ranked
      .filter((r) => byId.has(r.serverId))
      .slice(0, SERVERS_SHOWN)
      .map((r) => {
        const s = byId.get(r.serverId)!;
        return { id: s.id, name: s.name, href: `/servers/${s.id}-${s.slug}`, peak: r.peak, maxPlayers: r.maxPlayers, matches: played.get(r.serverId) ?? 0 };
      });
  }

  /** Mențiunile necitite ale membrului din săptămână (numărul și ultimele trei, ca text). */
  async mentions(userId: string, locale: string, since: Date): Promise<GcsWeeklyDigest["mentions"]> {
    const types = (await this.deps.notifications.catalog()).flatMap((c) => c.types.filter((t) => t.mention).map((t) => t.key));
    if (types.length === 0) return { count: 0, items: [] };
    const where = { userId, site: true, readAt: null, type: { in: types }, updatedAt: { gte: since } };
    const [count, rows] = await Promise.all([
      this.deps.db.notification.count({ where }),
      this.deps.db.notification.findMany({ where, orderBy: { updatedAt: "desc" }, take: MENTIONS_SHOWN }),
    ]);
    const actorIds = [...new Set(rows.flatMap((r) => r.actorIds))];
    const names = new Map((await this.deps.db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return {
      count,
      items: rows.map((r) => {
        const data = (r.data ?? {}) as Record<string, unknown>;
        return {
          text: notificationText({ type: r.type, actors: r.actorIds.map((id) => names.get(id)).filter((n): n is string => !!n), count: r.count, title: typeof data.title === "string" ? data.title : "", data }, locale),
          href: `/notifications/${r.id}`,
          at: r.updatedAt.toISOString(),
        };
      }),
    };
  }

  /**
   * Rezumatul unui membru. `shared` (topicurile candidate și serverele) se calculează o dată pe rulare și se dă aici;
   * lipsă = calculat acum (pagina `/notifications/weekly`).
   */
  async forUser(
    userId: string,
    locale: string,
    now = new Date(),
    shared?: { topics: (GcsWeeklyTopic & { authorId: string | null })[]; servers: GcsWeeklyServer[] },
  ): Promise<GcsWeeklyDigest> {
    const since = new Date(now.getTime() - WEEK_MS);
    const common = shared ?? { topics: await this.topicCandidates(since), servers: await this.serverHighlights(since) };
    const topics: GcsWeeklyTopic[] = [];
    for (const t of common.topics) {
      if (topics.length >= TOPICS_SHOWN) break;
      if (t.authorId === userId) continue;
      if ((await this.deps.notifications.visibleTo("forums.topic", String(t.id), [userId])).length === 0) continue;
      topics.push({ id: t.id, title: t.title, href: t.href, replies: t.replies, views: t.views });
    }
    const extras: GcsWeeklyExtra[] = [];
    for (const provider of this.sections.values()) {
      const section = await provider({ userId, locale, since, now }).catch(() => null);
      if (section && section.items.length > 0) extras.push(section);
    }
    return { since: since.toISOString(), topics, mentions: await this.mentions(userId, locale, since), servers: common.servers, extras };
  }

  /** Datele comune ale săptămânii (o dată pe rulare). */
  async shared(now = new Date()) {
    const since = new Date(now.getTime() - WEEK_MS);
    return { topics: await this.topicCandidates(since), servers: await this.serverHighlights(since) };
  }
}

// ─── Emailul „Ce ai ratat” ────────────────────────────────────────────────────

type Locale = "ro" | "en";
const pick = (locale: string): Locale => (locale === "en" ? "en" : "ro");
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const absolute = (siteUrl: string, href: string) => (/^https?:\/\//.test(href) ? href : `${siteUrl.replace(/\/$/, "")}${href}`);

const T = {
  ro: {
    subject: (site: string) => `Ce ai ratat săptămâna aceasta — ${site}`,
    hi: "Salut",
    intro: (site: string) => `Iată pe scurt ce s-a întâmplat pe ${site} în ultimele 7 zile:`,
    topics: "Topicurile săptămânii",
    replies: (n: number) => (n === 1 ? "1 răspuns" : `${n} răspunsuri`),
    mentions: (n: number) => (n === 1 ? "O mențiune necitită" : `${n} mențiuni necitite`),
    servers: "Serverele săptămânii",
    peak: (p: number, max: number, m: number) => `vârf ${p}${max ? `/${max}` : ""} jucători${m > 0 ? ` · ${m === 1 ? "1 meci" : `${m} meciuri`}` : ""}`,
    items: "Notificările tale",
    open: "Deschide rezumatul pe site",
    footer: "Nu mai vrei rezumatul? Oprește-l din",
    settings: "setările notificărilor",
  },
  en: {
    subject: (site: string) => `What you missed this week — ${site}`,
    hi: "Hi",
    intro: (site: string) => `Here's a quick look at what happened on ${site} in the last 7 days:`,
    topics: "Topics of the week",
    replies: (n: number) => (n === 1 ? "1 reply" : `${n} replies`),
    mentions: (n: number) => (n === 1 ? "One unread mention" : `${n} unread mentions`),
    servers: "Servers of the week",
    peak: (p: number, max: number, m: number) => `peak ${p}${max ? `/${max}` : ""} players${m > 0 ? ` · ${m === 1 ? "1 match" : `${m} matches`}` : ""}`,
    items: "Your notifications",
    open: "Open the digest on the site",
    footer: "Don't want the digest? Turn it off in your",
    settings: "notification settings",
  },
} as const;

/** Emailul rezumatului săptămânal: secțiunile cu conținut și notificările „săptămânale” ale membrului. */
export function weeklyMail(opts: {
  to: string;
  name: string;
  site: string;
  siteUrl: string;
  locale: string;
  digest: GcsWeeklyDigest;
  items: GcsNotificationMailItem[];
  /** Linkul „Deschide rezumatul” (prin notificarea din clopoțel, pentru statistici), implicit pagina rezumatului. */
  openHref?: string;
}): GcsMail {
  const l = pick(opts.locale);
  const t = T[l];
  const link = (href: string) => escape(absolute(opts.siteUrl, href));
  const list = (rows: string[]) => `<ul>${rows.join("")}</ul>`;
  const parts: string[] = [`<p>${t.hi}, ${escape(opts.name)}!</p>`, `<p>${escape(t.intro(opts.site))}</p>`];
  const text: string[] = [t.intro(opts.site)];
  const d = opts.digest;
  if (d.topics.length > 0) {
    parts.push(`<h3>${t.topics}</h3>`, list(d.topics.map((x) => `<li><a href="${link(x.href)}">${escape(x.title)}</a> <span style="color:#777">(${t.replies(x.replies)})</span></li>`)));
    text.push(`${t.topics}:`, ...d.topics.map((x) => `- ${x.title}: ${absolute(opts.siteUrl, x.href)}`));
  }
  if (d.mentions.count > 0) {
    parts.push(`<h3>${t.mentions(d.mentions.count)}</h3>`, list(d.mentions.items.map((m) => `<li><a href="${link(`${m.href}?via=email`)}">${escape(m.text)}</a></li>`)));
    text.push(`${t.mentions(d.mentions.count)}:`, ...d.mentions.items.map((m) => `- ${m.text}`));
  }
  if (d.servers.length > 0) {
    parts.push(`<h3>${t.servers}</h3>`, list(d.servers.map((s) => `<li><a href="${link(s.href)}">${escape(s.name)}</a> <span style="color:#777">(${t.peak(s.peak, s.maxPlayers, s.matches)})</span></li>`)));
    text.push(`${t.servers}:`, ...d.servers.map((s) => `- ${s.name}: ${t.peak(s.peak, s.maxPlayers, s.matches)}`));
  }
  for (const e of d.extras) {
    parts.push(`<h3>${escape(e.title)}</h3>`, list(e.items.map((i) => `<li><a href="${link(i.href)}">${escape(i.text)}</a></li>`)));
    text.push(`${e.title}:`, ...e.items.map((i) => `- ${i.text}`));
  }
  if (opts.items.length > 0) {
    parts.push(`<h3>${t.items}</h3>`, list(opts.items.map((i) => `<li><a href="${link(i.id ? `/notifications/${i.id}?via=email` : i.href)}">${escape(notificationText(i, l))}</a></li>`)));
    text.push(`${t.items}:`, ...opts.items.map((i) => `- ${notificationText(i, l)}`));
  }
  const open = opts.openHref ?? "/notifications/weekly";
  parts.push(`<p><a href="${link(open)}">${t.open}</a></p>`, `<p style="color:#777">${t.footer} <a href="${link("/settings/notifications")}">${t.settings}</a>.</p>`);
  return { to: opts.to, subject: t.subject(opts.site), html: parts.join(""), text: text.join("\n") };
}
