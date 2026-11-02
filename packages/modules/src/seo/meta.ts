import { GCS_DEFAULT_CONTENT_POLICY, parseLinkDomains, type GcsContentPolicy, type GcsSettingsService } from "@gcs/core";
import { loadRemoteImageMode } from "../uploads/settings";
import { SEO_SETTINGS, TITLE_FORMAT_DEFAULT, titleFormatError, verificationToken } from "./settings";

type Settings = Pick<GcsSettingsService, "get">;

/**
 * Șablonul titlului pentru Next.js (`%s` = titlul paginii) din formatul ales în ACP: `{page} · {site}` →
 * `%s · Comunitatea mea`. Un format invalid (salvat înainte de validare) → cel implicit.
 */
export function titleTemplate(format: string, siteName: string): string {
  const f = titleFormatError(format) === null ? format : TITLE_FORMAT_DEFAULT;
  return f.replace("{page}", "%s").split("{site}").join(siteName.replace(/%s/g, "%"));
}

export type GcsSeoMeta = {
  titleFormat: string;
  description: string;
  shareImage: string;
  /** Contul X, cu `@` (gol = fără `twitter:site`). */
  xHandle: string;
  verification: { google: string; bing: string; yandex: string };
  indexProfiles: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Setările de metadate ale paginilor (titlul, descrierea, imaginea, X, verificările, indexarea profilurilor). */
export async function loadSeoMeta(settings: Settings): Promise<GcsSeoMeta> {
  const keys = [
    SEO_SETTINGS.titleFormat,
    SEO_SETTINGS.description,
    SEO_SETTINGS.shareImage,
    SEO_SETTINGS.xHandle,
    SEO_SETTINGS.googleVerification,
    SEO_SETTINGS.bingVerification,
    SEO_SETTINGS.yandexVerification,
    SEO_SETTINGS.indexProfiles,
  ];
  const [title, description, image, x, google, bing, yandex, profiles] = await Promise.all(keys.map((k) => settings.get<unknown>(k).catch(() => undefined)));
  const handle = str(x).trim().replace(/^@/, "");
  return {
    titleFormat: str(title) || TITLE_FORMAT_DEFAULT,
    description: str(description).trim(),
    shareImage: str(image).trim(),
    xHandle: handle ? `@${handle}` : "",
    verification: { google: verificationToken(str(google)), bing: verificationToken(str(bing)), yandex: verificationToken(str(yandex)) },
    indexProfiles: profiles !== false,
  };
}

/** Tag-urile de verificare pentru `metadata.verification` din Next.js (Bing: `msvalidate.01`); `undefined` dacă lipsesc. */
export function verificationMetadata(v: GcsSeoMeta["verification"]): { google?: string; yandex?: string; other?: Record<string, string> } | undefined {
  const out = { ...(v.google ? { google: v.google } : {}), ...(v.yandex ? { yandex: v.yandex } : {}), ...(v.bing ? { other: { "msvalidate.01": v.bing } } : {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Politica de afișare a conținutului membrilor (linkurile externe, imaginile externe) pentru site-ul `siteHost`. */
export async function loadContentPolicy(settings: Settings, siteHost: string): Promise<GcsContentPolicy> {
  const [nofollow, exclude, remoteImages] = await Promise.all([
    settings.get<boolean>(SEO_SETTINGS.nofollowExternal).catch(() => GCS_DEFAULT_CONTENT_POLICY.nofollowExternal),
    settings.get<string>(SEO_SETTINGS.nofollowExclude).catch(() => ""),
    loadRemoteImageMode(settings),
  ]);
  return { siteHost, nofollowExternal: nofollow !== false, nofollowExclude: parseLinkDomains(typeof exclude === "string" ? exclude : ""), remoteImages };
}
