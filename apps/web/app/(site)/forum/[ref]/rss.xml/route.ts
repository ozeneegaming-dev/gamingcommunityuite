import { GcsForbidden, GcsNotFound } from "@gcs/core";
import { parseRef } from "@gcs/modules";
import { topicHref } from "@/lib/forum-urls";
import { guestActor } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string }> };

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/**
 * Fluxul RSS al unui forum (Forum v2, setarea „RSS per forum”): cele mai noi topicuri pe care le vede un vizitator
 * (forumurile private, cu parolă sau „doar topicurile mele” nu au flux), cu începutul primei postări.
 */
export async function GET(_req: Request, { params }: Props): Promise<Response> {
  const ref = parseRef((await params).ref);
  if (!ref) return new Response(null, { status: 404 });
  const { forumQueries, settings } = services();
  if (!(await settings.get<boolean>("forums.rss_enabled"))) return new Response(null, { status: 404 });
  let data;
  try {
    data = await forumQueries.forum(await guestActor(), ref.id, { page: 1, snippets: true, sort: "created" });
  } catch (error) {
    if (error instanceof GcsNotFound || error instanceof GcsForbidden) return new Response(null, { status: 404 });
    throw error;
  }
  if (data.options.hasPassword || data.options.ownTopicsOnly || data.forum.type === "LINK" || data.forum.type === "CATEGORY") return new Response(null, { status: 404 });
  const base = ((await settings.get<string>("site.url")) || process.env.GCS_BASE_URL || "").replace(/\/$/, "");
  const siteName = await settings.get<string>("site.name");
  const link = `${base}/forum/${data.forum.id}-${data.forum.slug}`;
  const items = data.topics
    .map(
      (t) =>
        `<item><title>${xml(t.title)}</title><link>${xml(`${base}${topicHref(t)}`)}</link><guid isPermaLink="true">${xml(`${base}${topicHref(t)}`)}</guid>` +
        `<pubDate>${new Date(t.createdAt).toUTCString()}</pubDate>` +
        `${t.snippet ? `<description>${xml(t.snippet)}</description>` : ""}</item>`,
    )
    .join("");
  const body =
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(`${data.forum.name} · ${siteName}`)}</title><link>${xml(link)}</link>` +
    `<description>${xml(data.forum.description || data.forum.name)}</description>${items}</channel></rss>`;
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
