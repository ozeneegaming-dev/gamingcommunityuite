import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";

/** Secțiunea ACP (ACP › Sistem › Descoperire › RSS). */
export const RSS_ACP_SECTION = "system.rss";
export const RSS_SETTING = "rss.config";
/** Pornirea fluxurilor rămâne setarea veche a forumului (`forums.rss_enabled`), editată tot din pagina RSS. */
export const RSS_ENABLED_SETTING = "forums.rss_enabled";

export type GcsRssConfig = {
  /** Câte topicuri are un flux. */
  items: number;
  /** Începutul primei postări ca descriere. */
  snippets: boolean;
  /** Fluxul general `/rss.xml` (topicurile recente din toate forumurile publice). */
  siteFeed: boolean;
  /** Cât țin cititoarele și proxy-urile fluxul în cache (minute). */
  cacheMinutes: number;
};

export const DEFAULT_RSS: GcsRssConfig = { items: 20, snippets: true, siteFeed: true, cacheMinutes: 5 };

const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function rssConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsRssConfig>;
  if (typeof c.snippets !== "boolean" || typeof c.siteFeed !== "boolean") return "invalid";
  return int(c.items, 5, 50) && int(c.cacheMinutes, 1, 1440) ? null : "invalid_range";
}

export const rssSetting: GcsSettingDef = { key: RSS_SETTING, type: "json", default: DEFAULT_RSS, section: "rss", labelKey: "settings.rss.config", validate: rssConfigError };

export async function loadRssConfig(settings: Pick<GcsSettingsService, "get">): Promise<GcsRssConfig> {
  const v = await settings.get<GcsRssConfig | null>(RSS_SETTING).catch(() => null);
  return v && rssConfigError(v) === null ? v : DEFAULT_RSS;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Un flux RSS 2.0 (canalul și articolele), cu textele scăpate. */
export function rssDocument(channel: { title: string; link: string; description: string }, items: { title: string; link: string; date: Date; description?: string | null }[]): string {
  const body = items
    .map(
      (i) =>
        `<item><title>${xml(i.title)}</title><link>${xml(i.link)}</link><guid isPermaLink="true">${xml(i.link)}</guid><pubDate>${i.date.toUTCString()}</pubDate>` +
        `${i.description ? `<description>${xml(i.description)}</description>` : ""}</item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(channel.title)}</title><link>${xml(channel.link)}</link><description>${xml(channel.description)}</description>${body}</channel></rss>`;
}
