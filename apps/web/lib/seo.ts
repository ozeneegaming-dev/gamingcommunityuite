import "server-only";
import { applyContentPolicy, GCS_DEFAULT_CONTENT_POLICY, type GcsActor, type GcsContentPolicy } from "@gcs/core";
import { loadContentPolicy, loadSeoMeta, TITLE_FORMAT_DEFAULT, type GcsSeoMeta } from "@gcs/modules";
import type { Metadata } from "next";
import { cache } from "react";
import { services } from "./services";

/** Adresa publică a site-ului: setarea `site.url`, altfel `GCS_BASE_URL`. Fără `/` la final. */
export async function siteBaseUrl(): Promise<string> {
  let url = "";
  try {
    url = await services().settings.get<string>("site.url");
  } catch {
    // Baza poate lipsi (ex. înainte de instalare).
  }
  url ||= process.env.GCS_BASE_URL ?? "http://localhost:3000";
  return URL.canParse(url) ? new URL(url).origin : "http://localhost:3000";
}

/** Un vizitator (fără cont): ce văd motoarele de căutare. */
export async function guestActor(): Promise<GcsActor> {
  const guest = await services().db.group.findUniqueOrThrow({ where: { key: "guest" }, select: { id: true } });
  return { userId: null, groupIds: [guest.id], primaryGroupId: guest.id, isBanned: false, ip: "0.0.0.0" };
}

/** Textul simplu dintr-un HTML de postare (deja sanitizat), scurtat la `max` caractere, pentru descrieri. */
export function excerpt(html: string, max = 200): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** Prima imagine dintr-un HTML de postare (pentru OpenGraph). */
export function firstImage(html: string): string | null {
  return /<img[^>]+src="([^"]+)"/.exec(html)?.[1] ?? null;
}

const NO_SEO: GcsSeoMeta = { titleFormat: TITLE_FORMAT_DEFAULT, description: "", shareImage: "", xHandle: "", verification: { google: "", bing: "", yandex: "" }, indexProfiles: true };

/** Setările de metadate (ACP → Promovare → SEO), o dată pe request; înainte de instalare, valorile implicite. */
export const seoMeta = cache(async (): Promise<GcsSeoMeta> => {
  try {
    return await loadSeoMeta(services().settings);
  } catch {
    return NO_SEO;
  }
});

/**
 * Politica de afișare a conținutului membrilor (linkurile externe cu sau fără nofollow, imaginile externe), o dată pe
 * request, pentru host-ul site-ului.
 */
export const contentPolicy = cache(async (): Promise<GcsContentPolicy> => {
  const host = new URL(await siteBaseUrl()).host;
  try {
    return await loadContentPolicy(services().settings, host);
  } catch {
    return { ...GCS_DEFAULT_CONTENT_POLICY, siteHost: host };
  }
});

/** HTML-ul salvat al conținutului membrilor (postări, semnături, profiluri, mesaje) cu politica de afișare aplicată. */
export async function userContentHtml(html: string): Promise<string>;
export async function userContentHtml(html: string[]): Promise<string[]>;
export async function userContentHtml(html: string | string[]): Promise<string | string[]> {
  const policy = await contentPolicy();
  return Array.isArray(html) ? html.map((h) => applyContentPolicy(h, policy)) : applyContentPolicy(html, policy);
}

export type GcsPageSeo = {
  title: string;
  description?: string | null;
  /** Adresa canonică, relativă la site (`/topic/12-ghid`). */
  path: string;
  /** Imaginea paginii (prima imagine a postării, avatarul); lipsă → imaginea de distribuire din ACP. */
  image?: string | null;
  type?: "website" | "article" | "profile";
  /** Pagina nu se indexează (`noindex`). */
  noindex?: boolean;
  /** Alte adrese alternative (ex. fluxul RSS al forumului). */
  alternates?: NonNullable<Metadata["alternates"]>;
};

/**
 * Metadatele comune ale paginilor de conținut (topic, forum, profil): titlul (formatul din ACP îl aplică layout-ul),
 * descrierea, adresa canonică, OpenGraph (cu numele site-ului și imaginea) și cardul X (cu `twitter:site`).
 */
export async function pageMetadata(page: GcsPageSeo): Promise<Metadata> {
  const meta = await seoMeta();
  let siteName = "GamingCommunitySuite";
  try {
    siteName = (await services().settings.get<string>("site.name")) || siteName;
  } catch {
    // Înainte de instalare: numele implicit.
  }
  const description = page.description?.trim() || undefined;
  const image = page.image || meta.shareImage || undefined;
  return {
    title: page.title,
    ...(description ? { description } : {}),
    alternates: { ...page.alternates, canonical: page.path },
    openGraph: {
      title: page.title,
      ...(description ? { description } : {}),
      type: page.type ?? "website",
      url: page.path,
      siteName,
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: page.title,
      ...(description ? { description } : {}),
      ...(image ? { images: [image] } : {}),
      ...(meta.xHandle ? { site: meta.xHandle } : {}),
    },
    ...(page.noindex ? { robots: { index: false } } : {}),
  };
}
