import { settingValueError } from "@gcs/core";
import { describe, expect, test } from "vitest";
import { loadUploadPolicy, UPLOAD_SETTING_DEFS, UPLOAD_SETTINGS } from "../uploads/settings";
import { indexNowBackoffMs, isLocalSite, newIndexNowKey } from "./indexnow";
import { loadContentPolicy, loadSeoMeta, titleTemplate, verificationMetadata } from "./meta";
import { buildRobotsTxt, ROBOTS_DEFAULT_DISALLOW } from "./robots";
import { ROBOTS_CUSTOM_MAX, robotsCustomError, SEO_SETTING_DEFS, shareImageError, titleFormatError, verificationError, verificationToken, xHandleError } from "./settings";
import { parseSitemapChunk, sitemapChunkCount, sitemapChunkName, sitemapIndexXml, sitemapUrlsetXml, sitemapWindow } from "./sitemap";

const BASE = "https://forum.exemplu.ro";
/** Setări de test: valorile date, altfel cea implicită din definiții. */
function stubSettings(values: Record<string, unknown>) {
  const defs = new Map([...SEO_SETTING_DEFS, ...UPLOAD_SETTING_DEFS].map((d) => [d.key, d.default]));
  return { get: async <T,>(key: string): Promise<T> => (key in values ? values[key] : defs.get(key)) as T };
}

describe("robots.txt", () => {
  test("implicit: deschis, fără ACP / API / installer / autentificare / căutare, cu sitemap-ul", () => {
    const txt = buildRobotsTxt({ mode: "default", custom: "", base: BASE, sitemap: true });
    expect(txt.startsWith("User-agent: *\nAllow: /\n")).toBe(true);
    for (const path of ["/admin", "/api/", "/install", "/login", "/register", "/forgot-password", "/reset-password", "/search"]) {
      expect(txt).toContain(`\nDisallow: ${path}\n`);
    }
    expect(ROBOTS_DEFAULT_DISALLOW.length).toBeGreaterThan(8);
    expect(txt.trimEnd().endsWith(`Sitemap: ${BASE}/sitemap.xml`)).toBe(true);
  });

  test("cu sitemap-ul oprit nu mai are linia Sitemap", () => {
    expect(buildRobotsTxt({ mode: "default", custom: "", base: BASE, sitemap: false })).not.toContain("Sitemap:");
  });

  test("personalizat: textul adminului (rânduri normalizate), cu linia sitemap-ului adăugată doar dacă lipsește", () => {
    const custom = "User-agent: *\r\nDisallow: /privat   \r\n\r\n\r\n\r\nUser-agent: BadBot\r\nDisallow: /";
    expect(buildRobotsTxt({ mode: "custom", custom, base: BASE, sitemap: true })).toBe(
      `User-agent: *\nDisallow: /privat\n\nUser-agent: BadBot\nDisallow: /\n\nSitemap: ${BASE}/sitemap.xml\n`,
    );
    const own = "User-agent: *\nAllow: /\nsitemap: https://cdn.exemplu.ro/harta.xml";
    expect(buildRobotsTxt({ mode: "custom", custom: own, base: BASE, sitemap: true })).toBe(`${own}\n`);
    expect(buildRobotsTxt({ mode: "custom", custom: "User-agent: *\nDisallow:", base: BASE, sitemap: false })).toBe("User-agent: *\nDisallow:\n");
  });

  test("personalizat dar gol → cel implicit; textul prea lung e refuzat la salvare și tăiat la afișare", () => {
    expect(buildRobotsTxt({ mode: "custom", custom: "   \n ", base: BASE, sitemap: true })).toBe(buildRobotsTxt({ mode: "default", custom: "", base: BASE, sitemap: true }));
    expect(robotsCustomError("User-agent: *\nDisallow: /x")).toBeNull();
    expect(robotsCustomError("x".repeat(ROBOTS_CUSTOM_MAX + 1))).toBe("too_long");
    expect(robotsCustomError("User-agent: *\u0000")).toBe("invalid_chars");
    expect(buildRobotsTxt({ mode: "custom", custom: "a".repeat(ROBOTS_CUSTOM_MAX + 50), base: BASE, sitemap: false }).length).toBe(ROBOTS_CUSTOM_MAX + 1);
  });
});

describe("titlul, metadatele și verificarea", () => {
  test("formatul titlului: {page} obligatoriu o dată, {site} oricâte", () => {
    expect(titleFormatError("{page} · {site}")).toBeNull();
    expect(titleFormatError("{site} — {page}")).toBeNull();
    expect(titleFormatError("{site}")).toBe("page_placeholder");
    expect(titleFormatError("{page} {page}")).toBe("page_placeholder");
    expect(titleFormatError("<b>{page}</b>")).toBe("page_placeholder");
    expect(titleTemplate("{page} · {site}", "Clanul Meu")).toBe("%s · Clanul Meu");
    expect(titleTemplate("{site} | {page}", "Clanul Meu")).toBe("Clanul Meu | %s");
    // Un format stricat (salvat înainte de validare) → cel implicit.
    expect(titleTemplate("fără pagină", "X")).toBe("%s · X");
  });

  test("imaginea de distribuire, contul X și codurile de verificare se validează", () => {
    expect(shareImageError("")).toBeNull();
    expect(shareImageError("/files/abc123")).toBeNull();
    expect(shareImageError("https://cdn.exemplu.ro/og.png")).toBeNull();
    expect(shareImageError("http://cdn.exemplu.ro/og.png")).toBe("invalid_url");
    expect(shareImageError("javascript:alert(1)")).toBe("invalid_url");
    expect(xHandleError("@clanul_meu")).toBeNull();
    expect(xHandleError("clanul meu")).toBe("invalid_handle");
    expect(verificationError("")).toBeNull();
    expect(verificationError("abc-DEF_123")).toBeNull();
    expect(verificationError('<meta name="google-site-verification" content="XyZ-123_ab" />')).toBeNull();
    expect(verificationToken('<meta name="google-site-verification" content="XyZ-123_ab" />')).toBe("XyZ-123_ab");
    expect(verificationError('"><script>alert(1)</script>')).toBe("invalid_token");
  });

  test("loadSeoMeta: valorile salvate, codurile din tag-uri, contul X cu @; verificările pentru Next.js", async () => {
    const meta = await loadSeoMeta(
      stubSettings({
        "seo.title_format": "{site} — {page}",
        "site.description": "  Comunitatea de CS2  ",
        "seo.x_handle": "clanul_meu",
        "seo.google_verification": '<meta name="google-site-verification" content="g-123" />',
        "seo.bing_verification": "B1NG",
        "seo.index_profiles": false,
      }),
    );
    expect(meta).toMatchObject({ titleFormat: "{site} — {page}", description: "Comunitatea de CS2", xHandle: "@clanul_meu", indexProfiles: false, verification: { google: "g-123", bing: "B1NG", yandex: "" } });
    expect(verificationMetadata(meta.verification)).toEqual({ google: "g-123", other: { "msvalidate.01": "B1NG" } });
    expect(verificationMetadata({ google: "", bing: "", yandex: "" })).toBeUndefined();
  });

  test("toate setările SEO și ale încărcărilor au valori implicite valide", () => {
    for (const def of [...SEO_SETTING_DEFS, ...UPLOAD_SETTING_DEFS]) expect(settingValueError(def, def.default), def.key).toBeNull();
  });
});

describe("politicile din setări", () => {
  test("loadContentPolicy: lista albă normalizată, imaginile externe", async () => {
    const policy = await loadContentPolicy(stubSettings({ "seo.nofollow_exclude": "https://www.Clan.ro\ncs.exemplu.com", "uploads.remote_images": "block" }), "forum.exemplu.ro");
    expect(policy).toEqual({ siteHost: "forum.exemplu.ro", nofollowExternal: true, nofollowExclude: ["clan.ro", "cs.exemplu.com"], remoteImages: "block" });
  });

  test("loadUploadPolicy: extensiile și imaginile din setări (implicit 2000 px, 82 %, WebP, fără EXIF, miniaturi 400)", async () => {
    expect(await loadUploadPolicy(stubSettings({}))).toMatchObject({ image: { maxSide: 2000, quality: 82, webp: true, stripMetadata: true, thumbnailSide: 400 } });
    const custom = await loadUploadPolicy(stubSettings({ [UPLOAD_SETTINGS.allowedExtensions]: "JPEG, .png", [UPLOAD_SETTINGS.convertWebp]: false, [UPLOAD_SETTINGS.thumbnailSide]: 0 }));
    expect(custom.allowedExtensions).toEqual(["jpg", "png"]);
    expect(custom.image).toMatchObject({ webp: false, thumbnailSide: 0 });
    const def = UPLOAD_SETTING_DEFS.find((d) => d.key === UPLOAD_SETTINGS.allowedExtensions)!;
    expect(settingValueError(def, "png, php")).toBe("dangerous_extension");
  });
});

describe("sitemap: bucățile și XML-ul", () => {
  test("numărul de fișiere respectă limita pe tip și bucata", () => {
    expect(sitemapChunkCount(0, 50_000)).toBe(0);
    expect(sitemapChunkCount(10_000, 50_000)).toBe(1);
    expect(sitemapChunkCount(10_001, 50_000)).toBe(2);
    expect(sitemapChunkCount(120_000, 50_000)).toBe(5);
    expect(sitemapChunkCount(5, 50_000, 2)).toBe(3);
    expect(sitemapWindow(1, 50_000)).toEqual({ skip: 0, take: 10_000 });
    expect(sitemapWindow(5, 45_000)).toEqual({ skip: 40_000, take: 5_000 });
    expect(sitemapWindow(6, 50_000)).toBeNull();
  });

  test("numele fișierelor: doar tipurile cunoscute și numere pozitive", () => {
    expect(parseSitemapChunk("topics-2.xml")).toEqual({ type: "topics", page: 2 });
    expect(sitemapChunkName({ type: "members", page: 1 })).toBe("members-1.xml");
    for (const bad of ["topics-0.xml", "secret-1.xml", "topics-1.txt", "../topics-1.xml"]) expect(parseSitemapChunk(bad), bad).toBeNull();
  });

  test("XML-ul e escapat și are lastmod din conținut", () => {
    expect(sitemapIndexXml(BASE, ["topics-1.xml"])).toContain(`<sitemap><loc>${BASE}/sitemap/topics-1.xml</loc></sitemap>`);
    const xml = sitemapUrlsetXml(BASE, [{ path: "/topic/1-a&b", lastModified: new Date("2026-11-01T10:00:00Z") }, { path: "/" }]);
    expect(xml).toContain(`<url><loc>${BASE}/topic/1-a&amp;b</loc><lastmod>2026-11-01T10:00:00.000Z</lastmod></url>`);
    expect(xml).toContain(`<url><loc>${BASE}/</loc></url>`);
  });
});

describe("IndexNow: cheia, site-urile locale, așteptarea după erori", () => {
  test("cheia are 32 de caractere hexazecimale și e mereu alta", () => {
    const a = newIndexNowKey();
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(newIndexNowKey()).not.toBe(a);
  });

  test("site-urile fără nume public nu trimit nimic", () => {
    for (const local of ["http://localhost:3100", "http://127.0.0.1", "https://forum.test", "http://[::1]:3000", "nu e adresă"]) expect(isLocalSite(local), local).toBe(true);
    expect(isLocalSite("https://forum.exemplu.ro")).toBe(false);
  });

  test("429 respectă Retry-After (minim o oră), 403 așteaptă 6 ore, restul crește exponențial (max 6 ore)", () => {
    expect(indexNowBackoffMs(429, 1, null)).toBe(3_600_000);
    expect(indexNowBackoffMs(429, 1, 7200)).toBe(7_200_000);
    expect(indexNowBackoffMs(429, 3, null)).toBe(4 * 3_600_000);
    expect(indexNowBackoffMs(403, 1, null)).toBe(6 * 3_600_000);
    expect(indexNowBackoffMs(503, 1, null)).toBe(5 * 60_000);
    expect(indexNowBackoffMs(0, 3, null)).toBe(20 * 60_000);
    expect(indexNowBackoffMs(500, 20, null)).toBe(6 * 3_600_000);
  });
});
