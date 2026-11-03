import { expect, test, type Page } from "@playwright/test";
import { novaSettings, patchNova, preset, restoreNova } from "./cockpit-fixtures";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/**
 * Un WebM adevărat, înregistrat în browser (MediaRecorder, VP8): Chromium-ul testelor nu redă H.264 și pe mașina de
 * test nu e ffmpeg. Fundalul e verde, cu un pătrat alb care se mișcă (1,5 s).
 */
async function recordWebm(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 90;
    canvas.style.cssText = "position:fixed;left:-400px;top:0";
    document.body.append(canvas);
    const ctx = canvas.getContext("2d")!;
    let frame = 0;
    const draw = () => {
      ctx.fillStyle = "#18c964";
      ctx.fillRect(0, 0, 320, 90);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect((frame++ * 8) % 320, 30, 30, 30);
    };
    draw();
    const timer = setInterval(draw, 40);
    const rec = new MediaRecorder(canvas.captureStream(25), { mimeType: "video/webm;codecs=vp8" });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((resolve) => (rec.onstop = resolve));
    rec.start(250);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    rec.stop();
    await stopped;
    clearInterval(timer);
    canvas.remove();
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  return Buffer.from(b64, "base64");
}

/**
 * Ordinea în care browserul „vede” elementele într-un punct (de sus în jos), cu stratul videoului făcut țintibil doar
 * pentru măsurătoare: rândurile, crestătura și meniurile trebuie să fie deasupra lui, antetul și pagina dedesubt.
 */
async function stackAt(page: Page, x: number, y: number): Promise<string[]> {
  return page.evaluate(
    ([px, py]) => {
      const layer = document.querySelector<HTMLElement>(".gcs-hb__video")!;
      layer.style.pointerEvents = "auto";
      const names = document.elementsFromPoint(px!, py!).map((el) =>
        el === layer ? "video" : el.matches(".gcs-hb") ? "header" : el.matches("body") ? "body" : el.closest(".gcs-hb__notch") ? "notch" : el.closest(".gcs-hb__panel, .gcs-mega, [role=menu]") ? "menu" : el.closest(".gcs-hb__row") ? "row" : el.tagName.toLowerCase(),
      );
      layer.style.pointerEvents = "";
      return names;
    },
    [x, y],
  );
}

const before = (list: string[], a: string, b: string) => list.indexOf(a) !== -1 && list.indexOf(b) !== -1 && list.indexOf(a) < list.indexOf(b);

/**
 * Videoul antetului (macheta aprobată 2026-11-03: MP4 / WebM fără sunet, în buclă, până la 25 MB, imaginea de rezervă):
 * se încarcă din editorul vizual (Antet › Antet desktop), se servește cu `Range`, rulează în spatele antetului Esports
 * sub rânduri, crestătură și meniuri, se ascunde în bara compactă, stă și doar pe primul rând, iar cine are animațiile
 * reduse sau e pe telefon vede imaginea (fără să descarce videoul).
 */
test("videoul antetului: încărcat din editor, rulează sub antet, imaginea rămâne de rezervă", async ({ page, context }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.93.11");
  const saved = await novaSettings();
  try {
    // Esports (rândurile statice, crestătura), cu breadcrumb-ul pe rândul de jos; compact la derulare, fără ascundere.
    const layout = (await preset("esports")) as { desktop: { bottom: { left: string[] } } };
    layout.desktop.bottom.left = ["breadcrumb"];
    await patchNova({ header: { layout, art: "forja", image: null, imageArea: "all", imageMobile: true, video: null, sticky: true, compact: true, hideOnScroll: false } });
    await page.setViewportSize({ width: 1920, height: 1000 });
    const id = uid();
    await enterAcpAsRoot(page, `Vid${id}`, `vid-${id}@example.com`);
    const clip = await recordWebm(page);
    expect(clip.subarray(0, 4).toString("hex")).toBe("1a45dfa3");

    // ─── Editorul: Antet › Antet desktop › Videoul antetului ───
    await page.goto("/admin/theme-editor/gcs-dark");
    await expect(page.getByTestId("gcs-theme-studio")).toBeVisible();
    await page.getByTestId("gcs-studio-nav-header").click();
    await page.getByTestId("gcs-studio-nav-headerDesktop").click();
    const row = page.getByTestId("gcs-studio-image-headerVideo");
    await expect(row).toContainText("Videoul antetului (MP4 / WebM)");
    await expect(row).toContainText("Niciun video");
    // Popupul de încărcare: tipul se citește din conținut, deci o pagină HTML numită `.mp4` e refuzată înainte de trimitere.
    await page.getByTestId("gcs-studio-upload-headerVideo-open").click();
    const pick = page.getByTestId("gcs-studio-upload-headerVideo-pick");
    await expect(pick).toHaveAttribute("accept", "video/mp4,video/webm");
    const status = page.getByTestId("gcs-studio-status");
    await pick.setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
    await expect(page.getByTestId("gcs-studio-upload-headerVideo-dialog").locator('[data-check="errType"]')).toBeVisible();
    await expect(page.getByTestId("gcs-studio-upload-headerVideo-use")).toBeDisabled();
    await pick.setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: clip });
    await page.getByTestId("gcs-studio-upload-headerVideo-use").click();
    await expect(page.getByTestId("gcs-studio-upload-headerVideo-dialog")).toBeHidden();
    await expect(status).toHaveText("Draft salvat. Vizitatorii văd modificările doar după ce salvezi.");
    const thumb = row.locator("video");
    await expect(thumb).toHaveAttribute("src", /^\/files\/[A-Za-z0-9_-]+$/);
    const url = (await thumb.getAttribute("src"))!;

    // Previzualizarea: videoul rulează în antetul draft-ului.
    const frame = (await (await page.getByTestId("gcs-studio-preview").elementHandle())?.contentFrame())!;
    await expect.poll(() => frame.evaluate(() => document.documentElement.getAttribute("data-gcs-header-video"))).toBe("all");
    await expect(frame.getByTestId("gcs-header-video")).toHaveAttribute("data-playing", "", { timeout: 20_000 });

    // Fișierul: în pagină, cu tipul real, și cu cereri `Range` (206 / 416).
    const full = await page.request.get(url);
    expect(full.status()).toBe(200);
    expect(full.headers()["content-type"]).toBe("video/webm");
    expect(full.headers()["accept-ranges"]).toBe("bytes");
    expect(full.headers()["content-disposition"]).toMatch(/^inline;/);
    expect((await full.body()).equals(clip)).toBe(true);
    const part = await page.request.get(url, { headers: { Range: "bytes=0-99" } });
    expect(part.status()).toBe(206);
    expect(part.headers()["content-range"]).toBe(`bytes 0-99/${clip.length}`);
    expect((await part.body()).equals(clip.subarray(0, 100))).toBe(true);
    expect((await page.request.get(url, { headers: { Range: `bytes=${clip.length + 10}-` } })).status()).toBe(416);

    // Ieșirea fără salvare: tema publicată rămâne fără video.
    await page.getByTestId("gcs-studio-exit").click();
    await page.getByTestId("gcs-studio-exit-discard").click();
    await expect(page).toHaveURL(/\/admin\/appearance\/themes$/);

    // ─── Pe site (tema publicată cu videoul) ───
    await patchNova({ header: { video: url } });
    const seen: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(url)) seen.push(r.url());
    });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-gcs-header-video", "all");
    const header = page.getByTestId("gcs-header-builder");
    const layer = page.getByTestId("gcs-header-video");
    await expect(layer).toHaveAttribute("data-playing", "", { timeout: 20_000 });
    expect(await layer.locator("video").evaluate((v: HTMLVideoElement) => [v.muted, v.loop, v.paused, v.controls])).toEqual([true, true, false, false]);
    // Imaginea de rezervă rămâne pe antet (dedesubt).
    expect(await header.evaluate((h) => getComputedStyle(h).backgroundImage)).toContain("header-forja");

    // Straturile: rândurile, crestătura și meniul deasupra videoului; antetul și pagina dedesubt.
    const box = (await header.boundingBox())!;
    const empty = await stackAt(page, box.x + 40, box.y + 12);
    expect(before(empty, "row", "video"), empty.join(" > ")).toBe(true);
    expect(before(empty, "video", "header"), empty.join(" > ")).toBe(true);
    expect(before(empty, "video", "body"), empty.join(" > ")).toBe(true);
    const notch = (await page.getByTestId("gcs-header-notch").boundingBox())!;
    const atNotch = await stackAt(page, notch.x + notch.width / 2, notch.y + 20);
    expect(before(atNotch, "notch", "video"), atNotch.join(" > ")).toBe(true);
    await expect(page.getByTestId("gcs-brand").first()).toBeVisible();
    await expect(page.getByTestId("gcs-hb-nav")).toBeVisible();
    const crumbs = (await page.getByTestId("gcs-crumb-trail").first().boundingBox())!;
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest("[data-testid=gcs-crumb-trail]"), [crumbs.x + 10, crumbs.y + crumbs.height / 2])).toBe(true);

    // Bara compactă: videoul se ascunde și se oprește; înapoi sus, pornește din nou.
    await page.mouse.wheel(0, 900);
    await expect(header).toHaveAttribute("data-compact", "");
    await expect(layer).toBeHidden();
    await expect.poll(() => layer.locator("video").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).not.toHaveAttribute("data-compact", "");
    await expect.poll(() => layer.locator("video").evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);

    // Doar rândul de sus: stratul are înălțimea primului rând, iar imaginea lui se scoate cât rulează videoul.
    await patchNova({ header: { imageArea: "top" } });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-gcs-header-video", "top");
    await expect(layer).toHaveAttribute("data-playing", "", { timeout: 20_000 });
    const first = header.locator(":scope > .gcs-hb__row").first();
    expect(await layer.evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(await first.evaluate((el) => el.getBoundingClientRect().height), 0);
    expect(await first.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");

    // Animațiile reduse: imaginea, fără `<video>` și fără să descarce videoul.
    await patchNova({ header: { imageArea: "all" } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    seen.length = 0;
    await page.goto("/");
    await expect(header).toHaveAttribute("data-device", "desktop");
    await expect(page.getByTestId("gcs-brand").first()).toBeVisible();
    await expect(page.locator(".gcs-hb video")).toHaveCount(0);
    expect(await header.evaluate((h) => getComputedStyle(h).backgroundImage)).toContain("header-forja");
    expect(seen).toEqual([]);

    // Animațiile pornite la loc în sistem: videoul apare fără reîncărcare.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(layer).toHaveAttribute("data-playing", "", { timeout: 20_000 });

    // Telefonul: tot imaginea.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(header).toHaveAttribute("data-device", "mobile");
    await expect(page.locator(".gcs-hb video")).toHaveCount(0);
    seen.length = 0;
    await page.goto("/");
    await expect(header).toHaveAttribute("data-device", "mobile");
    await expect(page.locator(".gcs-hb video")).toHaveCount(0);
    expect(await header.evaluate((h) => getComputedStyle(h).backgroundImage)).toContain("header-forja");
    expect(seen).toEqual([]);
  } finally {
    await restoreNova(saved);
  }
});
