import type { GcsMail } from "@gcs/core";

/** Textele notificărilor (email și clopoțel), în limba site-ului. Valorile vin escapate de cine construiește HTML-ul. */
type Locale = "ro" | "en";
const pick = (locale: string): Locale => (locale === "en" ? "en" : "ro");
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type GcsNotificationTextInput = {
  type: string;
  /** Numele actorilor, cei mai recenți întâi (cel mult 3). */
  actors: string[];
  count: number;
  title: string;
  data?: Record<string, unknown>;
};

/** „Ana”, „Ana și Mihai”, „Ana și alți 4”. */
function who(actors: string[], count: number, l: Locale): string {
  const first = actors[0] ?? (l === "en" ? "Someone" : "Cineva");
  const others = Math.max(count, actors.length) - 1;
  if (others <= 0) return first;
  if (others === 1 && actors[1]) return l === "en" ? `${first} and ${actors[1]}` : `${first} și ${actors[1]}`;
  return l === "en" ? `${first} and ${others} others` : `${first} și alți ${others}`;
}

function formatDate(value: unknown, l: Locale): string {
  const d = new Date(typeof value === "string" ? value : Number.NaN);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(l === "en" ? "en-GB" : "ro-RO", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Bucharest" }).format(d);
}

const TEXTS: Record<string, Record<Locale, (a: string, t: string, n: number, data: Record<string, unknown>) => string>> = {
  "forums.mention": { ro: (a, t) => `${a} te-a menționat în „${t}”`, en: (a, t) => `${a} mentioned you in “${t}”` },
  "forums.quote": { ro: (a, t) => `${a} te-a citat în „${t}”`, en: (a, t) => `${a} quoted you in “${t}”` },
  "forums.reply": {
    ro: (a, t, n) => (n > 1 ? `${n} răspunsuri noi în „${t}” (ultimul: ${a})` : `${a} a răspuns în „${t}”`),
    en: (a, t, n) => (n > 1 ? `${n} new replies in “${t}” (latest: ${a})` : `${a} replied in “${t}”`),
  },
  "forums.topic": { ro: (a, t) => `${a} a deschis topicul „${t}”`, en: (a, t) => `${a} started the topic “${t}”` },
  "forums.reaction": { ro: (a, t) => `${a} a reacționat la postarea ta din „${t}”`, en: (a, t) => `${a} reacted to your post in “${t}”` },
  "forums.solution": { ro: (_a, t) => `Răspunsul tău din „${t}” a fost marcat ca rezolvare`, en: (_a, t) => `Your answer in “${t}” was marked as the solution` },
  "profile.follower": { ro: (a) => `${a} te urmărește`, en: (a) => `${a} followed you` },
  "profile.wall": { ro: (a) => `${a} a scris pe peretele tău`, en: (a) => `${a} posted on your wall` },
  "profile.badge": { ro: (_a, t) => `Ai primit „${t}”`, en: (_a, t) => `You earned “${t}”` },
  "pm.message": {
    ro: (a, t, n) => (n > 1 ? `${n} mesaje noi în „${t}”` : `${a} ți-a trimis un mesaj: „${t}”`),
    en: (a, t, n) => (n > 1 ? `${n} new messages in “${t}”` : `${a} sent you a message: “${t}”`),
  },
  "vip.expiring": {
    ro: (_a, t, _n, d) => `${t} expiră pe ${formatDate(d.expiresAt, "ro")}`,
    en: (_a, t, _n, d) => `Your ${t} expires on ${formatDate(d.expiresAt, "en")}`,
  },
  "vip.granted": { ro: (_a, t) => `Ai primit ${t}`, en: (_a, t) => `You received ${t}` },
  "vip.expired": { ro: (_a, t) => `${t} a expirat`, en: (_a, t) => `Your ${t} has expired` },
  "core.warning": { ro: (_a, t) => `Ai primit un avertisment: ${t}`, en: (_a, t) => `You received a warning: ${t}` },
};

/** Propoziția unei notificări (text simplu). */
export function notificationText(input: GcsNotificationTextInput, locale: string): string {
  const l = pick(locale);
  const fn = TEXTS[input.type]?.[l];
  const title = input.title || "…";
  if (!fn) return title;
  return fn(who(input.actors, input.count, l), title, input.count, input.data ?? {});
}

export type GcsNotificationMailItem = GcsNotificationTextInput & { href: string; snippet?: string };

const absolute = (siteUrl: string, href: string) => (/^https?:\/\//.test(href) ? href : `${siteUrl.replace(/\/$/, "")}${href}`);

function itemHtml(item: GcsNotificationMailItem, siteUrl: string, l: Locale): string {
  const text = escape(notificationText(item, l));
  const link = escape(absolute(siteUrl, item.href));
  const snippet = item.snippet ? `<br><span style="color:#777">${escape(item.snippet)}</span>` : "";
  return `<li><a href="${link}">${text}</a>${snippet}</li>`;
}

/** Emailul imediat pentru o singură notificare. */
export function notificationMail(opts: { to: string; name: string; site: string; siteUrl: string; locale: string; item: GcsNotificationMailItem }): GcsMail {
  const l = pick(opts.locale);
  const text = notificationText(opts.item, l);
  const link = absolute(opts.siteUrl, opts.item.href);
  const settingsLink = escape(absolute(opts.siteUrl, "/settings/notifications"));
  const footer =
    l === "en"
      ? `<p style="color:#777">Change which emails you get: <a href="${settingsLink}">notification settings</a>.</p>`
      : `<p style="color:#777">Alege ce emailuri primești: <a href="${settingsLink}">setările notificărilor</a>.</p>`;
  return {
    to: opts.to,
    subject: `${text} — ${opts.site}`,
    html: `<p>${l === "en" ? "Hi" : "Salut"}, ${escape(opts.name)}!</p><ul>${itemHtml(opts.item, opts.siteUrl, l)}</ul>${footer}`,
    text: `${text}\n${link}`,
  };
}

/** Digestul zilnic: notificările necitite, încă netrimise pe email. */
export function digestMail(opts: { to: string; name: string; site: string; siteUrl: string; locale: string; items: GcsNotificationMailItem[] }): GcsMail {
  const l = pick(opts.locale);
  const n = opts.items.length;
  const subject = l === "en" ? `${n} new notification${n === 1 ? "" : "s"} — ${opts.site}` : `${n === 1 ? "O notificare nouă" : `${n} notificări noi`} — ${opts.site}`;
  const settingsLink = escape(absolute(opts.siteUrl, "/settings/notifications"));
  const intro = l === "en" ? `Here's what you missed on ${escape(opts.site)}:` : `Iată ce ai pierdut pe ${escape(opts.site)}:`;
  const footer =
    l === "en"
      ? `<p style="color:#777">Change which emails you get: <a href="${settingsLink}">notification settings</a>.</p>`
      : `<p style="color:#777">Alege ce emailuri primești: <a href="${settingsLink}">setările notificărilor</a>.</p>`;
  return {
    to: opts.to,
    subject,
    html: `<p>${l === "en" ? "Hi" : "Salut"}, ${escape(opts.name)}!</p><p>${intro}</p><ul>${opts.items.map((i) => itemHtml(i, opts.siteUrl, l)).join("")}</ul>${footer}`,
    text: opts.items.map((i) => `- ${notificationText(i, l)}: ${absolute(opts.siteUrl, i.href)}`).join("\n"),
  };
}
