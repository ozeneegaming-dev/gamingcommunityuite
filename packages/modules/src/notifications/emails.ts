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
  "core.group_mention": {
    ro: (a, t, _n, d) => `${a} te-a menționat prin grupul ${groupName(d)} în „${t}”`,
    en: (a, t, _n, d) => `${a} mentioned you through the group ${groupName(d)} in “${t}”`,
  },
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
  // Donațiile (VIP clasic): titlul e suma („50 RON”).
  "donations.confirmed": { ro: (_a, t) => `Donația ta de ${t} a fost confirmată. Mulțumim!`, en: (_a, t) => `Your donation of ${t} was confirmed. Thank you!` },
  "donations.rejected": {
    ro: (_a, t, _n, d) => `Donația ta de ${t} nu a fost confirmată${d.reason ? `: ${String(d.reason)}` : ""}`,
    en: (_a, t, _n, d) => `Your donation of ${t} was not confirmed${d.reason ? `: ${String(d.reason)}` : ""}`,
  },
  "donations.submitted": { ro: (a, t) => `${a} a trimis o donație de ${t} de confirmat`, en: (a, t) => `${a} sent a donation of ${t} to confirm` },
  "core.group_expired": { ro: (_a, t) => `Grupul ${t} a expirat`, en: (_a, t) => `Your ${t} group has expired` },
  "chat.sanction": { ro: (_a, _t, _n, d) => chatSanctionText("ro", d), en: (_a, _t, _n, d) => chatSanctionText("en", d) },
  "chat.access": { ro: (_a, _t, _n, d) => chatAccessText("ro", d), en: (_a, _t, _n, d) => chatAccessText("en", d) },
  "core.warning": { ro: (_a, t) => `Ai primit un avertisment: ${t}`, en: (_a, t) => `You received a warning: ${t}` },
  "clans.invite": { ro: (a, t) => `${a} te-a invitat în clanul „${t}”`, en: (a, t) => `${a} invited you to the clan “${t}”` },
  "clans.request": {
    ro: (a, t, n) => (n > 1 ? `${n} cereri noi de intrare în clanul „${t}”` : `${a} vrea să intre în clanul „${t}”`),
    en: (a, t, n) => (n > 1 ? `${n} new requests to join the clan “${t}”` : `${a} wants to join the clan “${t}”`),
  },
  "clans.membership": { ro: (_a, t, _n, d) => clanMembershipText("ro", t, d.kind), en: (_a, t, _n, d) => clanMembershipText("en", t, d.kind) },
  "clans.review": {
    ro: (_a, t, _n, d) => (d.kind === "approved" ? `Clanul tău „${t}” a fost aprobat` : `Clanul tău „${t}” a fost respins${d.reason ? `: ${String(d.reason)}` : ""}`),
    en: (_a, t, _n, d) => (d.kind === "approved" ? `Your clan “${t}” was approved` : `Your clan “${t}” was rejected${d.reason ? `: ${String(d.reason)}` : ""}`),
  },
};

/** O durată în minute, pe înțeles („15 minute”, „2 ore”, „3 zile”); `null` = permanent. */
function duration(minutes: unknown, l: Locale): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return l === "en" ? "permanently" : "permanent";
  const [n, unit] = minutes % 1440 === 0 ? [minutes / 1440, "d"] : minutes % 60 === 0 ? [minutes / 60, "h"] : [minutes, "m"];
  const ro: Record<string, [string, string]> = { d: ["zi", "zile"], h: ["oră", "ore"], m: ["minut", "minute"] };
  const en: Record<string, [string, string]> = { d: ["day", "days"], h: ["hour", "hours"], m: ["minute", "minutes"] };
  const [one, many] = (l === "en" ? en : ro)[unit as string]!;
  return l === "en" ? `for ${n} ${n === 1 ? one : many}` : `${n} ${n === 1 ? one : many}`;
}

const reasonText = (d: Record<string, unknown>) => (typeof d.reason === "string" && d.reason ? `: ${d.reason}` : "");

/** Sancțiunile din chat (`chat.sanction`), după `data.kind`. */
function chatSanctionText(l: Locale, d: Record<string, unknown>): string {
  const t = duration(d.minutes, l);
  const r = reasonText(d);
  const texts: Record<string, Record<Locale, string>> = {
    mute: { ro: `Ai primit mute în chat (${t})${r}`, en: `You were muted in chat ${t}${r}` },
    kick: { ro: `Ai fost scos din chat (${t})${r}`, en: `You were kicked from chat ${t}${r}` },
    ban: { ro: `Ai primit ban din chat (${t})${r}`, en: `You were banned from chat ${t}${r}` },
    slow: { ro: `Ai primit slow mode în chat: un mesaj la ${String(d.seconds ?? "?")} secunde${r}`, en: `You are in slow mode in chat: one message every ${String(d.seconds ?? "?")} seconds${r}` },
  };
  return texts[typeof d.kind === "string" ? d.kind : ""]?.[l] ?? (l === "en" ? "A chat moderator acted on your account" : "Un moderator de chat a acționat asupra contului tău");
}

/** Accesul de moderator în chat (`chat.access`): dat, retras sau expirat. */
function chatAccessText(l: Locale, d: Record<string, unknown>): string {
  if (d.kind === "revoked") return l === "en" ? "Your chat moderator access was revoked" : "Accesul tău de moderator în chat a fost retras";
  if (d.kind === "expired") return l === "en" ? "Your chat moderator access has expired" : "Accesul tău de moderator în chat a expirat";
  const t = typeof d.minutes === "number" ? (l === "en" ? ` ${duration(d.minutes, l)}` : ` pentru ${duration(d.minutes, l)}`) : "";
  return l === "en" ? `You received chat moderator access${t}` : `Ai primit acces de moderator în chat${t}`;
}

/** Numele grupului menționat, salvat în notificare (`data.group`). */
const groupName = (d: Record<string, unknown>) => (typeof d.group === "string" && d.group ? d.group : "…");

/** Schimbările de apartenență la un clan (`clans.membership`), după `data.kind`. */
function clanMembershipText(l: Locale, t: string, kind: unknown): string {
  const texts: Record<string, Record<Locale, string>> = {
    accepted: { ro: `Cererea ta de intrare în clanul „${t}” a fost acceptată`, en: `Your request to join the clan “${t}” was accepted` },
    rejected: { ro: `Cererea ta de intrare în clanul „${t}” a fost refuzată`, en: `Your request to join the clan “${t}” was declined` },
    promoted: { ro: `Ai fost numit ofițer în clanul „${t}”`, en: `You are now an officer of the clan “${t}”` },
    demoted: { ro: `Nu mai ești ofițer în clanul „${t}”`, en: `You are no longer an officer of the clan “${t}”` },
    leader: { ro: `Ai devenit liderul clanului „${t}”`, en: `You are now the leader of the clan “${t}”` },
    kicked: { ro: `Ai fost scos din clanul „${t}”`, en: `You were removed from the clan “${t}”` },
    disbanded: { ro: `Clanul „${t}” a fost desființat`, en: `The clan “${t}” was disbanded` },
  };
  return texts[typeof kind === "string" ? kind : ""]?.[l] ?? t;
}

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
