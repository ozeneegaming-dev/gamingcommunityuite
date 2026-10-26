/**
 * Botul de știri (`gcs.news_bot`): la fiecare 5 minute verifică fluxurile scadente (RSS / Atom sau știrile oficiale
 * Steam), iar știrile noi devin topicuri ale botului comunității (`ctx.bot.post`). Nu are bază de date proprie (merge și
 * pe MySQL): deduplicarea o ține nucleul (cheia `dedupeKey`), iar starea fluxurilor (ultima rulare) stă în cache.
 */
import { definePlugin, type GcsPluginApiResponse, type GcsPluginContext } from "../../../src/index";
import {
  inWindow,
  parseFeed,
  parseFeedLines,
  parseWindow,
  postHtml,
  steamItems,
  steamNewsUrl,
  type GcsFeedConfig,
  type GcsFeedItem,
} from "./feeds";

const PLUGIN_KEY = "gcs.news_bot";
const API = `/api/plugins/${PLUGIN_KEY}`;
const ACP = `/admin/plugins/${PLUGIN_KEY}`;
const MAX_REDIRECTS = 3;
/** Starea unui flux în cache (o zi, cât permite cache-ul pluginurilor). */
type FeedStatus = { at: string; fetched: number; posted: number; duplicates: number; error: string | null };

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (text: unknown) => String(text ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);

function settingsOf(ctx: GcsPluginContext) {
  const num = (key: string, fallback: number) => {
    const v = ctx.settings.get<number>(key);
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const text = (key: string) => {
    const v = ctx.settings.get<string>(key);
    return typeof v === "string" ? v : "";
  };
  return {
    feeds: parseFeedLines(text("feeds")),
    maxPerRun: Math.min(20, Math.max(1, Math.round(num("maxPerRun", 3)))),
    window: parseWindow(text("window")),
    timezone: text("timezone") || "UTC",
    steamApi: text("steamApi"),
    excerptChars: Math.min(3000, Math.max(100, Math.round(num("excerptChars", 500)))),
  };
}

/** Ora locală (0–23) în fusul ales; un fus invalid → UTC. */
function localHour(now: Date, timeZone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  } catch {
    return now.getUTCHours();
  }
}

/** Cererea, cu redirecționările urmate (fiecare pas trece din nou prin verificarea adreselor a gazdei). */
async function fetchText(ctx: GcsPluginContext, url: string, accept: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await ctx.http.fetch(current, { headers: { accept, "user-agent": "GCS-NewsBot/1.0" } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.location ?? res.headers.Location;
      if (!location) throw new Error(`http_${res.status}`);
      current = new URL(location, current).toString();
      if (!/^https?:\/\//i.test(current)) throw new Error("bad_redirect");
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`http_${res.status}`);
    return res.body;
  }
  throw new Error("too_many_redirects");
}

async function itemsOf(ctx: GcsPluginContext, feed: GcsFeedConfig, steamApi: string): Promise<GcsFeedItem[]> {
  if (feed.source.kind === "steam") return steamItems(JSON.parse(await fetchText(ctx, steamNewsUrl(feed.source.appId, 10, steamApi || undefined), "application/json")));
  return parseFeed(await fetchText(ctx, feed.source.url, "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"));
}

/** Id-ul forumului: un număr sau numele unui forum (fără diferență de majuscule); `null` = negăsit. */
async function forumIdOf(ctx: GcsPluginContext, forum: string): Promise<number | null> {
  if (/^\d+$/.test(forum)) return Number(forum);
  const want = forum.trim().toLocaleLowerCase();
  const found = (await ctx.api.forums.list()).find((f) => f.name.trim().toLocaleLowerCase() === want);
  return found?.id ?? null;
}

/** Rulează un flux: preia știrile, le publică pe cele noi (cel mult `maxPerRun`), notează starea. */
async function runFeed(ctx: GcsPluginContext, feed: GcsFeedConfig, s: ReturnType<typeof settingsOf>): Promise<FeedStatus> {
  const status: FeedStatus = { at: new Date().toISOString(), fetched: 0, posted: 0, duplicates: 0, error: null };
  try {
    const forumId = await forumIdOf(ctx, feed.forum);
    if (forumId === null) throw new Error("forum_not_found");
    const items = await itemsOf(ctx, feed, s.steamApi);
    status.fetched = items.length;
    // Cele mai vechi dintre cele noi întâi, ca topicurile să apară în ordinea publicării la sursă.
    for (const item of items.slice(0, s.maxPerRun).reverse()) {
      const full = feed.options.full || feed.source.kind === "steam";
      const result = await ctx.bot.post({
        forumId,
        title: item.title,
        content: { html: postHtml(item, { full, excerptChars: s.excerptChars }) },
        dedupeKey: `${feed.id}:${item.guid}`,
        pin: feed.options.pin,
        lock: feed.options.lock,
        ...(feed.options.translate ? { translateFrom: "en" } : {}),
        meta: {
          ...(feed.label ? { label: feed.label } : {}),
          sourceName: feed.name,
          ...(item.link ? { sourceUrl: item.link } : {}),
          importEveryMinutes: feed.minutes,
        },
      });
      if (result === null) {
        status.error = "bot_disabled";
        break;
      }
      if (result.duplicate) status.duplicates++;
      else status.posted++;
    }
  } catch (error) {
    status.error = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
  }
  await ctx.cache.set(`status:${feed.id}`, status, 86_400);
  if (status.error) ctx.log.warn("feed.error", { feed: feed.name, error: status.error });
  else if (status.posted > 0) ctx.log.info("feed.posted", { feed: feed.name, fetched: status.fetched, posted: status.posted });
  return status;
}

/** Jobul: fluxurile scadente (intervalul fiecăruia), doar în orele de publicare; `force` = toate, acum. */
async function runDue(ctx: GcsPluginContext, force: boolean): Promise<number> {
  const s = settingsOf(ctx);
  if (!force && !inWindow(localHour(new Date(), s.timezone), s.window)) return 0;
  let ran = 0;
  for (const feed of s.feeds.feeds) {
    const lastKey = `last:${feed.id}`;
    if (!force && (await ctx.cache.get<string>(lastKey))) continue;
    // Marcajul ține cât intervalul fluxului: până expiră, fluxul nu mai rulează.
    await ctx.cache.set(lastKey, new Date().toISOString(), Math.min(86_400, feed.minutes * 60));
    await runFeed(ctx, feed, s);
    ran++;
  }
  return ran;
}

function acpPage(ctx: GcsPluginContext, statuses: (FeedStatus | null)[], query: Record<string, string>): string {
  const s = settingsOf(ctx);
  const date = (iso: string) => new Date(iso).toLocaleString(ctx.locale, { dateStyle: "medium", timeStyle: "short" });
  const rows = s.feeds.feeds
    .map((feed, i) => {
      const st = statuses[i];
      const source = feed.source.kind === "steam" ? `Steam · ${feed.source.appId}` : feed.source.url;
      const state = !st
        ? `<span class="gcs-badge">${esc(ctx.t("acp.never"))}</span>`
        : st.error
          ? `<span class="gcs-badge gcs-badge--danger" title="${esc(st.error)}">${esc(ctx.t("acp.error"))}</span>`
          : `<span class="gcs-badge gcs-badge--ok">${esc(ctx.t("acp.ok", { posted: st.posted, fetched: st.fetched }))}</span>`;
      return `<tr data-testid="gcsp-feed-row">
        <td><strong>${esc(feed.name)}</strong>${feed.label ? ` <span class="gcs-badge">${esc(feed.label)}</span>` : ""}<br><small>${esc(source)}</small></td>
        <td>${esc(feed.forum)}</td>
        <td>${esc(ctx.t("acp.every", { minutes: feed.minutes }))}</td>
        <td>${state}${st ? `<br><small>${esc(date(st.at))}${st.error ? ` · ${esc(st.error)}` : ""}</small>` : ""}</td>
      </tr>`;
    })
    .join("");
  const errors = s.feeds.errors.map((e) => `<li>${esc(ctx.t(`acp.lineError.${e.reason}`, { line: e.line }))}</li>`).join("");
  const notice = query.ran ? `<p class="gcs-badge gcs-badge--ok" role="status" data-testid="gcsp-ran">${esc(ctx.t("acp.ran", { feeds: query.ran }))}</p>` : "";
  return `<div class="gcs-card" style="padding:20px;display:flex;flex-direction:column;gap:14px">
    <p style="margin:0;color:var(--gcs-muted)">${esc(ctx.t("acp.intro"))}</p>
    ${notice}
    ${
      s.feeds.feeds.length === 0
        ? `<p data-testid="gcsp-no-feeds">${esc(ctx.t("acp.empty"))}</p>`
        : `<table class="gcs-table" data-testid="gcsp-feeds"><thead><tr><th>${esc(ctx.t("acp.feed"))}</th><th>${esc(ctx.t("acp.forum"))}</th><th>${esc(ctx.t("acp.interval"))}</th><th>${esc(ctx.t("acp.status"))}</th></tr></thead><tbody>${rows}</tbody></table>`
    }
    ${errors ? `<ul class="gcs-badge--danger" data-testid="gcsp-feed-errors">${errors}</ul>` : ""}
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <form method="post" action="${API}/run"><button type="submit" class="gcs-btn gcs-btn--primary" data-testid="gcsp-run-now">${esc(ctx.t("acp.run"))}</button></form>
      <a href="/admin/system/applications/plugins/${PLUGIN_KEY}">${esc(ctx.t("acp.settings"))}</a>
      <a href="/admin/system/bot">${esc(ctx.t("acp.bot"))}</a>
    </div>
    <p style="margin:0;color:var(--gcs-muted);font-size:13px">${esc(ctx.t("acp.window", { window: ctx.settings.get<string>("window") || ctx.t("acp.always") }))}</p>
  </div>`;
}

export default definePlugin({
  acp: {
    "/": async (input, ctx) => {
      const feeds = settingsOf(ctx).feeds.feeds;
      const statuses = await Promise.all(feeds.map((f) => ctx.cache.get<FeedStatus>(`status:${f.id}`)));
      return { title: ctx.t("acp.title"), html: acpPage(ctx, statuses, input.query) };
    },
  },
  api: {
    // „Rulează acum”: toate fluxurile, în afara orelor de publicare și a intervalului. Prin coadă (un apel API are 10 s).
    "/run": async (_req, ctx): Promise<GcsPluginApiResponse> => {
      await ctx.jobs.enqueue("fetch", { force: true });
      const ran = settingsOf(ctx).feeds.feeds.length;
      return { status: 200, redirect: `${ACP}?ran=${ran}`, body: { ok: true, queued: ran } };
    },
  },
  jobs: {
    fetch: async (data, ctx) => {
      await runDue(ctx, (data as { force?: unknown } | null)?.force === true);
    },
  },
});
