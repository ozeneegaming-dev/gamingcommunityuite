import { slugify } from "../../forums/slug";
import { matchLegacyPath, stripLegacyPrefix, type GcsLegacyTarget } from "../legacyUrls";
import type { GcsImportSchema } from "../types";

export type GcsConvertAttachment = { id: string; isImage: boolean; filename: string; width: number | null; height: number | null };

/**
 * Ce știe convertorul despre entitățile deja importate (rezolvare sincronă: motorul încarcă harta înainte).
 * Id-urile primite sunt cele din sursă.
 */
export type GcsConvertContext = {
  schema: GcsImportSchema;
  /** Adresa veche a site-ului (ex. `https://vechi.exemplu.ro/forum`), pentru linkurile interne. */
  oldUrl: string | null;
  member(id: string): { id: string; name: string } | null;
  memberByName(name: string): { id: string; name: string } | null;
  post(id: string): { id: number; topicId: number } | null;
  topic(id: string): { id: number; slug: string } | null;
  forum(id: string): { id: number; slug: string } | null;
  attachment(id: string): GcsConvertAttachment | null;
};

/** Un context gol (teste, rularea de probă): nimic nu e încă importat. */
export function emptyContext(schema: GcsImportSchema, oldUrl: string | null = null): GcsConvertContext {
  return { schema, oldUrl, member: () => null, memberByName: () => null, post: () => null, topic: () => null, forum: () => null, attachment: () => null };
}

/** Aceeași regulă ca în renderer: `http`/`https`/`mailto`, căi relative (nu `//`) și ancore. */
export function isSafeHref(href: string): boolean {
  if (href.length > 2000 || /[\s\u0000-\u001f]/.test(href)) return false;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  if (href.startsWith("#")) return true;
  if (!URL.canParse(href)) return false;
  return ["http:", "https:", "mailto:"].includes(new URL(href).protocol);
}

/** Adresa GCS a unei entități importate; `null` dacă nu e (încă) în hartă. */
export function resolveTarget(target: GcsLegacyTarget, ctx: GcsConvertContext): string | null {
  switch (target.kind) {
    case "topic": {
      const t = ctx.topic(target.id);
      return t ? `/topic/${t.id}-${t.slug}` : null;
    }
    case "forum": {
      const f = ctx.forum(target.id);
      return f ? `/forum/${f.id}-${f.slug}` : null;
    }
    case "member": {
      const m = ctx.member(target.id);
      return m ? `/members/${m.id}-${slugify(m.name)}` : null;
    }
    case "post": {
      const p = ctx.post(target.id);
      return p ? `/topic/${p.topicId}/post/${p.id}` : null;
    }
  }
}

/** Înlocuiește marcajele de adresă ale conținutului vechi (`<___base_url___>`, `<fileStore.…>`) cu adresa veche. */
export function replaceMarkers(value: string, oldUrl: string | null): string {
  const base = (oldUrl ?? "").replace(/\/+$/, "");
  return value.replace(/<___base_url___>/g, base).replace(/<fileStore\.[A-Za-z0-9_]+>/g, `${base}/uploads`);
}

/**
 * Un link din conținutul vechi:
 * - spre site-ul vechi (topic, forum, membru, postare) → adresa GCS, dacă entitatea e importată, altfel calea veche
 *   relativă (rezolvată la click de redirecturile 301);
 * - extern și sigur → neschimbat;
 * - periculos (`javascript:`, `data:`…) → `null` (rămâne doar textul).
 */
export function rewriteHref(raw: string, ctx: GcsConvertContext): string | null {
  let href = replaceMarkers(raw.trim(), ctx.oldUrl);
  if (!href) return null;
  if (href.startsWith("//")) href = `https:${href}`;
  const old = ctx.oldUrl && URL.canParse(ctx.oldUrl) ? new URL(ctx.oldUrl) : null;
  let url: URL | null = null;
  if (/^https?:\/\//i.test(href) && URL.canParse(href)) url = new URL(href);
  else if (href.startsWith("/") && old) url = new URL(href, old.origin);
  if (url && old && url.host.toLowerCase() === old.host.toLowerCase()) {
    const rel = stripLegacyPrefix(url.pathname, old.pathname);
    if (rel !== null) {
      const target = matchLegacyPath(ctx.schema, rel, url.search);
      if (target) return resolveTarget(target, ctx) ?? `${url.pathname}${url.search}`;
    }
  }
  return isSafeHref(href) ? href : null;
}
