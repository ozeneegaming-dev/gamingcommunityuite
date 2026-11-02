import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { fixture, forumTree, member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, setSetting, sql, useFreshIp } from "./helpers";
import { e2eKv } from "./kv";

/**
 * ACP → Promovare → SEO și ACP → Setări → Încărcări și imagini: robots.txt și sitemap-ul urmează setările, codurile de
 * verificare apar în `<head>`, linkurile externe din postări primesc nofollow (în afară de lista albă), imaginile externe
 * blocate devin linkuri, iar o fotografie mare cu EXIF ajunge WebP micșorat, fără metadate. Capturile: `GCS_SHOTS_DIR`.
 */
const SHOTS = process.env.GCS_SHOTS_DIR ?? "";
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

const SEO_KEYS = [
  "seo.robots_mode",
  "seo.robots_custom",
  "seo.sitemap_enabled",
  "seo.sitemap_members",
  "seo.title_format",
  "seo.google_verification",
  "seo.bing_verification",
  "seo.nofollow_exclude",
  "seo.nofollow_external",
  "uploads.remote_images",
  "uploads.image_quality",
  "uploads.allowed_extensions",
];

/** Readuce setările testate și golește sitemap-urile din cache (scrise cu setările testului). */
async function resetAll(): Promise<void> {
  for (const key of SEO_KEYS) await resetSetting(key);
  const kv = await e2eKv();
  try {
    const keys = await kv.keys("gcs:k:sitemap*");
    if (keys.length > 0) await kv.del(...keys);
  } finally {
    kv.disconnect();
  }
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.70");
});
test.afterAll(resetAll);

/** Toate adresele din sitemap: indexul, apoi fiecare fișier al lui. */
async function sitemapUrls(request: APIRequestContext): Promise<{ files: string[]; urls: string[] }> {
  const index = await request.get("/sitemap.xml");
  if (index.status() === 404) return { files: [], urls: [] };
  const files = [...(await index.text()).matchAll(/<loc>[^<]*\/sitemap\/([^<]+)<\/loc>/g)].map((m) => m[1]!);
  const urls: string[] = [];
  for (const f of files) urls.push(...[...(await (await request.get(`/sitemap/${f}`)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!));
  return { files, urls };
}

/** Salvează un card al paginii SEO și așteaptă „Salvat”. */
async function saveCard(page: Page, testId: string): Promise<void> {
  const card = page.getByTestId(testId);
  await card.getByRole("button", { name: "Salvează" }).first().click();
  await expect(card.getByRole("status")).toHaveText("Salvat");
}

test("ACP SEO: robots.txt personalizat, sitemap-ul fără profiluri sau oprit, verificarea și formatul titlului", async ({ page, request }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Seo${id}`, `seo-${id}@example.com`);
  const t = await forumTree(request);
  const topic = await fixture<{ topicId: number }>(request, { action: "topic", forumId: t.forum.id, title: `Ghid SEO ${id}`, text: "Despre sitemap", authorEmail: `seo-${id}@example.com` });
  try {
    await page.goto("/admin/system/seo");
    await expect(page.getByRole("heading", { name: "SEO", level: 1 })).toBeVisible();
    await expect(page.getByText("Această secțiune vine într-o etapă următoare")).toHaveCount(0);
    await expect(page.getByTestId("gcs-seo-robots-preview")).toContainText("Disallow: /admin");
    await shot(page, "acp-seo");

    // robots.txt personalizat: textul adminului, cu linia sitemap-ului adăugată.
    const robots = page.getByTestId("gcs-seo-robots");
    await robots.getByLabel("robots.txt").selectOption("custom");
    await robots.getByLabel("Textul personalizat").fill(`User-agent: *\nDisallow: /privat-${id}`);
    await saveCard(page, "gcs-seo-robots");
    await expect(page.getByTestId("gcs-seo-robots-preview")).toContainText(`Disallow: /privat-${id}`);
    const txt = await (await request.get("/robots.txt")).text();
    expect(txt).toContain(`User-agent: *\nDisallow: /privat-${id}\n`);
    expect(txt).toMatch(/\nSitemap: https?:\/\/[^\n]+\/sitemap\.xml\n$/);
    expect(txt).not.toContain("Disallow: /admin");

    // Sitemap: topicul public e acolo, profilul autorului (are o postare) la fel; fără profiluri → lipsesc.
    let map = await sitemapUrls(request);
    expect(map.urls.some((u) => u.includes(`/topic/${topic.topicId}-`))).toBe(true);
    expect(map.files).toContain("members-1.xml");
    const sitemap = page.getByTestId("gcs-seo-sitemap");
    await sitemap.getByLabel("Profilurile membrilor", { exact: true }).uncheck();
    await saveCard(page, "gcs-seo-sitemap");
    map = await sitemapUrls(request);
    expect(map.files).not.toContain("members-1.xml");
    expect(map.urls.some((u) => u.includes("/members/"))).toBe(false);
    expect((await request.get("/sitemap/members-1.xml")).status()).toBe(404);

    // Sitemap oprit: 404, iar robots.txt nu mai are linia Sitemap.
    await sitemap.getByLabel("Sitemap pornit").uncheck();
    await saveCard(page, "gcs-seo-sitemap");
    expect((await request.get("/sitemap.xml")).status()).toBe(404);
    expect(await (await request.get("/robots.txt")).text()).not.toContain("Sitemap:");

    // Verificarea: codurile (sau tag-ul întreg lipit) devin meta în <head>; formatul titlului se aplică paginilor.
    const verify = page.getByTestId("gcs-seo-verification");
    await verify.getByLabel("Google Search Console").fill(`<meta name="google-site-verification" content="g-${id}" />`);
    await verify.getByLabel("Bing Webmaster Tools").fill(`B${id}`);
    await saveCard(page, "gcs-seo-verification");
    const meta = page.getByTestId("gcs-seo-meta");
    await meta.getByLabel("Formatul titlului").fill("{site} | {page}");
    await saveCard(page, "gcs-seo-meta");
    await meta.getByLabel("Formatul titlului").fill("fără pagină");
    await meta.getByRole("button", { name: "Salvează" }).first().click();
    await expect(meta.getByRole("alert").first()).toBeVisible();
    await shot(page, "acp-seo-saved");

    await page.goto(`/topic/${topic.topicId}`);
    await expect(page.locator('meta[name="google-site-verification"]')).toHaveAttribute("content", `g-${id}`);
    await expect(page.locator('meta[name="msvalidate.01"]')).toHaveAttribute("content", `B${id}`);
    await expect(page).toHaveTitle(new RegExp(`\\| Ghid SEO ${id}$`));
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", /summary/);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/admin/system/seo");
    await expect(page.getByTestId("gcs-seo-robots")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, "acp-seo-375");
  } finally {
    await resetAll();
  }
});

test("linkurile externe din postări au nofollow, cele din lista albă nu; imaginile externe blocate devin linkuri", async ({ page, request }) => {
  const id = uid();
  await member(page, `Link${id}`, `link-${id}@example.com`);
  const t = await forumTree(request);
  const link = (href: string, text: string) => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
  const content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [link(`https://spam-${id}.example/oferta`, "oferta"), { type: "text", text: " · " }, link(`https://cs.clan-${id}.example/servere`, "serverele noastre")] },
      { type: "image", attrs: { src: `https://imagini-${id}.example/harta.png`, alt: `Harta ${id}` } },
    ],
  };
  const topic = await fixture<{ topicId: number }>(request, { action: "topic", forumId: t.forum.id, title: `Linkuri ${id}`, text: "", content, authorEmail: `link-${id}@example.com` });
  await setSetting("seo.nofollow_exclude", `clan-${id}.example`);
  try {
    await page.goto(`/topic/${topic.topicId}`);
    const body = page.getByTestId("gcs-post").first().locator(".gcs-postBody");
    await expect(body.locator(`a[href="https://spam-${id}.example/oferta"]`)).toHaveAttribute("rel", "nofollow ugc noopener");
    await expect(body.locator(`a[href="https://cs.clan-${id}.example/servere"]`)).toHaveAttribute("rel", "noopener");
    await expect(body.locator(`img[src="https://imagini-${id}.example/harta.png"]`)).toHaveCount(1);

    await setSetting("uploads.remote_images", "block");
    await page.reload();
    await expect(body.locator(`img[src="https://imagini-${id}.example/harta.png"]`)).toHaveCount(0);
    const blocked = body.locator("a.gcs-remoteImage");
    await expect(blocked).toHaveText(`Harta ${id}`);
    await expect(blocked).toHaveAttribute("href", `https://imagini-${id}.example/harta.png`);
    await expect(blocked).toHaveAttribute("rel", "nofollow ugc noopener");
    await shot(page, "post-links-remote-image");

    // Cu nofollow oprit, nici linkurile externe nu-l mai au (conținutul salvat nu se schimbă).
    await setSetting("seo.nofollow_external", false);
    await page.reload();
    await expect(body.locator(`a[href="https://spam-${id}.example/oferta"]`)).toHaveAttribute("rel", "noopener");
    const [row] = await sql<{ contentHtml: string }>(`SELECT "contentHtml" FROM posts WHERE "topicId" = $1`, [topic.topicId]);
    expect(row!.contentHtml).toContain('rel="nofollow ugc noopener"');
  } finally {
    await resetAll();
  }
});

/** Un JPEG mare desenat de browser, cu un segment EXIF (autorul) inserat după antet. */
async function photoWithExif(page: Page, artist: string): Promise<Buffer> {
  const canvas = await page.context().newPage();
  await canvas.setViewportSize({ width: 3000, height: 2000 });
  await canvas.setContent('<body style="margin:0;width:3000px;height:2000px;background:linear-gradient(135deg,#0b1f3a,#d62839 50%,#ffb000)"></body>');
  const jpeg = await canvas.screenshot({ type: "jpeg", quality: 90 });
  await canvas.close();
  // TIFF little-endian: IFD0 cu o intrare (0x013B Artist, ASCII), valoarea după IFD.
  const value = Buffer.from(`${artist}\0`, "latin1");
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x013b, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(value.length, 14);
  tiff.writeUInt32LE(tiff.length, 18);
  tiff.writeUInt32LE(0, 22);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff, value]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]);
}

/** Dimensiunile reale ale unei imagini, decodată de browser. */
const decodedSize = (page: Page, src: string) =>
  page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, src);

test("încărcări: o fotografie mare cu EXIF devine WebP micșorat, fără metadate, cu miniatură; tipurile periculoase sunt refuzate", async ({ page, request }) => {
  const id = uid();
  await member(page, `Foto${id}`, `foto-${id}@example.com`);
  const t = await forumTree(request);
  const origin = new URL(page.url()).origin;
  const upload = (name: string, mimeType: string, buffer: Buffer) =>
    page.request.post("/api/forums/uploads", { headers: { origin }, multipart: { file: { name, mimeType, buffer }, forumId: String(t.forum.id) } });

  const artist = `GcsSecretArtist${id}`;
  const photo = await photoWithExif(page, artist);
  expect(photo.includes(Buffer.from(artist))).toBe(true);
  const res = await upload("vacanta.jpg", "image/jpeg", photo);
  expect(res.ok(), await res.text()).toBe(true);
  const att = ((await res.json()) as { data: { id: string; mime: string; width: number; height: number; filename: string } }).data;
  expect(att).toMatchObject({ mime: "image/webp", width: 2000, height: 1333, filename: "vacanta.webp" });

  const file = await page.request.get(`/files/${att.id}`);
  expect(file.headers()["content-type"]).toBe("image/webp");
  const bytes = await file.body();
  expect([bytes.toString("latin1", 0, 4), bytes.toString("latin1", 8, 12)]).toEqual(["RIFF", "WEBP"]);
  expect(bytes.includes(Buffer.from(artist))).toBe(false);
  expect(bytes.includes(Buffer.from("EXIF")) || bytes.includes(Buffer.from("Exif"))).toBe(false);
  expect(await decodedSize(page, `/files/${att.id}`)).toEqual([2000, 1333]);
  const [tw, th] = await decodedSize(page, `/files/${att.id}?thumb=1`);
  expect(tw).toBe(400);
  expect(th).toBeGreaterThanOrEqual(266);
  expect(th).toBeLessThanOrEqual(267);

  // Un script cu octeții unei imagini și o pagină web: refuzate (extensii periculoase), cu mesajul tradus.
  const php = await upload("shell.php", "image/jpeg", photo.subarray(0, 4096));
  expect(php.status()).toBe(422);
  expect(((await php.json()) as { error: { fields: Record<string, string> } }).error.fields).toEqual({ file: "dangerous_type" });
  const html = await upload("pagina.html", "text/html", Buffer.from("<script>alert(1)</script>"));
  expect(((await html.json()) as { error: { fields: Record<string, string> } }).error.fields).toEqual({ file: "dangerous_type" });
});

test("ACP Încărcări și imagini: pagina reală (driverul, limitele pe grup), salvarea și extensiile permise aplicate la upload", async ({ page, request }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Upl${id}`, `upl-${id}@example.com`);
  try {
    await page.goto("/admin/settings/uploads");
    await expect(page.getByRole("heading", { name: "Încărcări și imagini", level: 1 })).toBeVisible();
    await expect(page.getByTestId("gcs-uploads-driver")).toContainText(/Disc local|S3 \/ MinIO/);
    await expect(page.getByTestId("gcs-uploads-limits")).toContainText("Membru");
    await page.getByLabel("Calitatea imaginilor (%)").fill("75");
    await page.getByLabel("Extensii permise la atașamente").fill("png, exe");
    await page.getByRole("button", { name: "Salvează" }).first().click();
    await expect(page.getByText("Lista conține o extensie periculoasă (programe, scripturi, pagini web, SVG).")).toBeVisible();
    await page.getByLabel("Extensii permise la atașamente").fill("jpg, png, webp, gif, txt");
    await page.getByRole("button", { name: "Salvează" }).first().click();
    await expect(page.locator("form.gcs-acpForm").first().getByRole("status")).toHaveText("Salvat");
    await page.reload();
    await expect(page.getByLabel("Calitatea imaginilor (%)")).toHaveValue("75");
    await expect(page.getByLabel("Extensii permise la atașamente")).toHaveValue("jpg, png, webp, gif, txt");
    await shot(page, "acp-uploads");

    // Un PDF nu mai e permis (doar imagini și text): refuzat la upload.
    const t = await forumTree(request);
    const pdf = Buffer.from(["%PDF-1.4", "1 0 obj", "<<>>", "endobj", "trailer", "<<>>", "%%EOF", ""].join("\n"));
    const res = await page.request.post("/api/forums/uploads", { headers: { origin: new URL(page.url()).origin }, multipart: { file: { name: "regulament.pdf", mimeType: "application/pdf", buffer: pdf }, forumId: String(t.forum.id) } });
    expect(res.status()).toBe(422);
    expect(((await res.json()) as { error: { fields: Record<string, string> } }).error.fields).toEqual({ file: "extension_not_allowed" });

    await page.setViewportSize({ width: 375, height: 800 });
    await page.reload();
    await expect(page.getByTestId("gcs-acp-uploads-info")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, "acp-uploads-375");
  } finally {
    await resetAll();
  }
});
