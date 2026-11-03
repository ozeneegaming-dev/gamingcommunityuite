import "server-only";
import {
  ANNOUNCEMENT_SETTING,
  ANNOUNCEMENT_STATS_KEY,
  announcementDismissed,
  announcementPageBars,
  announcementStatsField,
  announcementStatsFrom,
  announcementUsedVariables,
  parseAnnouncementDismissals,
  readAnnouncementConfig,
  type GcsAnnouncementBar,
  type GcsAnnouncementConfig,
  type GcsAnnouncementEvent,
  type GcsAnnouncementStats,
  type GcsAnnouncementVars,
} from "@gcs/modules";
import type { GcsActor } from "@gcs/core";
import { iconMatch, type GcsIconMatch } from "@gcs/ui/icon-registry";
import { cookies } from "next/headers";
import { isTimeZone } from "./appearance";
import { visibleServers } from "./live-summary.server";
import { services } from "./services";

/** Cookie-ul barelor închise (per browser): intrări `<cine>~<bară>~<versiune>~<zi>`, despărțite de `|`. */
export const ANNOUNCEMENT_COOKIE = "gcs-ann";

/** Cine închide bara: membrul (id-ul lui) sau vizitatorul. Așa, pe același browser, alt cont vede bara din nou. */
export const announcementViewerKey = (actor: Pick<GcsActor, "userId">) => actor.userId ?? "guest";

/** Configurația salvată (prima versiune sau cea de acum); o valoare stricată nu oprește pagina (nicio bară). */
export async function announcementConfig(): Promise<GcsAnnouncementConfig> {
  const raw = await services()
    .settings.get<unknown>(ANNOUNCEMENT_SETTING)
    .catch(() => null);
  return readAnnouncementConfig(raw);
}

/** Fusul orar al site-ului (ACP → Setări → Generale): programul barelor se socotește în el. */
export async function siteTimeZone(): Promise<string> {
  const tz = await services()
    .settings.get<string>("site.timezone")
    .catch(() => null);
  return isTimeZone(tz) ? tz : "Europe/Bucharest";
}

/** Setările generale de care are nevoie bara din browser. */
export type GcsAnnouncementSiteSettings = Pick<GcsAnnouncementConfig, "rotateSeconds" | "multiple" | "transition" | "order" | "pauseOnHover" | "dots" | "stats">;

export type GcsAnnouncementView = {
  bars: GcsAnnouncementBar[];
  settings: GcsAnnouncementSiteSettings;
  viewerKey: string;
  timeZone: string;
  vars: GcsAnnouncementVars;
  /** Desenul iconițelor barelor (după numele lor), ca browserul să nu primească tot pachetul de iconițe. */
  icons: Record<string, GcsIconMatch>;
};

/** Variabilele folosite de bare, calculate doar pe cele de care e nevoie (o sursă indisponibilă = variabila dispare). */
async function announcementVars(bars: GcsAnnouncementBar[], actor: GcsActor, name: string | null, locale: string): Promise<GcsAnnouncementVars> {
  const used = announcementUsedVariables(bars);
  const vars: GcsAnnouncementVars = {};
  if (used.size === 0) return vars;
  const n = new Intl.NumberFormat(locale);
  if (used.has("numele_tau") && name) vars.numele_tau = name;
  const [online, servers] = await Promise.all([
    used.has("membri_online")
      ? services()
          .presence.online()
          .then((o) => o.users.length)
          .catch(() => null)
      : null,
    used.has("jucatori_online") ? visibleServers(actor).catch(() => null) : null,
  ]);
  if (online !== null) vars.membri_online = n.format(online);
  if (servers && servers.length > 0) vars.jucatori_online = n.format(servers.reduce((sum, s) => sum + (s.status?.online ? (s.status.players ?? 0) : 0), 0));
  return vars;
}

/**
 * Barele trimise acestui membru / vizitator (publicul, limba, fără cele terminate sau închise), cu setările generale,
 * fusul site-ului, variabilele și iconițele. Paginile, zilele, orele și numărătoarea le filtrează browserul (layout-ul
 * nu se re-randează la navigare).
 */
export async function announcementView(actor: GcsActor, locale: string): Promise<GcsAnnouncementView> {
  const [config, jar, timeZone] = await Promise.all([announcementConfig(), cookies(), siteTimeZone()]);
  const { rotateSeconds, multiple, transition, order, pauseOnHover, dots, stats } = config;
  const settings = { rotateSeconds, multiple, transition, order, pauseOnHover, dots, stats };
  const viewerKey = announcementViewerKey(actor);
  const empty: GcsAnnouncementView = { bars: [], settings, viewerKey, timeZone, vars: {}, icons: {} };
  if (!config.bars.some((b) => b.enabled)) return empty;
  // Data înregistrării (membrii noi) și numele ({numele_tau}): o singură citire, doar când există bare pornite.
  const user = actor.userId ? await services().db.user.findUnique({ where: { id: actor.userId }, select: { name: true, createdAt: true } }) : null;
  const dismissals = parseAnnouncementDismissals(jar.get(ANNOUNCEMENT_COOKIE)?.value, viewerKey);
  const bars = announcementPageBars(config, { userId: actor.userId, groupIds: actor.groupIds, joinedAt: user?.createdAt ?? null, locale }).filter((b) => !announcementDismissed(dismissals, b));
  if (bars.length === 0) return empty;
  const icons: Record<string, GcsIconMatch> = {};
  for (const b of bars) {
    const icon = b.icon ? iconMatch(b.icon) : null;
    if (b.icon && icon) icons[b.icon] = icon;
  }
  return { bars, settings, viewerKey, timeZone, vars: await announcementVars(bars, actor, user?.name ?? null, locale), icons };
}

// ─── Statisticile (un hash în stocarea cheilor, fără tabel nou) ──────────────────────────────────────

/** Cifrele barelor date, de la publicare (sau de la ultima resetare). */
export async function announcementStats(ids: string[]): Promise<Record<string, GcsAnnouncementStats>> {
  const hash = await services()
    .kv.hgetall(ANNOUNCEMENT_STATS_KEY)
    .catch(() => ({}) as Record<string, string>);
  return announcementStatsFrom(hash, ids);
}

const DAY_KEY = () => new Date().toISOString().slice(0, 10);

/**
 * Un eveniment al unei bare: afișarea se numără cel mult o dată pe zi per membru / IP (cheia expiră singură), click-ul
 * și închiderea de fiecare dată (ruta are limita ei pe IP). Întoarce dacă s-a numărat.
 */
export async function recordAnnouncementEvent(barId: string, event: GcsAnnouncementEvent, who: string): Promise<boolean> {
  const { kv } = services();
  if (event === "view") {
    const fresh = await kv.set(`gcs:ann:seen:${DAY_KEY()}:${barId}:${who}`, "1", { ttlMs: 26 * 3_600_000, nx: true });
    if (!fresh) return false;
  }
  await kv.hincrby(ANNOUNCEMENT_STATS_KEY, announcementStatsField(barId, event), 1);
  return true;
}

/** Resetează cifrele barelor (de acum se numără de la zero) sau le pornește pentru barele noi. */
export async function resetAnnouncementStats(ids: string[], at: Date = new Date()): Promise<void> {
  if (ids.length === 0) return;
  const { kv } = services();
  await kv.hdel(
    ANNOUNCEMENT_STATS_KEY,
    ids.flatMap((id) => (["view", "click", "dismiss"] as const).map((e) => announcementStatsField(id, e))),
  );
  await kv.hset(ANNOUNCEMENT_STATS_KEY, Object.fromEntries(ids.map((id) => [announcementStatsField(id, "since"), at.toISOString()])));
}

/** Șterge cifrele barelor șterse din ACP. */
export async function dropAnnouncementStats(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await services().kv.hdel(
    ANNOUNCEMENT_STATS_KEY,
    ids.flatMap((id) => (["view", "click", "dismiss", "since"] as const).map((e) => announcementStatsField(id, e))),
  );
}
