/** Furnizorii de embed suportați (setarea `forums.embeds` îi poate dezactiva). */
export type GcsEmbedProvider = "youtube" | "twitch" | "medal" | "image";

/**
 * Un embed recunoscut. `id` e validat strict, pentru că ajunge în `src`-ul unui iframe:
 * - youtube: id-ul de 11 caractere;
 * - twitch: `video:<număr>`, `clip:<slug>` sau `channel:<nume>`;
 * - medal: id-ul clipului;
 * - image: URL-ul https complet al imaginii.
 */
export type GcsEmbed = { provider: GcsEmbedProvider; id: string };

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const TWITCH_HOSTS = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv"]);
const MEDAL_HOSTS = new Set(["medal.tv", "www.medal.tv"]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_VIDEO = /^\d{1,15}$/;
const TWITCH_SLUG = /^[A-Za-z0-9_-]{1,100}$/;
const TWITCH_CHANNEL = /^[A-Za-z0-9_]{3,25}$/;
const MEDAL_ID = /^[A-Za-z0-9_-]{4,40}$/;
const IMAGE_PATH = /\.(png|jpe?g|gif|webp)$/i;
const HOSTNAME = /^[a-z0-9.-]{1,253}$/i;

/** Recunoaște un URL de embed; orice altceva (alt domeniu, http, id invalid) → `null`. */
export function parseEmbedUrl(raw: string): GcsEmbed | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    const id = segments[0] === "watch" || url.pathname === "/watch" ? url.searchParams.get("v") : ["shorts", "embed", "live"].includes(segments[0] ?? "") ? segments[1] : null;
    return id && YOUTUBE_ID.test(id) ? { provider: "youtube", id } : null;
  }
  if (host === "youtu.be") {
    const id = segments[0];
    return id && YOUTUBE_ID.test(id) ? { provider: "youtube", id } : null;
  }
  if (host === "clips.twitch.tv") {
    const slug = segments[0];
    return slug && TWITCH_SLUG.test(slug) ? { provider: "twitch", id: `clip:${slug}` } : null;
  }
  if (TWITCH_HOSTS.has(host)) {
    if (segments[0] === "videos" && segments[1] && TWITCH_VIDEO.test(segments[1])) return { provider: "twitch", id: `video:${segments[1]}` };
    if (segments[1] === "clip" && segments[2] && TWITCH_SLUG.test(segments[2])) return { provider: "twitch", id: `clip:${segments[2]}` };
    if (segments.length === 1 && TWITCH_CHANNEL.test(segments[0]!)) return { provider: "twitch", id: `channel:${segments[0]}` };
    return null;
  }
  if (MEDAL_HOSTS.has(host)) {
    const id = segments[0] === "games" && segments[2] === "clips" ? segments[3] : ["clip", "clips"].includes(segments[0] ?? "") ? segments[1] : undefined;
    return id && MEDAL_ID.test(id) ? { provider: "medal", id } : null;
  }
  if (IMAGE_PATH.test(url.pathname)) return { provider: "image", id: url.href };
  return null;
}

/**
 * `src`-ul iframe-ului pentru un embed video, sau `null` dacă id-ul nu e valid (ex. JSON modificat de mână).
 * Twitch cere `parent` = host-ul site-ului; la schimbarea domeniului, conținutul trebuie re-randat.
 */
export function embedIframeSrc(embed: GcsEmbed, siteHost: string): string | null {
  const parent = siteHost.split(":")[0] ?? "";
  if (!HOSTNAME.test(parent)) return null;
  switch (embed.provider) {
    case "youtube":
      return YOUTUBE_ID.test(embed.id) ? `https://www.youtube-nocookie.com/embed/${embed.id}` : null;
    case "medal":
      return MEDAL_ID.test(embed.id) ? `https://medal.tv/clip/${embed.id}` : null;
    case "twitch": {
      const [kind, value = ""] = embed.id.split(/:(.*)/s);
      if (kind === "video" && TWITCH_VIDEO.test(value)) return `https://player.twitch.tv/?video=${value}&parent=${parent}&autoplay=false`;
      if (kind === "channel" && TWITCH_CHANNEL.test(value)) return `https://player.twitch.tv/?channel=${value}&parent=${parent}&autoplay=false`;
      if (kind === "clip" && TWITCH_SLUG.test(value)) return `https://clips.twitch.tv/embed?clip=${value}&parent=${parent}`;
      return null;
    }
    case "image":
      return null;
  }
}

/** Domeniile iframe-urilor permise de sanitizare (în sincron cu `embedIframeSrc`). */
export const GCS_EMBED_IFRAME_HOSTS = ["www.youtube-nocookie.com", "player.twitch.tv", "clips.twitch.tv", "medal.tv"];
